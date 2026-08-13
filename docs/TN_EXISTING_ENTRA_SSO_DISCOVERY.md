# Existing Entra SSO Discovery and TN Authentication Plan

## Phase 6B.2A-2A scope

This is a read-only discovery and design review. No Microsoft Entra tenant,
app registration, TNT, Hub, SOP, Chrome Plugin, TN runtime, IIS, DNS, or
certificate configuration was changed.

## Existing Talent Nexus authentication architecture

The inspected source workspaces are under
`C:\Users\William Wang\Downloads\05_專案程式碼\talent-nexus-netlify-deploy (0629`:

- TNT: `tnt-intelligence-hub`.
- Hub: `talent-nexus-hub`.
- SOP policy-agent implementation: `_policy_agent_worktree`.

TNT, Hub, and SOP use the same source-level tenant/client configuration model:
public tenant/client environment variables with matching built-in fallback
identifiers. The server-side Netlify validators use the equivalent runtime
variables and validate the same tenant/client audience. This is strong evidence
of one shared frontend Entra application registration for the three reviewed
systems, subject to deployed environment values not being read in this phase.

The administrative attendance system also uses Microsoft Entra, but through
`next-auth` MicrosoftEntraID and a separate environment-variable naming model.
Its deployed tenant/client values were not read, so shared App Registration
identity with TNT/Hub/SOP is **not verified**.

## Auth library and flow

TNT/Hub/SOP do **not** use `@azure/msal-browser` or MSAL React. They implement
Authorization Code + PKCE directly using Web Crypto, tenant-specific Microsoft
v2 OAuth endpoints, a redirect callback, state and nonce validation, and
`sessionStorage` for the ID token and transient PKCE state.

The current requested scope is `openid profile email`. The frontend exchanges
the code for an **ID token**, then sends that token to a Netlify
`auth-session` function. Server validation checks JWKS signature, issuer,
tenant, expiration/not-before, audience equal to the frontend client ID, and
company email-domain membership. TNT uses Node crypto; Hub uses `jose` `^6.2.3`.
There is no existing custom API audience, exposed API scope, or delegated API
access token contract suitable for TN API authorization.

The attendance application uses `next-auth` `^5.0.0-beta.31` with the
Microsoft Entra provider, an Entra client secret held server-side, and an
eight-hour Auth.js JWT session. That confidential-server pattern must not be
copied into the Chrome extension.

## Current SSO behaviour

- TNT legacy flow explicitly uses `prompt=select_account`. This is **NOT
  SUITABLE AS PLUGIN DEFAULT**.
- Hub attempts `prompt=none` once per browser session before rendering the
  interactive sign-in action. Its normal button does not force a prompt value.
- SOP policy-agent supports a Hub-originated silent request using `prompt=none`
  and treats `login_required`, `interaction_required`,
  `account_selection_required`, and `consent_required` as controlled fallback
  conditions. Its explicit account switch alone uses `select_account`.

The existing silent implementation is a useful UX reference but is custom
OAuth, not MSAL cache sharing. Tokens must never be copied from TNT/Hub/SOP
browser storage into the Plugin.

## Reuse decision

**SEPARATE_API_APP_REGISTRATION_RECOMMENDED.** Keep the established tenant and
employee sign-in experience, but add a dedicated TN API resource registration
instead of changing the existing TNT/Hub/SOP frontend registration into an API
resource. Add a separate Chrome Extension public-client registration in the
same tenant. This makes token audience, scope and redirect ownership explicit,
minimizes risk to the existing web applications, and prevents a client secret
from being required in the extension.

Proposed TN API audience: `api://<TN-API-APPLICATION-ID>`.

Proposed delegated scope: `TN.Sidecar.Write` (proposal only; administrator
should confirm final naming before creating it because the current source has
no API-scope naming convention). A future TN validator must verify signature,
issuer, tenant, audience, expiration and this delegated scope. It must retain
the current `TN_API_TOKEN` only for internal/operator routes.

## Future Plugin silent-first design

1. Use a valid in-memory/extension-local short-lived TN access token if one
   exists; never read TNT/Hub/SOP storage.
2. Use the Chrome public-client registration with Authorization Code + PKCE.
3. Attempt silent authorization first using known account/login hint where
   available and `prompt=none`.
4. Fall back to interactive authorization only for `login_required`,
   `interaction_required`, `consent_required`, or account-selection-required.
5. Never make `prompt=login` or `prompt=select_account` the default.
6. Send the resulting Entra **access token** to a new public TN side-car route;
   do not put a client secret or `TN_API_TOKEN` in the extension.

Chrome redirect URI requirement: `https://<extension-id>.chromiumapp.org/entra`
(or a confirmed equivalent returned by `chrome.identity.getRedirectURL`). The
Golden Manifest V3 source has no fixed `key`, so a stable extension ID must be
recorded during Phase 6B.2B before the Entra redirect URI is registered.

## Minimum future Entra Portal actions

| Portal location | Required additive action | Why | Risk / rollback |
| --- | --- | --- | --- |
| App registrations | Create a TN API resource registration in the existing tenant | Dedicated audience and scope | Does not alter TNT/Hub/SOP; delete unused new registration to roll back |
| TN API registration > Expose an API | Set Application ID URI and create the confirmed delegated scope | Lets TN verify a purpose-bound access token | Additive; do not change existing frontend scopes |
| App registrations | Create Chrome Extension public-client registration | Chrome redirect URI and PKCE public client | Additive; no client secret |
| Chrome registration > Authentication | Add the verified Chromium redirect URI | Enables code return to the installed extension | Remove only this new URI to roll back |
| Chrome registration > API permissions | Add delegated permission to TN API scope; grant consent only if tenant policy requires it | Allows the Plugin to request TN access tokens | Remove the new permission/consent to roll back |

Do not remove existing TNT/Hub/SOP redirect URIs, audiences, scopes, Netlify
environment variables, or consent grants.

## Phase 6B.2A-2B implementation scope

Planned TN changes only:

- `services/tn-api/src/config/env.ts`: additive Entra issuer, tenant, audience
  and required-scope configuration names; retain `TN_API_TOKEN`.
- New TN JWT/JWKS verifier module with cached OpenID/JWKS resolution and
  strict claims validation.
- `services/tn-api/src/app.ts`: a separate Entra-authenticated public route
  that calls the existing `PluginSidecarIntakeService`.
- Route/unit/integration tests proving issuer/audience/scope rejection,
  no internal-token disclosure, and unchanged internal side-car behaviour.
- TN auth documentation and a narrow Chrome Plugin HTTPS/Entra phase only
  after Portal approval.

The existing internal route remains bearer-token protected and continues to
reuse `PluginSidecarIntakeService` and `CandidateEnrichmentService`; no
duplicate persistence is proposed.

**PHASE 6B.2A-2A EXISTING ENTRA SSO DISCOVERY REVIEW REQUIRED.**
