"""Provider-neutral Ravenhill energy sidecar boundary."""

from __future__ import annotations

import calendar
import json
import math
import os
import re
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable, Mapping
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

_cache: dict[str, Any] = {"data": None, "timestamp": 0.0}
_cache_lock = threading.Lock()
_SECRET_REFERENCE = re.compile(r"^[A-Z][A-Z0-9_]*$")

MOVERS_WINDOW_SECONDS = 3_600
MOVERS_RETENTION_SECONDS = 3_900
MOVERS_LIMIT = 5
MOVERS_NAME_LIMIT = 40
MOVERS_CIRCUIT_LIMIT = 48
_movers_history: deque[tuple[float, dict[str, dict[str, Any]]]] = deque()


class ConfigurationError(RuntimeError):
    """A value-suppressed startup configuration failure."""


class EnergyFailureStage(str, Enum):
    """Fixed, value-safe failure stages exposed by the energy boundary."""

    CONFIGURATION_LOADING = "configuration_loading"
    PROVIDER_SESSION = "provider_session"
    SECOND_USAGE_RETRIEVAL = "second_usage_retrieval"
    DAY_USAGE_RETRIEVAL = "day_usage_retrieval"
    MONTH_USAGE_RETRIEVAL = "month_usage_retrieval"
    SECOND_SELECTOR_VALIDATION = "second_selector_validation"
    DAY_SELECTOR_VALIDATION = "day_selector_validation"
    MONTH_SELECTOR_VALIDATION = "month_selector_validation"
    SECOND_NUMERIC_NORMALIZATION = "second_numeric_normalization"
    DAY_NUMERIC_NORMALIZATION = "day_numeric_normalization"
    MONTH_NUMERIC_NORMALIZATION = "month_numeric_normalization"
    ENERGY_CALCULATION = "energy_calculation"
    UNEXPECTED_INTERNAL_FAILURE = "unexpected_internal_failure"


class EnergyCollectionFailure(RuntimeError):
    """An energy failure carrying only one allowlisted stage."""

    def __init__(self, stage: EnergyFailureStage) -> None:
        self.stage = stage
        super().__init__(stage.value)


@dataclass(frozen=True)
class SeasonRate:
    name: str
    months: tuple[int, ...]
    price_per_kwh: float


@dataclass(frozen=True)
class EnergyConfig:
    username: str = field(repr=False)
    password: str = field(repr=False)
    timezone: str
    device_id: int
    server_channel: str
    climate_channel: str | None
    mains_channel: str
    currency: str
    tax_rate: float
    fixed_monthly: float
    seasons: tuple[SeasonRate, ...]
    cache_ttl_seconds: int


@dataclass(frozen=True)
class EnergyRuntime:
    """The configured collection boundary or one fixed startup failure."""

    config: EnergyConfig | None
    provider: Callable[[], dict[str, Any]] | None
    failure_stage: EnergyFailureStage | None = None


def _mapping(value: Any, field: str) -> dict[str, Any]:
    if not isinstance(value, dict) or not all(isinstance(key, str) for key in value):
        raise ConfigurationError(f"{field} must be a mapping")
    return value


def _strict_keys(value: dict[str, Any], allowed: set[str], required: set[str], field: str) -> None:
    unknown = sorted(set(value) - allowed)
    missing = sorted(required - set(value))
    if unknown:
        raise ConfigurationError(f"{field} contains unsupported fields: {', '.join(unknown)}")
    if missing:
        raise ConfigurationError(f"{field} is missing required fields: {', '.join(missing)}")


def _secret_reference(value: Any, field: str) -> str:
    reference = str(value) if isinstance(value, str) else ""
    if not _SECRET_REFERENCE.fullmatch(reference) or reference.endswith("_FILE"):
        raise ConfigurationError(f"{field} must name an uppercase secret environment variable")
    return reference


