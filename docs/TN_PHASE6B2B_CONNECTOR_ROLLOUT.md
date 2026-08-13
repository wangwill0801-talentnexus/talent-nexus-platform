# Phase 6B.2B — Talent Nexus Chrome Connector Production Rollout

## Scope and safety

This release keeps Pinpin as the system of record. The Connector observes only
the existing successful Pinpin Save callback and never calls a Pinpin write
endpoint itself. The returned numeric `ZPResumeInfo.ID` is the only candidate
identifier accepted for the TN side-car flow. No attachment BLOB, Pinpin
cookie, TN API token, Entra refresh token, client secret, or private extension
key is placed in source, release artifacts, logs, or browser persistent
storage.

## Connector identity and Entra flow

- Release version: `5000.0.115 Entra Side-car`.
- A stable public extension key is present in `working/manifest.json`; the
  private packaging key remains outside the repository.
- Stable extension ID: `ggocookfhajdgbeanphgbhfalbanhmkc`.
- Registered redirect URI: `https://ggocookfhajdgbeanphgbhfalbanhmkc.chromiumapp.org/entra`.
- Authorization Code + PKCE S256 is used with the Connector public client.
- Silent-first uses `prompt=none`; only a silent failure can open an
  interactive Entra window.
- The requested delegated scope is
  `api://03a79d54-a2a8-4a62-88ce-f1246c1d9d1d/TN.Sidecar.Write`.
- Access tokens live only in `chrome.storage.session`; no `offline_access`
  scope or refresh token is requested.

## Side-car sequence

1. Connector AI Fill completes and freezes its Standard Resume context.
2. The recruiter uses the original Pinpin Save action.
3. Only after the existing callback reports a successful numeric Candidate ID,
   and only while the matching `addFileName` context is still active, the
   Connector queues the enrichment payload.
4. The TN public API validates the Entra token and uses the existing
   least-privilege Pinpin read-only adapter to fetch exactly that source ID.
5. The existing Phase 4 reconciler creates or updates the TN baseline.
6. The existing enrichment service stores the versioned AI snapshot.

The queue is candidate-scoped, capped at five items, expires after 24 hours,
and retries network/5xx failures at most four times. Authentication and other
terminal 4xx failures are not retried indefinitely. The Options page reports
only bounded sync/auth state and never displays a token or candidate data.

## Backend deployment

`POST /api/v1/plugin-sidecar/candidate-enrichment` now uses a targeted
Pinpin-first intake service. The existing internal route remains unchanged and
continues to require the existing internal TN bearer authentication.

The `TalentNexusApi` runtime continues to bind only to `127.0.0.1:3333`.
The dedicated `LOCAL SERVICE` task identity has read/execute access to the TN
application directory, read access to the two protected TN configuration
files, and no Pinpin application-directory access. Its read-only source
configuration does not grant Pinpin writes or BLOB access.

## Automated checks

- TypeScript build passed.
- TN API automated suite passed: 50 tests.
- Targeted baseline tests verify exact-ID read, reconcile-before-enrichment,
  reader close, and missing-ID fail-closed behavior.
- Connector release-contract test verifies PKCE S256, session-only token
  storage, bounded retry/expiry, explicit HTTPS host permissions, and
  post-Save-only dispatch.
- Connector Options focused suite passed: 31 checks.
- Public `/health` returned 200; unauthenticated public side-car POST returned
  401 with a request body.

## Controlled end-to-end status

The final Entra positive-path and Pinpin-save verification requires a human
operator to load the packaged Connector and use a newly created, non-fixture
test candidate. It must not use historical Phase 4 synthetic IDs. No live
candidate was created or saved by this deployment work.
