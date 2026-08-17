import unittest
from datetime import datetime
from types import SimpleNamespace
from unittest import mock

import app as energy_app
from app import (
    ConfigurationError,
    EnergyConfig,
    EnergyFailureStage,
    EnergyRuntime,
    SeasonRate,
    build_energy_runtime,
    calculate_energy,
    energy_response,
    fetch_usage,
    load_energy_config,
)


SYNTHETIC_CONFIG = EnergyConfig(
    username="synthetic-user",
    password="synthetic-password",
    timezone="Pacific/Auckland",
    device_id=12345,
    server_channel="server",
    climate_channel="climate",
    mains_channel="mains",
    currency="USD",
    tax_rate=0.05,
    fixed_monthly=10.0,
    seasons=(
        SeasonRate("cool", (1, 2, 3, 4, 5, 10, 11, 12), 0.10),
        SeasonRate("warm", (6, 7, 8, 9), 0.20),
    ),
    cache_ttl_seconds=60,
)

CONFIGURATION = """
schema_version: 1
presentation:
  timezone: Pacific/Auckland
energy:
  provider: emporia
  username_ref: ENERGY_USERNAME
  password_ref: ENERGY_PASSWORD
  device_id: 12345
  channels:
    server: server
    climate: climate
    mains: mains
  rates:
    currency: USD
    tax_rate: 0.05
    fixed_monthly: 10
    seasons:
      - name: cool
        months: [1, 2, 3, 4, 5, 10, 11, 12]
        price_per_kwh: 0.10
      - name: warm
        months: [6, 7, 8, 9]
        price_per_kwh: 0.20
"""

SCALE_VALUES = {
    "SECOND": "second",
    "DAY": "day",
    "MONTH": "month",
    "KWH": "kwh",
}


def usage_response(
    *,
    value: object = 1.0,
    missing_role: str | None = None,
    split_rows: bool = False,
) -> dict[int, SimpleNamespace]:
    channels = {
        role: SimpleNamespace(usage=value)
        for role in ("server", "climate", "mains")
        if role != missing_role
    }
    if split_rows:
        return {
            1: SimpleNamespace(
                device_gid=SYNTHETIC_CONFIG.device_id,
                channels={"server": channels["server"]},
            ),
            2: SimpleNamespace(
                device_gid=SYNTHETIC_CONFIG.device_id,
                channels={key: value for key, value in channels.items() if key != "server"},
            ),
        }
    return {
        SYNTHETIC_CONFIG.device_id: SimpleNamespace(
            device_gid=SYNTHETIC_CONFIG.device_id,
            channels=channels,
        )
    }


class SyntheticProvider:
    def __init__(
        self,
        responses: dict[str, dict[int, SimpleNamespace]] | None = None,
        *,
        fail_scale: str | None = None,
        fail_login: bool = False,
    ) -> None:
        self.responses = responses or {
            scale: usage_response() for scale in ("second", "day", "month")
        }
        self.fail_scale = fail_scale
        self.fail_login = fail_login
        self.login_calls = 0
        self.usage_calls: list[str] = []

    def login(self, **_credentials: str) -> None:
        self.login_calls += 1
        if self.fail_login:
            raise RuntimeError("provider-login-secret-marker")

    def get_device_list_usage(self, **request: object) -> dict[int, SimpleNamespace]:
        scale = str(request["scale"])
        self.usage_calls.append(scale)
        if scale == self.fail_scale:
            raise RuntimeError(f"provider-response-secret-marker-{scale}")
        return self.responses[scale]