def _resolve_secret(
    reference: str,
    environment: Mapping[str, str],
    read_text: Callable[[str], str],
    file_cache: dict[str, str],
) -> str:
    file_variable = f"{reference}_FILE"
    direct_is_set = reference in environment
    file_is_set = file_variable in environment
    if direct_is_set and file_is_set:
        raise ConfigurationError(
            f"Secret {reference} is configured by both {reference} and {file_variable}"
        )
    if not direct_is_set and not file_is_set:
        raise ConfigurationError(f"Secret {reference} is required but is not configured")

    if file_is_set:
        path = environment[file_variable]
        if not path:
            raise ConfigurationError(f"Secret {reference} has an empty {file_variable} setting")
        try:
            if path not in file_cache:
                file_cache[path] = read_text(path)
            value = file_cache[path]
        except Exception as error:
            raise ConfigurationError(
                f"Secret {reference} could not be read from {file_variable}"
            ) from error
        if value.endswith("\r\n"):
            value = value[:-2]
        elif value.endswith(("\n", "\r")):
            value = value[:-1]
    else:
        value = environment[reference]

    if not value:
        raise ConfigurationError(f"Secret {reference} resolved to an empty value")
    if "\0" in value:
        raise ConfigurationError(f"Secret {reference} contains an unsupported NUL byte")
    return value


