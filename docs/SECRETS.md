# Provider-neutral secret injection

Ravenhill names secrets in typed configuration but never embeds a secret
manager SDK. The deployment platform resolves those names into either a direct
environment variable or a mounted file.

For this configuration field:

```yaml
api_key_ref: TELEVISION_API_KEY
```

Ravenhill accepts exactly one of:

```text
TELEVISION_API_KEY_FILE=/run/secrets/television_api_key
TELEVISION_API_KEY=synthetic-local-value
```

The `*_FILE` form is the production interface. The direct form is for local
development and compatibility. Setting both fails startup rather than choosing
one silently.

## Resolution contract

- A reference is an uppercase environment-variable name and cannot itself end
  in `_FILE`.
- Only references used by enabled collectors are resolved.
- The dashboard and energy sidecar resolve independent, service-scoped sets.
- Files are read once per process and one trailing `LF`, `CRLF`, or `CR` is
  removed.
- Missing, empty, unreadable, ambiguous, or NUL-containing values fail closed.
- Errors name the reference and interface but suppress the secret value and
  resolved file path.
- Secret references and values are omitted from health, public configuration,
  normalized snapshots, and expected logs.
- References are data only. Ravenhill performs no shell, command, template, or
  arbitrary variable evaluation.

## Platform patterns

Any platform that can mount a file can use the same interface:

| Platform | Typical pattern |
| --- | --- |
| Docker Compose or Swarm | Mount a secret under `/run/secrets` and set the matching `*_FILE` variable |
| Kubernetes | Mount a Secret volume and point `*_FILE` at one key file |
| systemd | Use a credential file and expose its path through `*_FILE` |
| Vault, OpenBao, or cloud agents | Render a short-lived file into a service-only mount |
| Encrypted configuration tooling | Decrypt outside Ravenhill into a protected runtime file |

Ravenhill does not require or prefer a particular vendor. Rotation, audit,
transport, file ownership, and revocation remain deployment responsibilities.

## Local development

`.env.example` contains only synthetic values. Copying it to ignored `.env` is
convenient for `npm start`, but a plaintext environment file is not the
production recommendation. Never commit `.env`, secret files, resolved
configuration, shell transcripts containing values, or screenshots of a
secret manager.

## Least scope

Inject each secret only into the process that consumes it. In particular, the
energy provider username and password belong in the sidecar, not the dashboard
service. Upstream accounts and tokens should be read-only and limited to the
smallest endpoint set the collector requires.