class EnergyCalculationTest(unittest.TestCase):
    def test_uses_configured_rate_tax_and_projection(self) -> None:
        result = calculate_energy(
            {
                "server_watts": 420.4,
                "ac_watts": 100.2,
                "house_watts": 980.0,
                "server_today": 7.4,
                "ac_today": 1.2,
                "server_month": 100.0,
                "ac_month": 25.0,
                "house_month": 300.0,
            },
            SYNTHETIC_CONFIG,
            datetime(2026, 7, 10, 12, 0),
        )
        self.assertEqual(result["total_w"], 521)
        self.assertEqual(result["rate"], 0.20)
        self.assertEqual(result["rate_label"], "warm")
        self.assertEqual(result["currency"], "USD")
        self.assertEqual(result["total_today"], 8.6)
        self.assertEqual(result["server_today"], 7.4)
        self.assertEqual(result["ac_month"], 25.0)
        self.assertEqual(result["house_month"], 300.0)
        self.assertEqual(result["pct_of_house"], 42)
        self.assertGreater(result["projected_kwh"], result["total_month"])
        self.assertGreater(result["house_projected_cost"], 0)
        self.assertEqual(result["days_in_month"], 31)

    def test_loads_service_scoped_direct_and_file_secrets(self) -> None:
        reads: list[str] = []

        def read_text(path: str) -> str:
            reads.append(path)
            if path == "config.yml":
                return CONFIGURATION
            if path == "/run/secrets/password":
                return "file-password\r\n"
            raise FileNotFoundError(path)

        config = load_energy_config(
            "config.yml",
            {
                "ENERGY_USERNAME": "direct-user",
                "ENERGY_PASSWORD_FILE": "/run/secrets/password",
            },
            read_text,
        )

        self.assertEqual(config.username, "direct-user")
        self.assertEqual(config.password, "file-password")
        self.assertEqual(config.timezone, "Pacific/Auckland")
        self.assertEqual(config.device_id, 12345)
        self.assertEqual(reads.count("/run/secrets/password"), 1)

    def test_rejects_ambiguous_secret_without_exposing_values_or_paths(self) -> None:
        with self.assertRaises(ConfigurationError) as caught:
            load_energy_config(
                "config.yml",
                {
                    "ENERGY_USERNAME": "do-not-print-user",
                    "ENERGY_USERNAME_FILE": "/private/do-not-print-path",
                    "ENERGY_PASSWORD": "do-not-print-password",
                },
                lambda path: CONFIGURATION if path == "config.yml" else "do-not-print-file-value",
            )

        message = str(caught.exception)
        self.assertIn("both ENERGY_USERNAME and ENERGY_USERNAME_FILE", message)
        self.assertNotIn("do-not-print", message)

    def test_rejects_incomplete_or_overlapping_season_months(self) -> None:
        invalid = CONFIGURATION.replace("months: [6, 7, 8, 9]", "months: [5, 6, 7, 8]")
        with self.assertRaisesRegex(ConfigurationError, "every calendar month exactly once"):
            load_energy_config(
                "config.yml",
                {"ENERGY_USERNAME": "synthetic", "ENERGY_PASSWORD": "synthetic"},
                lambda _path: invalid,
            )

    def test_rejects_non_integer_device_and_duplicate_channel_selectors(self) -> None:
        for invalid_device in ("true", "1.5"):
            invalid = CONFIGURATION.replace("device_id: 12345", f"device_id: {invalid_device}")
            with self.subTest(device_id=invalid_device):
                with self.assertRaisesRegex(ConfigurationError, "positive integer"):
                    load_energy_config(
                        "config.yml",
                        {"ENERGY_USERNAME": "synthetic", "ENERGY_PASSWORD": "synthetic"},
                        lambda _path, document=invalid: document,
                    )

        duplicate_channel = CONFIGURATION.replace("climate: climate", "climate: server")
        with self.assertRaisesRegex(ConfigurationError, "selectors must be unique"):
            load_energy_config(
                "config.yml",
                {"ENERGY_USERNAME": "synthetic", "ENERGY_PASSWORD": "synthetic"},
                lambda _path: duplicate_channel,
            )

    def test_rejects_duplicate_yaml_fields(self) -> None:
        duplicate = CONFIGURATION.replace("  provider: emporia", "  provider: emporia\n  provider: emporia")
        with self.assertRaisesRegex(ConfigurationError, "duplicate field"):
            load_energy_config(
                "config.yml",
                {"ENERGY_USERNAME": "synthetic", "ENERGY_PASSWORD": "synthetic"},
                lambda _path: duplicate,
            )


