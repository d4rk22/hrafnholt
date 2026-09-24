import unittest
from datetime import datetime
from unittest.mock import patch

import app
from test_energy import SYNTHETIC_CONFIG, SCALE_VALUES, SyntheticProvider, usage_response


class PollingTest(unittest.TestCase):
    def setUp(self):
        self.provider = SyntheticProvider()
        self.state = app.UsageSession()
        self.now = datetime(2026, 9, 17, 12, 0)

    def fetch(self, seconds=0):
        with patch.object(app.time, "monotonic", return_value=seconds), patch.object(app, "datetime") as clock:
            clock.now.return_value = self.now
            return app.fetch_usage(SYNTHETIC_CONFIG, lambda: self.provider, SCALE_VALUES, session=self.state)

    def test_reuses_login_and_refreshes_each_scale_on_its_own_schedule(self):
        self.fetch()
        self.provider.responses["second"] = usage_response(value=2)
        result = self.fetch(60)
        self.assertEqual(result["server_watts"], 7200000)
        self.assertEqual(result["server_today"], 1)
        self.assertEqual(self.provider.login_calls, 1)
        self.assertEqual(self.provider.usage_calls, ["second", "day", "month", "second"])
        self.fetch(900)
        self.assertEqual(self.provider.usage_calls[-2:], ["second", "day"])
        self.fetch(3600)
        self.assertEqual(self.provider.usage_calls[-3:], ["second", "day", "month"])

    def test_date_change_refreshes_daily_totals_and_circuits(self):
        self.fetch()
        self.now = datetime(2026, 9, 18, 0, 0)
        self.provider.responses["day"] = usage_response(value=0)
        result = self.fetch(60)
        self.assertEqual(result["server_today"], 0)
        self.assertEqual(self.provider.usage_calls[-2:], ["second", "day"])

    def test_month_change_refreshes_both_totals(self):
        self.fetch()
        self.now = datetime(2026, 10, 1, 0, 0)
        self.fetch(60)
        self.assertEqual(self.provider.usage_calls[-3:], ["second", "day", "month"])

    def test_failed_refresh_does_not_cache_invalid_data_or_relogin(self):
        self.fetch()
        self.provider.responses["day"] = usage_response(missing_role="server")
        with self.assertRaises(app.EnergyCollectionFailure):
            self.fetch(900)
        self.provider.responses["day"] = usage_response(value=3)
        result = self.fetch(960)
        self.assertEqual(result["server_today"], 3)
        self.assertEqual(self.provider.login_calls, 1)
        self.assertEqual(self.provider.usage_calls[-2:], ["second", "day"])

    def test_false_login_does_not_retain_unauthenticated_session(self):
        self.provider.login = lambda **kwargs: False
        with self.assertRaises(app.EnergyCollectionFailure) as caught:
            self.fetch()
        self.assertEqual(caught.exception.stage, app.EnergyFailureStage.PROVIDER_SESSION)
        self.assertIsNone(self.state.vue)
        self.assertEqual(self.provider.usage_calls, [])

    def test_runtime_retains_one_session(self):
        with patch.object(app, "fetch_usage", return_value={}) as fetcher:
            runtime = app.build_energy_runtime(lambda: SYNTHETIC_CONFIG)
            runtime.provider()
            runtime.provider()
        self.assertIs(fetcher.call_args_list[0].kwargs["session"],
                      fetcher.call_args_list[1].kwargs["session"])