def load_energy_config(
    config_path: str | None = None,
    environment: Mapping[str, str] | None = None,
    read_text: Callable[[str], str] | None = None,
) -> EnergyConfig:
    """Load only the energy service's typed config and service-scoped secrets."""
    import yaml

    class UniqueKeyLoader(yaml.SafeLoader):
        pass

    def unique_mapping(loader: UniqueKeyLoader, node: Any, deep: bool = False) -> dict[Any, Any]:
        mapping: dict[Any, Any] = {}
        for key_node, value_node in node.value:
            key = loader.construct_object(key_node, deep=deep)
            if key in mapping:
                raise ConfigurationError("Ravenhill configuration contains a duplicate field")
            mapping[key] = loader.construct_object(value_node, deep=deep)
        return mapping

    UniqueKeyLoader.add_constructor(
        yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG,
        unique_mapping,
    )

    env = environment if environment is not None else os.environ
    path = config_path or env.get("RAVENHILL_CONFIG", "ravenhill.yml")
    reader = read_text or (lambda value: Path(value).read_text(encoding="utf-8"))
    try:
        document = yaml.load(reader(path), Loader=UniqueKeyLoader)
    except ConfigurationError:
        raise
    except Exception as error:
        raise ConfigurationError("Ravenhill configuration file could not be read or parsed") from error

    root = _mapping(document, "configuration")
    if root.get("schema_version") != 1:
        raise ConfigurationError("schema_version must be 1")
    presentation_value = root.get("presentation")
    presentation = {} if presentation_value is None else _mapping(presentation_value, "presentation")
    timezone = presentation.get("timezone", "UTC")
    if not isinstance(timezone, str) or not timezone.strip():
        raise ConfigurationError("presentation.timezone must be a valid IANA timezone")
    try:
        ZoneInfo(timezone)
    except ZoneInfoNotFoundError as error:
        raise ConfigurationError("presentation.timezone must be a valid IANA timezone") from error
    energy = _mapping(root.get("energy"), "energy")
    _strict_keys(
        energy,
        {
            "provider",
            "username_ref",
            "password_ref",
            "device_id",
            "channels",
            "rates",
            "cache_ttl_seconds",
        },
        {"provider", "username_ref", "password_ref", "device_id", "channels", "rates"},
        "energy",
    )
    if energy["provider"] != "emporia":
        raise ConfigurationError("energy.provider must be emporia")

    channels = _mapping(energy["channels"], "energy.channels")
    _strict_keys(channels, {"server", "climate", "mains"}, {"server", "mains"}, "energy.channels")
    channel_values = [channels.get("server"), channels.get("climate"), channels.get("mains")]
    if any(value is not None and (not isinstance(value, str) or not value.strip()) for value in channel_values):
        raise ConfigurationError("energy.channels values must be non-empty strings")
    configured_channels = [value for value in channel_values if value is not None]
    if len(configured_channels) != len(set(configured_channels)):
        raise ConfigurationError("energy.channels selectors must be unique")

    rates = _mapping(energy["rates"], "energy.rates")
    _strict_keys(rates, {"currency", "tax_rate", "fixed_monthly", "seasons"}, {"currency", "tax_rate", "fixed_monthly", "seasons"}, "energy.rates")
    currency = rates["currency"]
    if not isinstance(currency, str) or not re.fullmatch(r"[A-Z]{3}", currency):
        raise ConfigurationError("energy.rates.currency must be a three-letter code")
    tax_rate = rates["tax_rate"]
    fixed_monthly = rates["fixed_monthly"]
    if not isinstance(tax_rate, (int, float)) or isinstance(tax_rate, bool) or not 0 <= tax_rate <= 1:
        raise ConfigurationError("energy.rates.tax_rate must be between 0 and 1")
    if not isinstance(fixed_monthly, (int, float)) or isinstance(fixed_monthly, bool) or fixed_monthly < 0:
        raise ConfigurationError("energy.rates.fixed_monthly must be non-negative")

    raw_seasons = rates["seasons"]
    if not isinstance(raw_seasons, list) or not raw_seasons:
        raise ConfigurationError("energy.rates.seasons must be a non-empty list")
    seasons: list[SeasonRate] = []
    assigned_months: list[int] = []
    for index, raw_season in enumerate(raw_seasons):
        season = _mapping(raw_season, f"energy.rates.seasons.{index}")
        _strict_keys(season, {"name", "months", "price_per_kwh"}, {"name", "months", "price_per_kwh"}, f"energy.rates.seasons.{index}")
        name = season["name"]
        months = season["months"]
        price = season["price_per_kwh"]
        if not isinstance(name, str) or not name.strip():
            raise ConfigurationError(f"energy.rates.seasons.{index}.name must be non-empty")
        if not isinstance(months, list) or not months or any(
            not isinstance(month, int) or isinstance(month, bool) or not 1 <= month <= 12
            for month in months
        ):
            raise ConfigurationError(f"energy.rates.seasons.{index}.months must contain calendar months")
        if not isinstance(price, (int, float)) or isinstance(price, bool) or price < 0:
            raise ConfigurationError(f"energy.rates.seasons.{index}.price_per_kwh must be non-negative")
        assigned_months.extend(months)
        seasons.append(SeasonRate(name.strip(), tuple(months), float(price)))
    if sorted(assigned_months) != list(range(1, 13)):
        raise ConfigurationError("energy.rates.seasons must assign every calendar month exactly once")

    device_id_value = energy["device_id"]
    if isinstance(device_id_value, bool) or not (
        isinstance(device_id_value, int) and device_id_value > 0
        or isinstance(device_id_value, str) and re.fullmatch(r"\d+", device_id_value)
    ):
        raise ConfigurationError("energy.device_id must be a positive integer")
    device_id = int(device_id_value)
    if device_id <= 0:
        raise ConfigurationError("energy.device_id must be a positive integer")
    cache_ttl = energy.get("cache_ttl_seconds", 60)
    if not isinstance(cache_ttl, int) or isinstance(cache_ttl, bool) or not 1 <= cache_ttl <= 3_600:
        raise ConfigurationError("energy.cache_ttl_seconds must be between 1 and 3600")

    username_ref = _secret_reference(energy["username_ref"], "energy.username_ref")
    password_ref = _secret_reference(energy["password_ref"], "energy.password_ref")
    file_cache: dict[str, str] = {}
    return EnergyConfig(
        username=_resolve_secret(username_ref, env, reader, file_cache),
        password=_resolve_secret(password_ref, env, reader, file_cache),
        timezone=timezone,
        device_id=device_id,
        server_channel=channels["server"],
        climate_channel=channels.get("climate"),
        mains_channel=channels["mains"],
        currency=currency,
        tax_rate=float(tax_rate),
        fixed_monthly=float(fixed_monthly),
        seasons=tuple(seasons),
        cache_ttl_seconds=cache_ttl,
    )


