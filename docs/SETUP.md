# Set up your own Hrafnholt dashboard

Start with the [quick demo](../README.md#try-it-first) if you have not seen the
dashboard yet. You do not need to build anything or install Node.js or Python.
This guide uses Docker Compose: a file that tells Docker how to run Hrafnholt.

You will edit a text file to connect services. Hrafnholt does not discover them
automatically, and there is no setup wizard in the browser.

## 1. Get the starter files

1. Install and start [Docker](https://docs.docker.com/get-started/get-docker/).
   Docker Desktop includes Compose. Linux users need the
   [Compose plugin](https://docs.docker.com/compose/install/).
2. [Download the project ZIP](https://github.com/d4rk22/hrafnholt/archive/refs/heads/main.zip)
   and extract it. Open the extracted folder, then **examples → compose**.
3. Copy that **compose** folder somewhere you want to keep your dashboard,
   such as a new **Hrafnholt** folder in Documents. Work in this copy so an
   update to the project cannot overwrite your settings.
4. Open a terminal in your copied folder. On Windows, right-click inside it
   and choose **Open in Terminal**. On Mac, type `cd ` (including the space)
   into Terminal, drag the folder into the window, and press Enter. On Linux,
   use your file manager's **Open in Terminal** action.

You should see these files in that folder:

| File | What it does |
| --- | --- |
| `compose.yaml` | Runs the dashboard and keeps its saved state |
| `hrafnholt.yml` | Your active settings; starts with sample data |
| `hrafnholt.kuma.yml` | Ready-made settings for Uptime Kuma |
| `hrafnholt.sonarr.yml` | Ready-made settings for Sonarr |
| `compose.sonarr.yaml` | Adds a Sonarr API-key file when you choose that example |

The images in these examples are pinned to tested release **v0.1.15**. Keep the
long `image:` value as supplied. You do not need a GitHub account or registry
login. Published images target Linux x86-64; see the
[platform note](../README.md#try-it-first) if you use an ARM device.

## 2. Start the sample dashboard

If the quick demo is still running, stop it first with Ctrl+C in its terminal.
Run this from your copied folder:

```bash
docker compose up -d
```

Open **[http://localhost:3000](http://localhost:3000)** on this computer. Allow
about a minute for startup after the first image download. You should see
**SYNTHETIC DEMO** and populated panels. This is sample data, not a connection
to your equipment yet. You can close the terminal; Compose keeps it running.

If it does not open, run:

```bash
docker compose ps
```

Look for `dashboard` with `Up` and eventually `healthy`. If it is restarting
or missing, read its recent messages:

```bash
docker compose logs --tail=30 dashboard
```

## 3. Connect your first service

Choose **one** of the examples below. You do not need Uptime Kuma if you choose
Sonarr, or Sonarr if you choose Uptime Kuma. Use only services you already have.

### Option A: Uptime Kuma — no API key needed

This fills the **Service health** panel using an Uptime Kuma status page.
It does not require sharing that page on the Internet; Hrafnholt only needs
to reach it on your network without logging in.

1. In Uptime Kuma, open **Status Pages**. Choose an existing page that includes
   your monitors, or create one, add a group and monitors, and save it. Follow
   [Uptime Kuma's status-page guide](https://github.com/louislam/uptime-kuma/wiki/Status-Page)
   if you have not made one before.
2. Open that status page and note its address. For an address like
   `https://status.example/status/home`, the base address is
   `https://status.example` and the page name (also called its slug) is `home`.
3. In your Hrafnholt folder, open `hrafnholt.kuma.yml` in a plain-text editor.
   Notepad works on Windows; on Mac use TextEdit's **Format → Make Plain Text**.
   Change just these two values to match your page:

   ```yaml
   url: https://status.example
   status_page_slug: home
   ```

   Keep the indentation and use spaces, not tabs. Include the port in `url`
   if the address needs one. Use the same `http` or `https` as your service.
4. Save the file, then copy it over the active settings. This command works
   in PowerShell and Mac/Linux terminals:

   ```bash
   cp hrafnholt.kuma.yml hrafnholt.yml
   docker compose up -d --force-recreate
   ```

5. Refresh the dashboard and wait up to a minute. **Service health** should
   show **Uptime Kuma** with your up/down counts. The footer should no longer
   say **SYNTHETIC DEMO**. Other sources will be unconfigured — that is expected.

If the counts stay unavailable, check that the status page opens without
logging in and includes monitors. Inside a container, `localhost` means the
container itself, not your computer. See [connection problems](#connection-problems).

### Option B: Sonarr — use your API key

This fills **Today's episodes**. An empty calendar can be correct if nothing
is scheduled today; use its date arrows to check another day.

1. Open `hrafnholt.sonarr.yml`. Replace `https://sonarr.example` with the base
   address of Sonarr, including its port if needed. Use a dedicated hostname
   or direct host and port: path-prefixed addresses such as
   `https://host.example/sonarr` are not supported by this collector.
   Leave `api_key_ref: SONARR_API_KEY` as-is: it is a label, not the key itself.
2. Create a folder named **secrets** alongside `compose.yaml`. Inside it,
   create a plain-text file named **sonarr_api_key.txt**. In Sonarr, find
   **Settings → General → Security → API Key**. Put just that key in the file,
   without quotes. Make sure the file has not become `sonarr_api_key.txt.txt`.
   Keep it private; never upload it with a bug report or commit it to Git.
3. On a standard Linux Docker host, make that file readable only by the
   dashboard's service user (numeric user ID 1000):

   ```bash
   sudo chown 1000:1000 secrets/sonarr_api_key.txt
   sudo chmod 400 secrets/sonarr_api_key.txt
   ```

   On Docker Desktop for Mac/Windows, keep the folder accessible only to your
   user account and allow Docker Desktop to access it if prompted. Rootless
   Docker or a NAS with custom permissions may need the
   [secret-file permissions guidance](SECRETS.md#file-permissions).
4. Apply the Sonarr settings and start with the additional Compose file:

   ```bash
   cp hrafnholt.sonarr.yml hrafnholt.yml
   docker compose -f compose.yaml -f compose.sonarr.yaml up -d --force-recreate
   ```

5. Refresh the dashboard. Allow up to a minute, then look for your Sonarr data
   and the absence of **SYNTHETIC DEMO**. If the source reports an error, check
   the URL and API key; if the container cannot start, check the file name and
   permissions. Do not paste your key into logs or support requests.

While using Sonarr, use `-f compose.yaml -f compose.sonarr.yaml` in Compose
commands that create or update the service. This ensures its key stays mounted.
Sonarr API keys can grant more than read access; Hrafnholt only reads from Sonarr,
so protect the key as carefully as you protect Sonarr itself.

## Add more services later

Open your active `hrafnholt.yml` and add another entry under `collectors:`.
Do not add a second `collectors:` heading. The
[connection reference](COLLECTORS.md) lists required fields, and the
[configuration reference](../CONFIGURATION.md) explains their values.
Each service requiring a credential also needs its own secret-file mount and
matching `*_FILE` variable, following the Sonarr example.

The optional [Emporia energy setup](ENERGY-SETUP.md) runs the energy service
alongside the dashboard. You do not need it for media, network, or server panels.

You can change your dashboard title, language, and time zone in the
`presentation` section. After saving settings, recreate the container so it
reads the updated file:

```bash
docker compose up -d --force-recreate
```

Use the extra Sonarr `-f` options above if that connection is enabled.
If using UniFi PDU history, set `pdu.state_path` to
`/var/lib/hrafnholt/rack-power-samples.json`; the supplied Compose file keeps
that directory in a persistent Docker volume across container replacements.

## Stop, restart, or update

Run these in the folder containing your `compose.yaml`:

| What you want | Command |
| --- | --- |
| Stop temporarily | `docker compose stop` |
| Start again after stopping | `docker compose start` |
| Check whether it is running | `docker compose ps` |
| Read recent startup messages | `docker compose logs --tail=30 dashboard` |
| Remove the containers while keeping saved state | `docker compose down` |

Your settings and secret files remain in your folder. The state volume is
retained by `down`; do not add `--volumes` unless you intend to delete its data.

For updates, read the [release notes](https://github.com/d4rk22/hrafnholt/releases).
Save a copy of your current Compose file, replace its `image:` digest with the
verified digest for the chosen release, then run `docker compose up -d` (with
any optional `-f` files). Keep your existing `hrafnholt.yml`, secrets, and volumes;
do not overwrite them with a fresh starter folder. There is no automatic
`latest` update. See [image verification](RELEASING.md#container-publication).

## Open from another device

By default only the device running Docker can open the dashboard. On a remote
server, you can keep that default and use an SSH tunnel, or configure a reverse
proxy with authentication and HTTPS. `localhost` on your phone is your phone,
not your Docker server.

To allow direct access on a trusted LAN, replace `127.0.0.1:3000:3000` with
`3000:3000` under `ports:` and recreate the service. Open port 3000 on your
Docker server's network address. This listens on all host interfaces: restrict
access with your firewall and do not forward that port from your router.
**There is no built-in login.** Use authentication and HTTPS before sharing live
data with untrusted users. [Security details](SECURITY.md).

## Connection problems

| What you see | What to check |
| --- | --- |
| `no configuration file provided` | Run Compose from the folder containing `compose.yaml`. |
| Bind-mount path missing / not a directory | Keep `hrafnholt.yml` next to `compose.yaml`; check that your editor did not append `.txt`. |
| Port 3000 already in use | Stop the quick demo, or change the left-hand port to `127.0.0.1:3001:3000` and browse to `http://localhost:3001`. |
| Configuration error on startup | Keep YAML indentation, use spaces, and match the example's field names exactly. |
| Secret could not be read | Check the secret-file name, file permissions, and that both Sonarr Compose files were supplied. |
| Service is reachable in a browser but not Hrafnholt | Use an address reachable from the container. On Docker Desktop, `host.docker.internal` reaches a service on the host computer; for another device, use its network address. For another Compose service, use its service name on a shared Docker network. |
| TLS/certificate error | Use an address with a certificate trusted by the container; do not turn off certificate checks as a routine fix. |
| `healthy` container, but one panel reports an error | Container health only means Hrafnholt is running. Check that panel's upstream address and credentials. |

More help: [Troubleshooting](TROUBLESHOOTING.md). For a support request, share the
Hrafnholt version, Docker platform, and error message with private details removed.
Never include API keys, secret files, or an unredacted live dashboard screenshot.
