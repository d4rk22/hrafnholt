import unittest
from datetime import datetime

from app import ConfigurationError, EnergyConfig, SeasonRate, calculate_energy, load_energy_config


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


if __name__ == "__main__":
    unittest.main()