def collect_circuit_sample(
    circuits: dict[str, dict[str, Any]],
    channel_number: Any,
    channel: Any,
    config: EnergyConfig,
) -> None:
    """Record one auxiliary circuit reading; malformed entries are skipped.

    Circuit data feeds the movers list only, so it must never fail the
    core telemetry contract: anything aggregate (the mains selector, any
    multi-channel selector, the provider's pseudo-channels) or malformed
    is dropped instead of raising.
    """
    if len(circuits) >= MOVERS_CIRCUIT_LIMIT:
        return
    key = str(channel_number)
    if key == str(config.mains_channel) or "," in key or key in ("TotalUsage", "Balance"):
        return
    raw_value = getattr(channel, "usage", None)
    if isinstance(raw_value, bool) or not isinstance(raw_value, (int, float)):
        return
    watts = float(raw_value) * 3_600_000
    if not math.isfinite(watts):
        return
    name = getattr(channel, "name", None)
    if not isinstance(name, str) or not name.strip():
        name = f"Circuit {key}"
    circuits[key] = {"name": name.strip()[:MOVERS_NAME_LIMIT], "w": watts}


def fetch_usage(
    config: EnergyConfig,
    provider_factory: Callable[[], Any] | None = None,
    scale_values: Mapping[str, str] | None = None,
) -> dict[str, Any]:
    """Fetch configured channels at second/day/month scales."""
    try:
        if provider_factory is None:
            from pyemvue import PyEmVue

            provider_factory = PyEmVue
        if scale_values is None:
            from pyemvue.enums import Scale, Unit

            scale_values = {
                "SECOND": Scale.SECOND.value,
                "DAY": Scale.DAY.value,
                "MONTH": Scale.MONTH.value,
                "KWH": Unit.KWH.value,
            }
        vue = provider_factory()
        vue.login(username=config.username, password=config.password)
    except Exception:
        raise EnergyCollectionFailure(EnergyFailureStage.PROVIDER_SESSION) from None

    result: dict[str, Any] = {}
    circuits: dict[str, dict[str, Any]] = {}
    channel_roles = {
        config.server_channel: "server",
        config.mains_channel: "house",
        **({config.climate_channel: "ac"} if config.climate_channel else {}),
    }
    scales = (
        (
            "now",
            scale_values["SECOND"],
            EnergyFailureStage.SECOND_USAGE_RETRIEVAL,
            EnergyFailureStage.SECOND_SELECTOR_VALIDATION,
            EnergyFailureStage.SECOND_NUMERIC_NORMALIZATION,
        ),
        (
            "today",
            scale_values["DAY"],
            EnergyFailureStage.DAY_USAGE_RETRIEVAL,
            EnergyFailureStage.DAY_SELECTOR_VALIDATION,
            EnergyFailureStage.DAY_NUMERIC_NORMALIZATION,
        ),
        (
            "month",
            scale_values["MONTH"],
            EnergyFailureStage.MONTH_USAGE_RETRIEVAL,
            EnergyFailureStage.MONTH_SELECTOR_VALIDATION,
            EnergyFailureStage.MONTH_NUMERIC_NORMALIZATION,
        ),
    )

    for scale_name, scale, retrieval_stage, selector_stage, numeric_stage in scales:
        try:
            usage = vue.get_device_list_usage(
                deviceGids=[config.device_id],
                instant=None,
                scale=scale,
                unit=scale_values["KWH"],
            )
        except Exception:
            raise EnergyCollectionFailure(retrieval_stage) from None

        try:
            if not isinstance(usage, Mapping) or not usage:
                raise EnergyCollectionFailure(selector_stage)

            expected_roles = set(channel_roles.values())
            observed_roles: set[str] = set()
            matched_device = False
            for device_key, device in usage.items():
                device_id = getattr(device, "device_gid", device_key)
                if str(device_id) != str(config.device_id):
                    continue
                matched_device = True
                channels = getattr(device, "channels", None)
                if not isinstance(channels, Mapping):
                    raise EnergyCollectionFailure(selector_stage)
                for channel_number, channel in channels.items():
                    if scale_name == "now":
                        collect_circuit_sample(circuits, channel_number, channel, config)
                    role = channel_roles.get(channel_number)
                    if role is None:
                        continue
                    observed_roles.add(role)
                    try:
                        raw_value = getattr(channel, "usage")
                        if isinstance(raw_value, bool):
                            raise ValueError
                        value = float(raw_value or 0)
                        if scale_name == "now":
                            value *= 3_600_000
                        if not math.isfinite(value):
                            raise ValueError
                    except Exception:
                        raise EnergyCollectionFailure(numeric_stage) from None
                    suffix = "watts" if scale_name == "now" else scale_name
                    result[f"{role}_{suffix}"] = value
            if not matched_device or observed_roles != expected_roles:
                raise EnergyCollectionFailure(selector_stage)
        except EnergyCollectionFailure:
            raise
        except Exception:
            raise EnergyCollectionFailure(selector_stage) from None
    result["circuits"] = circuits
    return result


