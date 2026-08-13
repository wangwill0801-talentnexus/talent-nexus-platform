# TN Public Domain Edge

## Target Architecture

```text
Internet
  -> HTTPS
  -> tn-api.talentnexus.com.tw
  -> IIS TalentNexusApiEdge
  -> 127.0.0.1:3333
  -> TN Fastify API
```

- Required hostname: `tn-api.talentnexus.com.tw`
- VPS public IP: `103.144.32.63`
- Existing `api.talentnexus.com.tw`: Netlify; **UNCHANGED**

## Phase 6B.2A-1 Completion - 2026-08-12

The administrator confirmed the GoDaddy record `tn-api` -> `103.144.32.63`
and public Google recursive resolution before this deployment. Per the
administrator instruction, this phase did not repeat the completed DNS lookup.

### Installed approved components

- Microsoft IIS URL Rewrite (x64 MSI from Microsoft Download Center).
- Microsoft IIS Application Request Routing (ARR) (x64 MSI from Microsoft
  Download Center).
- win-acme `2.2.9.1701` x64 pluggable release from the official win-acme
  GitHub release. The downloaded archive SHA-256 was recorded on the VPS
  during installation. The release ZIP did not provide a publisher digest, and
  `wacs.exe` has no Authenticode publisher signature; its official release
  origin and executable presence were therefore verified instead.

No unrelated IIS module, pgAdmin, StackBuilder, Defender exclusion, firewall
rule, Pinpin component, Entra setting, Plugin setting, Gemini setting, or
existing `api.talentnexus.com.tw` configuration was changed.

### Scoped IIS edge

- IIS site: `TalentNexusApiEdge`.
- Isolated physical directory: `E:\TalentNexus\tn-api-edge`.
- HTTP binding: `*:80:tn-api.talentnexus.com.tw`.
- HTTPS binding: `*:443:tn-api.talentnexus.com.tw` with SNI enabled.
- HTTP behavior: all ordinary requests return `301` to the same HTTPS URL;
  `/.well-known/acme-challenge/` remains reachable for ACME HTTP-01 renewal.
- Reverse-proxy target: `http://127.0.0.1:3333/{path}` only.
- ARR's server-level `proxy.enabled` setting was changed from `false` to
  `true`. This only enables proxy capability; no rewrite rule, binding or
  content was added to an existing Pinpin site. The only proxy rule is in the
  isolated TN site `web.config`.

### Certificate and renewal

A production Let's Encrypt certificate was issued for exactly
`tn-api.talentnexus.com.tw`, installed in LocalMachine `My`, and bound only to
the scoped IIS site. The certificate subject matches the hostname, its issuer
is Let's Encrypt, and the HTTPS request completed with normal TLS verification.

win-acme created the Task Scheduler job
`win-acme renew (acme-v02.api.letsencrypt.org)`. It runs `wacs.exe --renew`
from `E:\TalentNexus\win-acme`, is currently `Ready`, and is persisted for
post-reboot automatic renewal. No wildcard or ATS certificate was requested.

### Verification evidence

- `https://tn-api.talentnexus.com.tw/health` -> HTTP `200`.
- External TLS validation -> success (`ssl_verify_result=0`) with the public
  endpoint resolving to `103.144.32.63`.
- `http://tn-api.talentnexus.com.tw/health` -> HTTP `301` to HTTPS.
- An authenticated existing TN candidate-list request through HTTPS returned
  `200`, proving `Authorization` header preservation without exposing the
  runtime token.
- An unauthenticated `POST` to the existing side-car route returned `401`;
  no anonymous side-car write is possible.
- External TCP attempts to public `103.144.32.63` for 3333, 5432 and 1433
  all failed. The VPS listeners remain `127.0.0.1:3333` (Fastify) and
  `127.0.0.1:5432` (PostgreSQL); SQL Server TCP 1433 has no listener.
- `TN /health`, Pinpin Chinese `/webapp/`, and Pinpin English `/webapp/` all
  returned `200`; IIS/W3SVC, SQL Server and PostgreSQL remain running.

### Future Boundary

- Entra SSO: **NOT IMPLEMENTED**
- Silent-first SSO: **REQUIREMENT FOR NEXT PHASE**
- Chrome Plugin sender/authentication: **NOT IMPLEMENTED**
- Candidate Search: **NOT IMPLEMENTED**

The public edge preserves `Authorization` headers. It does not add broad CORS,
expose `TN_API_TOKEN`, or make the internal side-car route anonymous. No
side-car expansion, Canonical Profile, Candidate Search, embeddings, scheduled
sync or later phase is authorized by this deployment.
