# Talent Nexus API Microsoft Entra Access Token Authentication

## Scope

This document records Phase 6B.2A-2B: TN API acts as a Microsoft Entra resource server. It does not configure the Chrome Connector, browser login, redirect URI, Silent SSO, or Entra Portal.

## Topology

- Existing TNT, HUB, and SOP Entra registrations remain unchanged.
- Talent Nexus API is the protected API resource. Its tenant and API client ID are deployment configuration, not application constants.
- Talent Nexus Chrome Connector remains a future public client.

The configured API Application ID URI is `api://<TN API Client ID>` and the required delegated scope is `TN.Sidecar.Write`.

## Runtime configuration

Production reads the protected server-only file `E:\TalentNexus\config\tn-entra.env`. It contains only:

- `ENTRA_TENANT_ID`
- `ENTRA_API_CLIENT_ID`
- `ENTRA_REQUIRED_SCOPE`
- optional `ENTRA_ISSUER`

No access token, refresh token, client secret, employee credential, or `TN_API_TOKEN` copy belongs in this file. Its ACL is restricted to `Administrators` and `SYSTEM`.

## Validation

`src/auth/entra-access-token-verifier.ts` uses `jose` and tenant-specific OpenID Connect metadata. The metadata supplies the JWKS endpoint; `jose` remote JWKS handling supports Microsoft signing-key rotation.

The verifier validates:

- RS256 JWT signature;
- issuer;
- expiration and `nbf` when present;
- `tid` matches the configured tenant;
- v2 token claim `ver=2.0`;
- `aud` matches the configured Talent Nexus API **Application / Client ID GUID**;
- delegated `scp` contains `TN.Sidecar.Write`.

For Microsoft Entra v2 access tokens, the expected audience is the API client-ID GUID, not the Application ID URI. Only minimal stable principal context is exposed internally: `tid`, `oid`, optional `sub`, optional `azp`, and granted scopes. Email, name, and browser-provided identity data are not authorization inputs.

## Route split

| Route | Authentication | Purpose |
| --- | --- | --- |
| `POST /internal/plugin-sidecar/v1/candidate-enrichment` | Existing internal TN bearer | Existing operator/internal route; unchanged. |
| `POST /api/v1/plugin-sidecar/candidate-enrichment` | Entra access token + `TN.Sidecar.Write` | Future browser/Connector side-car route. |

The public route reuses `PluginSidecarIntakeService` and its existing `CandidateEnrichmentService` persistence path. It does not auto-create candidates or external references, merge identities, overwrite candidate baseline data, write to Pinpin, or call Gemini while authenticating.

Authentication failures are PII-safe `401` errors. A cryptographically valid token without the delegated scope receives `403`. CORS was not broadened.

## Explicitly deferred

- Chrome Redirect URI: **not configured**.
- Chrome auth and silent-first SSO: **not implemented**; silent-first is a hard Phase 6B.2B requirement.
- Plugin sender and HTTPS ATS recognition: **not implemented**.
- Client secret in Plugin: **forbidden**.
- `TN_API_TOKEN` in Plugin: **forbidden**.
