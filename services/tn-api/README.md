# Talent Nexus API — Phase 3 Foundation

This is an isolated TypeScript/Fastify/PostgreSQL service. It establishes the Talent Nexus candidate-data foundation only. It does **not** connect to Pinpin, import Pinpin data, read resume BLOBs, call AI, or modify the Chrome extension.

## Prerequisites

- Node.js 22 or later
- A PostgreSQL database for running migrations (not required for the in-memory automated test suite)

## Local setup

```powershell
cd services/tn-api
npm install
Copy-Item .env.example .env
```

Set `DATABASE_URL` and `TN_API_TOKEN` in the local `.env` file. Keep `.env` outside source control and use placeholders only in `.env.example`.

## Commands

```powershell
npm run build
npm test
npm run migrate
npm start
```

Migrations are explicit. Application startup never changes the schema. `npm run migrate` applies ordered SQL files in `migrations/` and records them in `schema_migrations`.

## API

`GET /health` is intentionally minimal and does not disclose configuration or database internals.

The remaining endpoints require:

```text
Authorization: Bearer <TN_API_TOKEN>
```

| Endpoint | Purpose |
|---|---|
| `GET /api/v1/candidates?limit=25&offset=0` | Bounded candidate list; optional `candidateCode`, `name`, `company`, `title` filters. |
| `GET /api/v1/candidates/:idOrCode` | Candidate detail by UUID or `TN########` code. |
| `POST /api/v1/plugin-sidecar/candidate-enrichment` | Existing Entra-protected logical candidate intake; exact ATS identity only. |
| `GET /internal/data-browser` | Thin internal candidate-data debugger. Candidate reads require the existing TN bearer token. |

There is no general candidate CRUD API. The narrow side-car intake stores a versioned `standard_resume_v1` snapshot and its snapshot-scoped AI/evidence/processing projections after exact ATS identity resolution. Documents remain metadata/reference records only; no resume BLOB is copied or returned.

## Architecture boundary

- TN UUID is the immutable internal candidate identity.
- `candidate_code` is generated from a PostgreSQL sequence and is human-readable, unique, and never reused.
- Future Pinpin identity is stored only as `source_instance + external_candidate_id` text.
- Pinpin documents stay in Pinpin. The TN `candidate_documents` table holds metadata and a storage-provider reference only.
- Pinpin synchronization, reconciliation, plugin side-car, AI, semantic search, and matching are explicitly deferred to later phases.

## Production posture

The proposed production topology is localhost-only PostgreSQL and localhost-only API. Until a later approved reverse-proxy/authentication phase, test a local-only API over SSH forwarding, for example:

```powershell
ssh -L 3333:127.0.0.1:3333 Administrator@<vps-host>
Invoke-RestMethod http://127.0.0.1:3333/health
```

Do not expose PostgreSQL or the API by opening a public firewall port for this foundation phase.