def calculate_energy(
    raw: dict[str, float],
    config: EnergyConfig,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Apply the configured seasonal rate, tax, and projection model."""
    configured_zone = ZoneInfo(config.timezone)
    current = datetime.now(configured_zone) if now is None else (
        now.replace(tzinfo=configured_zone) if now.tzinfo is None else now.astimezone(configured_zone)
    )
    season = next((candidate for candidate in config.seasons if current.month in candidate.months), None)
    if season is None:
        raise ConfigurationError("No energy rate is configured for the current month")
    rate = season.price_per_kwh
    server_w = raw.get("server_watts", 0.0)
    ac_w = raw.get("ac_watts", 0.0)
    house_w = raw.get("house_watts", 0.0)
    total_month = raw.get("server_month", 0.0) + raw.get("ac_month", 0.0)
    house_month = raw.get("house_month", 0.0)
    day_of_month = current.day + current.hour / 24
    days_in_month = calendar.monthrange(current.year, current.month)[1]
    projected_kwh = total_month / day_of_month * days_in_month if day_of_month else 0
    house_projected_kwh = house_month / day_of_month * days_in_month if day_of_month else 0
    return {
        "server_w": round(server_w),
        "ac_w": round(ac_w),
        "house_w": round(house_w),
        "total_w": round(server_w + ac_w),
        "server_today": round(raw.get("server_today", 0.0), 1),
        "ac_today": round(raw.get("ac_today", 0.0), 1),
        "total_today": round(raw.get("server_today", 0.0) + raw.get("ac_today", 0.0), 1),
        "house_today": round(raw.get("house_today", 0.0), 1),
        "server_month": round(raw.get("server_month", 0.0), 1),
        "ac_month": round(raw.get("ac_month", 0.0), 1),
        "total_month": round(total_month, 1),
        "house_month": round(house_month, 1),
        "month_cost": round(total_month * rate * (1 + config.tax_rate), 2),
        "projected_kwh": round(projected_kwh),
        "projected_cost": round(projected_kwh * rate * (1 + config.tax_rate), 2),
        "house_projected_kwh": round(house_projected_kwh),
        "house_projected_cost": round(
            (house_projected_kwh * rate + config.fixed_monthly) * (1 + config.tax_rate), 2
        ),
        "rate": rate,
        "rate_label": season.name,
        "currency": config.currency,
        "days_in_month": days_in_month,
        "pct_of_house": round(total_month / house_month * 100) if house_month else 0,
        "observed_at": current.isoformat(),
    }


def compute_movers(
    history: deque[tuple[float, dict[str, dict[str, Any]]]],
    circuits: dict[str, dict[str, Any]],
    now: float,
) -> dict[str, Any]:
    """Append the newest circuit sample and rank the largest changes.

    The baseline is the oldest sample still inside the retention window,
    so the reported window grows from zero after a restart up to roughly
    ``MOVERS_WINDOW_SECONDS``. Circuits without a baseline reading and
    changes that round to zero watts are omitted.
    """
    history.append((now, circuits))
    while history and now - history[0][0] > MOVERS_RETENTION_SECONDS:
        history.popleft()
    baseline_at, baseline = history[0]
    window_seconds = max(0.0, now - baseline_at)
    rows: list[dict[str, Any]] = []
    for key, sample in circuits.items():
        before = baseline.get(key)
        if before is None:
            continue
        delta = round(float(sample["w"]) - float(before["w"]))
        if delta == 0:
            continue
        rows.append({
            "name": sample["name"],
            "w": round(float(sample["w"])),
            "delta_w": delta,
        })
    rows.sort(key=lambda row: (-abs(row["delta_w"]), row["name"]))
    return {
        "window_minutes": round(window_seconds / 60),
        "circuits": rows[:MOVERS_LIMIT],
    }


def cached_energy(
    provider: Callable[[], dict[str, Any]],
    config: EnergyConfig,
) -> dict[str, Any]:
    with _cache_lock:
        now = time.time()
        if _cache["data"] is None or now - float(_cache["timestamp"]) >= config.cache_ttl_seconds:
            raw = provider()
            try:
                circuits = raw.pop("circuits", {}) if isinstance(raw, dict) else {}
                payload = calculate_energy(raw, config)
                payload["movers"] = compute_movers(_movers_history, circuits, now)
                _cache["data"] = payload
            except EnergyCollectionFailure:
                raise
            except Exception:
                raise EnergyCollectionFailure(EnergyFailureStage.ENERGY_CALCULATION) from None
            _cache["timestamp"] = now
        return dict(_cache["data"])


def build_energy_runtime(
    config_loader: Callable[[], EnergyConfig] = load_energy_config,
    usage_fetcher: Callable[[EnergyConfig], dict[str, Any]] = fetch_usage,
) -> EnergyRuntime:
    """Build the runtime without retaining configuration failure details."""
    try:
        config = config_loader()
        if not isinstance(config, EnergyConfig):
            raise TypeError
    except Exception:
        return EnergyRuntime(None, None, EnergyFailureStage.CONFIGURATION_LOADING)
    return EnergyRuntime(config, lambda: usage_fetcher(config))


def energy_response(runtime: EnergyRuntime) -> tuple[int, dict[str, Any]]:
    """Return a successful payload or one fixed, value-safe 503 payload."""
    try:
        if runtime.failure_stage is not None:
            raise EnergyCollectionFailure(runtime.failure_stage)
        if runtime.config is None or runtime.provider is None:
            raise RuntimeError
        return 200, cached_energy(runtime.provider, runtime.config)
    except EnergyCollectionFailure as error:
        stage = error.stage
    except Exception:
        stage = EnergyFailureStage.UNEXPECTED_INTERNAL_FAILURE
    return 503, {
        "error": "Energy collection failed",
        "failure_stage": stage.value,
    }


class EnergyHandler(BaseHTTPRequestHandler):
    runtime: EnergyRuntime

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            self._json(200, {"status": "ok"})
            return
        if self.path != "/energy":
            self._json(404, {"error": "Not found"})
            return
        status, payload = energy_response(self.runtime)
        self._json(status, payload)

    def log_message(self, format_string: str, *args: Any) -> None:
        return

    def _json(self, status: int, payload: dict[str, Any]) -> None:
        encoded = json.dumps(payload, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)


def main() -> None:
    EnergyHandler.runtime = build_energy_runtime()
    port = int(os.environ.get("ENERGY_PORT", "8080"))
    ThreadingHTTPServer(("0.0.0.0", port), EnergyHandler).serve_forever()


if __name__ == "__main__":
    main()