class EnergyFailureTelemetryTest(unittest.TestCase):
    def setUp(self) -> None:
        energy_app._cache.update({"data": None, "timestamp": 0.0})
        energy_app._movers_history.clear()

    def assert_fixed_failure(
        self,
        runtime: EnergyRuntime,
        expected: EnergyFailureStage,
    ) -> None:
        status, payload = energy_response(runtime)
        self.assertEqual(status, 503)
        self.assertEqual(
            payload,
            {
                "error": "Energy collection failed",
                "failure_stage": expected.value,
            },
        )
        serialized = energy_app.json.dumps(payload)
        for marker in ("secret", "provider-response", "traceback", "RuntimeError"):
            self.assertNotIn(marker, serialized)

    def runtime_for(self, provider: SyntheticProvider) -> EnergyRuntime:
        return EnergyRuntime(
            SYNTHETIC_CONFIG,
            lambda: fetch_usage(
                SYNTHETIC_CONFIG,
                provider_factory=lambda: provider,
                scale_values=SCALE_VALUES,
            ),
        )

    def test_failure_stage_allowlist_is_exact(self) -> None:
        self.assertEqual(
            {stage.value for stage in EnergyFailureStage},
            {
                "configuration_loading",
                "provider_session",
                "second_usage_retrieval",
                "day_usage_retrieval",
                "month_usage_retrieval",
                "second_selector_validation",
                "day_selector_validation",
                "month_selector_validation",
                "second_numeric_normalization",
                "day_numeric_normalization",
                "month_numeric_normalization",
                "energy_calculation",
                "unexpected_internal_failure",
            },
        )

    def test_configuration_failure_is_value_safe_and_makes_no_provider_call(self) -> None:
        def fail_config() -> EnergyConfig:
            raise RuntimeError("configuration-secret-marker")

        runtime = build_energy_runtime(fail_config)
        self.assert_fixed_failure(runtime, EnergyFailureStage.CONFIGURATION_LOADING)
        self.assertIsNone(runtime.provider)

    def test_provider_construction_and_login_fail_at_fixed_session_stage(self) -> None:
        def fail_factory() -> SyntheticProvider:
            raise RuntimeError("provider-construction-secret-marker")

        construction_runtime = EnergyRuntime(
            SYNTHETIC_CONFIG,
            lambda: fetch_usage(
                SYNTHETIC_CONFIG,
                provider_factory=fail_factory,
                scale_values=SCALE_VALUES,
            ),
        )
        self.assert_fixed_failure(construction_runtime, EnergyFailureStage.PROVIDER_SESSION)

        self.setUp()
        provider = SyntheticProvider(fail_login=True)
        self.assert_fixed_failure(self.runtime_for(provider), EnergyFailureStage.PROVIDER_SESSION)
        self.assertEqual(provider.login_calls, 1)
        self.assertEqual(provider.usage_calls, [])

    def test_each_usage_retrieval_failure_is_fixed_and_stops_without_extra_calls(self) -> None:
        cases = (
            ("second", EnergyFailureStage.SECOND_USAGE_RETRIEVAL, ["second"]),
            ("day", EnergyFailureStage.DAY_USAGE_RETRIEVAL, ["second", "day"]),
            (
                "month",
                EnergyFailureStage.MONTH_USAGE_RETRIEVAL,
                ["second", "day", "month"],
            ),
        )
        for scale, stage, expected_calls in cases:
            with self.subTest(scale=scale):
                self.setUp()
                provider = SyntheticProvider(fail_scale=scale)
                self.assert_fixed_failure(self.runtime_for(provider), stage)
                self.assertEqual(provider.usage_calls, expected_calls)

    def test_each_selector_failure_is_independent_and_stops_without_extra_calls(self) -> None:
        stages = {
            "second": EnergyFailureStage.SECOND_SELECTOR_VALIDATION,
            "day": EnergyFailureStage.DAY_SELECTOR_VALIDATION,
            "month": EnergyFailureStage.MONTH_SELECTOR_VALIDATION,
        }
        scales = ["second", "day", "month"]
        for index, scale in enumerate(scales):
            with self.subTest(scale=scale):
                self.setUp()
                responses = {name: usage_response() for name in scales}
                responses[scale] = usage_response(missing_role="mains")
                provider = SyntheticProvider(responses)
                self.assert_fixed_failure(self.runtime_for(provider), stages[scale])
                self.assertEqual(provider.usage_calls, scales[: index + 1])

    def test_each_numeric_failure_is_fixed_and_stops_without_extra_calls(self) -> None:
        stages = {
            "second": EnergyFailureStage.SECOND_NUMERIC_NORMALIZATION,
            "day": EnergyFailureStage.DAY_NUMERIC_NORMALIZATION,
            "month": EnergyFailureStage.MONTH_NUMERIC_NORMALIZATION,
        }
        scales = ["second", "day", "month"]
        for index, scale in enumerate(scales):
            with self.subTest(scale=scale):
                self.setUp()
                responses = {name: usage_response() for name in scales}
                responses[scale] = usage_response(value="provider-response-secret-marker")
                provider = SyntheticProvider(responses)
                self.assert_fixed_failure(self.runtime_for(provider), stages[scale])
                self.assertEqual(provider.usage_calls, scales[: index + 1])

    def test_calculation_failure_is_fixed_and_provider_calls_remain_bounded(self) -> None:
        provider = SyntheticProvider()
        with mock.patch.object(
            energy_app,
            "calculate_energy",
            side_effect=RuntimeError("calculation-secret-marker"),
        ):
            self.assert_fixed_failure(
                self.runtime_for(provider),
                EnergyFailureStage.ENERGY_CALCULATION,
            )
        self.assertEqual(provider.usage_calls, ["second", "day", "month"])

    def test_unexpected_failure_uses_only_the_fixed_fallback(self) -> None:
        calls = 0

        def fail_unexpectedly() -> dict[str, float]:
            nonlocal calls
            calls += 1
            raise RuntimeError("unexpected-secret-marker")

        self.assert_fixed_failure(
            EnergyRuntime(SYNTHETIC_CONFIG, fail_unexpectedly),
            EnergyFailureStage.UNEXPECTED_INTERNAL_FAILURE,
        )
        self.assertEqual(calls, 1)

    def test_success_iterates_all_rows_calls_each_scale_once_and_preserves_contract(self) -> None:
        responses = {
            scale: usage_response(split_rows=True)
            for scale in ("second", "day", "month")
        }
        provider = SyntheticProvider(responses)
        runtime = self.runtime_for(provider)
        status, payload = energy_response(runtime)

        self.assertEqual(status, 200)
        self.assertNotIn("failure_stage", payload)
        self.assertNotIn("error", payload)
        self.assertEqual(provider.usage_calls, ["second", "day", "month"])
        self.assertEqual(
            set(payload),
            {
                "server_w",
                "ac_w",
                "house_w",
                "total_w",
                "server_today",
                "ac_today",
                "total_today",
                "house_today",
                "server_month",
                "ac_month",
                "total_month",
                "house_month",
                "month_cost",
                "projected_kwh",
                "projected_cost",
                "house_projected_kwh",
                "house_projected_cost",
                "rate",
                "rate_label",
                "currency",
                "days_in_month",
                "pct_of_house",
                "observed_at",
                "movers",
            },
        )
        self.assertEqual(set(payload["movers"]), {"window_minutes", "circuits"})

        second_status, second_payload = energy_response(runtime)
        self.assertEqual((second_status, second_payload), (status, payload))
        self.assertEqual(provider.usage_calls, ["second", "day", "month"])


