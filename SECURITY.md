# Security policy

## Supported versions

Ravenhill has not published its first stable release. Until then, only the
latest commit on the default branch is considered for security fixes. After
the first release, the latest release line and the default branch will be
supported; older release lines will not receive routine fixes.

## Report a vulnerability privately

Do not open a public issue for a suspected vulnerability, credential, private
endpoint, raw upstream response, or personal data exposure.

Use [GitHub private vulnerability reporting](https://github.com/d4rk22/ravenhill/security/advisories/new).
Include the affected revision, impact, reproduction steps using synthetic data,
and any proposed mitigation. Do not include a live credential or production
response. If private reporting is unavailable, contact the repository owner
without sensitive details and wait for a private channel before sharing them.

The maintainer will aim to acknowledge a complete report within seven days,
coordinate validation and remediation privately, and publish a security
advisory when users need to take action. Timelines depend on severity and the
availability of a safe fix.

## Security boundary

Ravenhill is a read-only aggregator, not an authentication or authorization
gateway. Review the full [privacy and deployment security boundary](docs/SECURITY.md)
before exposing a live instance. Browser privacy mode changes presentation; it
does not remove normalized data from the API or browser memory.
