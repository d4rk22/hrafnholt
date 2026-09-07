# Optional Emporia energy setup

Use this only if you have an Emporia Vue account and want the **Energy ledger**.
Other dashboard connections do not need this extra service.

Emporia setup needs your device ID, channel selectors, and electricity rates.
If you do not know them yet, start with the main [setup guide](SETUP.md) and add
energy later. Device/channel numbers in the example are made up; they will not
match your installation automatically. See the [energy configuration reference](../CONFIGURATION.md#energy-configuration).

## A complete two-service example

The [examples/energy](../examples/energy) folder contains a complete Compose
file and matching configuration. The dashboard and energy service share a
private Docker network and read the same settings. Only the energy service
receives Emporia credentials; its port is not exposed on the host.

1. Download and extract the project ZIP as in [the setup guide](SETUP.md#1-get-the-starter-files).
   Copy **examples → energy** to a separate folder. These files are an
   alternative to the basic starter; do not overwrite a working installation.
2. Open its `hrafnholt.yml`. Replace `device_id` and all three `channels` values
   with your Emporia device ID and channel selectors. Keep selectors quoted.
   Set currency, taxes, fixed charge, and seasonal per-kWh prices to match your
   electricity bill. Set `presentation.timezone` to your local IANA time zone
   (for example, `Europe/London`); it also affects seasonal rates and monthly
   projections. Channel discovery depends on your Emporia setup; the
   [PyEmVue documentation](https://github.com/magico13/PyEmVue#usage) describes
   retrieving devices and channels. Do not guess selectors from the display
   names shown in the Emporia app.
3. Create a **secrets** folder beside `compose.yaml`. Put your Emporia login
   username in **energy_username.txt** and password in **energy_password.txt**,
   with no quotes. Keep both files private and out of Git and support requests.
   On standard Linux Docker, grant only the energy service user access:

   ```bash
   sudo chown 10001:10001 secrets/energy_username.txt secrets/energy_password.txt
   sudo chmod 400 secrets/energy_username.txt secrets/energy_password.txt
   ```

   For Docker Desktop or custom user mappings, see [file permissions](SECRETS.md#file-permissions).
4. Stop the basic starter first if it is using port 3000. Open a terminal in
   the energy example folder and run:

   ```bash
   docker compose up -d
   docker compose ps
   ```

5. Open [http://localhost:3000](http://localhost:3000). Allow a few minutes for
   the first provider request. Check that the Energy ledger contains your
   readings. If it stays unavailable, inspect both services:

   ```bash
   docker compose logs --tail=30 energy dashboard
   ```

An `Up` or `healthy` container alone does not prove the Emporia login, channels,
or measurements are correct. Check the Energy ledger and its source status.
Rates and channel choices affect the estimates; compare a reading with the
Emporia app before relying on the totals.

## Add energy to an existing setup

Keep your existing settings and state volume. Copy the `energy` service and
its two secret declarations from the example into your Compose file. Add the
`energy` collector and top-level `energy` settings to your existing
`hrafnholt.yml`; do not create duplicate top-level sections. Put the two secret
files in your existing secrets folder, then recreate the services using the
same Compose project and optional files you already use.

The internal address `http://energy:8080` works when both services share the
Compose network. Do not replace it with `localhost`. No dashboard credential
is needed for that internal connection. Keep both image digests on the same
release when updating.
