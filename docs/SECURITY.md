# Privacy and security boundaries

Hrafnholt is a read-only aggregator, not a security gateway. Operators must
decide who may reach the dashboard and which normalized data those users may
see.

## Authentication and authorization

Hrafnholt currently has no built-in login, role model, or per-route
authorization. Anyone who can reach the service can request its same-origin
API. Put a live deployment behind an authenticated boundary when its data is
not intended for every network user.

Upstream collector credentials should be read-only and least-privileged. The
fact that Hrafnholt implements only read paths does not replace upstream access
control.

## Browser privacy mode

Public presentation replaces Plex usernames with randomized, per-page neutral
aliases. The optional private toggle reveals original usernames in the page.
This changes rendering only: the normalized dashboard API and browser memory
still contain the underlying usernames.

Therefore:

- public mode is useful for shoulder-surfing, demonstrations, and screenshots;
- it is not anonymization, authentication, or authorization; and
- Hrafnholt must not be exposed to a user who is not allowed to inspect the raw
  normalized response.

## Location and operational data

Stream locations are coarse but can still be personal. Panel labels, host
associations, storage state, service posture, current media, and energy usage
may also reveal operational information. Review the configured sources and
API response before widening access. A hidden panel or CSS mask does not remove
data from the API.

## Secrets

Secret references are resolved server-side and omitted from expected public
responses. The resolver suppresses values and resolved file paths in its own
errors, and logger redaction covers common authorization, cookie, password,
token, and API-key fields. These controls reduce accidental disclosure; they
cannot protect a secret that the deployment writes into a world-readable file,
passes on a command line, logs before Hrafnholt receives it, or injects into an
unrelated process.

Use the [`*_FILE` contract](SECRETS.md), service-scoped mounts, protected file
permissions, and a read-only upstream identity.

## Network behavior

Demo mode constructs no collectors and needs no upstream network. Live mode
makes outbound requests only for configured collectors and poster sources. The
browser itself uses the Hrafnholt origin and loads no remote map, font, script,
analytics, or image asset except posters returned through Hrafnholt's bounded
relay.

Collector TLS verification defaults to enabled. Disabling it permits a
man-in-the-middle attack on that upstream connection and should be a narrow,
documented exception.

## Poster relay

The Radarr poster route accepts only a configured instance identifier and a
bounded numeric movie ID. It rejects redirects, limits responses to two MiB,
and accepts only AVIF, WebP, JPEG, or PNG content types. The relay is not a
general URL proxy. Poster copyright and audience suitability remain the
operator's responsibility; no poster is part of the shipped Hrafnholt assets.

## Container hardening

The dashboard image runs as the upstream image's unprivileged `node` user. The
energy image runs as a dedicated unprivileged user. Both support a read-only
root filesystem, dropped capabilities, and `no-new-privileges`; deployments
must request those controls explicitly. Mount only required configuration,
secret, and state paths.

## Safe disclosure handling

Do not place a suspected credential, private endpoint, raw API response, or
personal screenshot in a public issue. Follow the repository
[security policy](../SECURITY.md) and use GitHub's private vulnerability
reporting channel. If private reporting is unavailable, contact the maintainer
without including sensitive details and wait for a private channel.