class CircuitMoversTest(unittest.TestCase):
    def setUp(self) -> None:
        energy_app._cache.update({"data": None, "timestamp": 0.0})
        energy_app._movers_history.clear()

    def test_circuit_sample_collection_excludes_aggregates_and_malformed(self) -> None:
        circuits: dict[str, dict[str, object]] = {}
        samples = {
            "server": SimpleNamespace(usage=0.0001, name="Server Room"),
            "mains": SimpleNamespace(usage=0.0009, name="Mains"),
            "1,2,3": SimpleNamespace(usage=0.0009, name="Panel"),
            "TotalUsage": SimpleNamespace(usage=0.0009, name="Total"),
            "Balance": SimpleNamespace(usage=0.0009, name="Balance"),
            "7": SimpleNamespace(usage=True, name="Bool"),
            "8": SimpleNamespace(usage=None, name="Empty"),
            "9": SimpleNamespace(usage=float("inf"), name="Infinite"),
            "10": SimpleNamespace(usage="0.5", name="Text"),
            "11": SimpleNamespace(usage=0.0002, name="   "),
            "12": SimpleNamespace(usage=0.0003, name="X" * 80),
        }
        for number, channel in samples.items():
            energy_app.collect_circuit_sample(
                circuits, number, channel, SYNTHETIC_CONFIG
            )
        self.assertEqual(set(circuits), {"server", "11", "12"})
        self.assertEqual(circuits["server"], {"name": "Server Room", "w": 360.0})
        self.assertEqual(circuits["11"]["name"], "Circuit 11")
        self.assertEqual(len(circuits["12"]["name"]), energy_app.MOVERS_NAME_LIMIT)

    def test_circuit_sample_collection_is_bounded(self) -> None:
        circuits: dict[str, dict[str, object]] = {}
        for index in range(energy_app.MOVERS_CIRCUIT_LIMIT + 10):
            energy_app.collect_circuit_sample(
                circuits,
                str(index),
                SimpleNamespace(usage=0.0001, name=f"Circuit {index}"),
                SYNTHETIC_CONFIG,
            )
        self.assertEqual(len(circuits), energy_app.MOVERS_CIRCUIT_LIMIT)

    def test_first_sample_reports_an_empty_window(self) -> None:
        history: "energy_app.deque" = energy_app.deque()
        movers = energy_app.compute_movers(
            history, {"1": {"name": "Dryer", "w": 500.0}}, 1_000.0
        )
        self.assertEqual(movers, {"window_minutes": 0, "circuits": []})

    def test_movers_rank_by_absolute_change_and_drop_noise(self) -> None:
        history: "energy_app.deque" = energy_app.deque()
        baseline = {
            "1": {"name": "Dryer", "w": 100.0},
            "2": {"name": "Oven", "w": 900.0},
            "3": {"name": "Steady", "w": 60.0},
            "4": {"name": "Removed", "w": 40.0},
        }
        energy_app.compute_movers(history, baseline, 0.0)
        current = {
            "1": {"name": "Dryer", "w": 4_600.0},
            "2": {"name": "Oven", "w": 150.0},
            "3": {"name": "Steady", "w": 60.4},
            "5": {"name": "New Circuit", "w": 800.0},
        }
        movers = energy_app.compute_movers(history, current, 1_800.0)
        self.assertEqual(movers["window_minutes"], 30)
        self.assertEqual(
            movers["circuits"],
            [
                {"name": "Dryer", "w": 4_600, "delta_w": 4_500},
                {"name": "Oven", "w": 150, "delta_w": -750},
            ],
        )

    def test_movers_list_is_capped_and_window_is_pruned(self) -> None:
        history: "energy_app.deque" = energy_app.deque()
        old = {str(n): {"name": f"C{n}", "w": 0.0} for n in range(8)}
        mid = {str(n): {"name": f"C{n}", "w": 10.0} for n in range(8)}
        new = {str(n): {"name": f"C{n}", "w": float(100 * (n + 1))} for n in range(8)}
        energy_app.compute_movers(history, old, 0.0)
        energy_app.compute_movers(
            history, mid, float(energy_app.MOVERS_RETENTION_SECONDS)
        )
        movers = energy_app.compute_movers(
            history, new, float(energy_app.MOVERS_RETENTION_SECONDS + 1_800)
        )
        self.assertEqual(len(movers["circuits"]), energy_app.MOVERS_LIMIT)
        self.assertEqual(movers["window_minutes"], 30)
        self.assertEqual(movers["circuits"][0], {"name": "C7", "w": 800, "delta_w": 790})

    def test_fetch_usage_returns_circuits_beside_the_role_contract(self) -> None:
        responses = {
            scale: usage_response() for scale in ("second", "day", "month")
        }
        for channel in responses["second"].values():
            channel.channels["9"] = SimpleNamespace(usage=0.0002, name="Rack PDU")
        raw = fetch_usage(
            SYNTHETIC_CONFIG,
            provider_factory=lambda: SyntheticProvider(responses),
            scale_values=SCALE_VALUES,
        )
        self.assertEqual(
            set(raw["circuits"]), {"server", "climate", "9"}
        )
        self.assertEqual(raw["circuits"]["9"], {"name": "Rack PDU", "w": 720.0})
        self.assertEqual(raw["server_watts"], 3_600_000.0)


if __name__ == "__main__":
    unittest.main()
