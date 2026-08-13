# Talent Nexus Phase 3 — PostgreSQL + Backend Foundation Report

> Status: **Phase 3A + 3B complete. PostgreSQL 17.10, the isolated `talentnexus` database, application role, reviewed migration, local-only API, and startup task are deployed and smoke-tested.**  
> Scope: independent TN foundation only. No Pinpin candidate data, attachment metadata, resume BLOB, Pinpin API, plugin, IIS, SQL Server, or production application file was changed.
>
> Note: sections 23–34 retain the initial installer-recovery chronology. Section 35 is the authoritative post-recovery Phase 3B completion record and supersedes any earlier “blocked” or “not deployed” wording.

## 1. Executive Summary

An isolated TypeScript/Fastify/PostgreSQL backend foundation now exists at `services/tn-api/`. It contains one ordered PostgreSQL migration, the Phase 2-approved entity set, strict configuration validation, protected candidate-read APIs, sanitized structured logging, and synthetic-only automated tests.

This is intentionally not a Pinpin integration. The repository does not contain a Pinpin connection string, source adapter, import path, polling loop, reconciliation job, document BLOB handling, AI feature, plugin side-car, or candidate write API.

Local TypeScript build and 8/8 automated tests pass. The mandatory VPS read-only preflight and the approved Phase 3B production deployment are complete. Phase 4 remains explicitly out of scope.

## 2. Phase Scope

Implemented: TN schema foundation, explicit migrations, configuration, database pool/repository boundary, `/health`, candidate list/detail reads, API-token foundation, local tests, README, and deployment planning.

Explicitly excluded: Phase 4 Pinpin reads/import/sync/reconciliation, all Pinpin data access, resume BLOBs, Chrome plugin changes, AI/Gemini, search UI, vector search, JD matching, CRM/ATS workflow, SharePoint, public deployment, and production writes.

## 3. Approved Phase 2 Decisions Implemented

- Internal candidate key: application-generated UUIDv7.
- Human-readable `candidate_code`: PostgreSQL sequence-backed `TN########`, unique and never reused.
- Future Pinpin identity: generic text external reference, unique on `(source_instance_id, external_candidate_id)`.
- Logical Pinpin source instance remains `pinpin-prod`; physical ports/IPs are operational metadata, not identity.
- Documents are metadata/reference records only; no BLOB/BYTEA content column exists.
- `primary_resume_document_id` is nullable and TN-owned; Pinpin preview selection is not inferred.
- Owner mapping and source taxonomy are nullable/raw/deferred.
- Source lifecycle is auditable without automatic TN hard deletion.
- Sync operational state is separate from candidate business fields.

## 4. Repository Changes

Created only under the isolated backend directory plus this report:

- `services/tn-api/package.json`, `package-lock.json`, `tsconfig.json`, `.gitignore`, `.env.example`, `README.md`
- `services/tn-api/migrations/001_phase3_foundation.sql`
- `services/tn-api/src/` configuration, database, domain, repository, validation, application, and server modules
- `services/tn-api/src/migrate.ts`
- `services/tn-api/tests/` synthetic configuration, API, migration, idempotency, document, and lifecycle tests
- `docs/TN_PHASE3_BACKEND_FOUNDATION_REPORT.md`

No existing plugin or Pinpin-related source file was modified.

## 5. Backend Stack

- Node.js 24 LTS runtime requirement (the exact major/minor used for the final Phase 3A build/test was v24.18.0)
- TypeScript with `strict: true`
- Fastify 5
- PostgreSQL through `pg` connection pooling
- Zod runtime environment/query validation
- Explicit SQL migration runner
- `uuid` UUIDv7 generation
- `pg-mem` for synthetic local PostgreSQL-compatible repository/migration tests only

No ORM, Docker requirement, NestJS, queue, event bus, Redis, Elasticsearch, GraphQL, vector extension, or microservice was added.

## 6. Backend Architecture

```text
HTTP routes → validation/auth → repository → PostgreSQL pool
                 │
                 └→ sanitized error/response contract and structured logs
```

Routes do not contain SQL. The repository uses parameterized statements. The only local helper that inserts a synthetic candidate exists for tests and is not exposed by HTTP.

## 7. PostgreSQL Schema

`001_phase3_foundation.sql` creates:

1. `source_instances`
2. `candidates`
3. `candidate_external_refs`
4. `candidate_work_experiences`
5. `candidate_educations`
6. `candidate_documents`
7. `candidate_tags`
8. `candidate_owner_mappings`
9. `candidate_sync_state`
10. `sync_runs`
11. `sync_cursors`
12. `sync_errors`
13. `source_lifecycle_events`

It also creates `candidate_code_sequence`, the migration ledger, foreign keys, constrained status values, candidate/document/external-reference uniqueness, and only Phase 3 justified indexes. Child data uses restrictive foreign keys rather than destructive candidate cascades. `primary_resume_document_id` uses `ON DELETE SET NULL` because a TN preferred-document choice must not prevent document lifecycle handling.

## 8. Candidate Identity Implementation

`candidates.id` is a UUID generated using UUIDv7 in the application. It is immutable and is the only relational primary key. The HTTP detail endpoint accepts either this UUID or a human code, but neither exposes database internals.

## 9. Candidate Code Implementation

`candidate_code_sequence` allocates monotonically increasing values. The repository formats the database-allocated number as `TN` plus eight zero-padded digits, for example `TN00000001`. It never computes `MAX()+1`; sequence gaps are acceptable and values are never reused. A bigint sequence exhaustion is practically distant, but would fail allocation rather than reuse or wrap because the sequence is `NO CYCLE`.

## 10. External Identity / Idempotency

`candidate_external_refs.external_candidate_id` is `text`. The required unique constraint `(source_instance_id, external_candidate_id)` prevents a Phase 4 source record from being mapped to two independent TN candidates. It is intentionally generic enough for opaque non-numeric IDs. No real external reference has been inserted.

## 11. Work Model

`candidate_work_experiences` supports nullable source record identity/context, company/title/department/industry raw values, dates, current-role status, description, display order, bounded raw source fields, fingerprint, and observation time. It assumes no Pinpin `updated_at` contract and contains no Pinpin mapping code.

## 12. Education Model

`candidate_educations` supports nullable source identity/context, school, raw degree/major, dates, current status, order, raw source fields, fingerprint, and observation time. It deliberately does not normalize unresolved degree/major codes.

## 13. Document Model

`candidate_documents` supports multiple metadata-only documents per candidate: optional source/document identity, provider/reference, filename/type/extension/size, role/status, source and observation times, and bounded metadata. A partial unique index applies only when both source instance and external document ID exist. There is no BLOB, BYTEA, resume text, retrieval API, or Pinpin attachment access.

## 14. Tags

`candidate_tags` is intentionally lightweight: candidate, tag, optional tag type, origin, and creation time. It is not a skills ontology, hierarchy, synonym system, or search engine.

## 15. Owner Deferred Contract

`candidate_owner_mappings` is nullable for source instance, source owner ID/raw value, and future TN owner user ID. It records a constrained mapping status but creates no unverified Pinpin user relationship and does not populate owner data.

## 16. Lifecycle Model

`source_lifecycle_events` records source observations and events (`observed`, `activated`, `deactivated`, `deleted`, `restored`, `archived`, `unknown`). Candidate rows are not automatically deleted when a source is inactive/deleted. This preserves the Phase 2 distinction between source lifecycle and TN canonical lifecycle.

## 17. Sync Operational Tables

`sync_runs`, `sync_cursors`, `candidate_sync_state`, and `sync_errors` are schema-only operational foundations. They support future run types without executing any: `initial_import`, `fast_sync`, `reconciliation`, `plugin_observation`. Error records permit only sanitized messages; connection strings, tokens, resume text, and full candidate payloads are forbidden by design and convention.

## 18. API Implementation

| Endpoint | Auth | Result |
|---|---|---|
| `GET /health` | none | minimal service/database connectivity state only |
| `GET /api/v1/candidates` | bearer `TN_API_TOKEN` | bounded offset pagination and optional exact code / basic name/company/title filters |
| `GET /api/v1/candidates/:idOrCode` | bearer `TN_API_TOKEN` | core candidate plus external refs, work, education, document metadata, and tags |

All successful payloads use `{ "data": ... }`; list responses add `pagination`; sanitized errors use `{ "error": { "code", "message" } }`. Candidate mutation endpoints do not exist.

## 19. Authentication Foundation

Protected routes require an exact server-side `Authorization: Bearer <TN_API_TOKEN>` match. `/health` is intentionally unauthenticated and minimal. This is a bootstrap service-token boundary, not a future user/IAM system; it does not add Microsoft/Google login or any frontend/plugin storage of secrets.

## 20. Configuration / Secret Handling

Required configuration: `TN_ENV`, `TN_HOST`, `TN_PORT`, `DATABASE_URL`, and `TN_API_TOKEN`. Configuration is runtime-validated, and failure names invalid fields only. `.env.example` contains placeholders only; `.env` is ignored. Database URLs and tokens are not logged, returned, or documented with real values.

## 21. Tests

The synthetic-only automated suite covers:

1. configuration failure for missing database URL/token
2. valid configuration parsing
3. unauthenticated minimal health response
4. bearer protection and bounded list pagination
5. identifier validation and sanitized 404 contract
6. UUIDv7 candidate creation plus sequence-backed candidate codes
7. external-reference uniqueness and multiple metadata-only documents
8. source deactivation lifecycle without candidate deletion

No test uses a real Pinpin candidate, Pinpin document, real email, phone, resume, credential, or production database.

## 22. Local Build Results

Final local commands completed successfully:

```text
npm run build  → TypeScript strict build passed
npm test       → 8 passed, 0 failed
```

The workstation has no local `psql` or Docker. Migration/repository tests use `pg-mem` with explicit compatibility shims for PostgreSQL functions/operators that the test library does not bundle. This proves the migration structure and repository behavior synthetically, but does not replace a real PostgreSQL migration smoke test after deployment approval.

## 23. VPS Preflight

Read-only SSH preflight was completed without querying `HiBole-2`, reading candidate data, or changing VPS state.

| Check | Result |
|---|---|
| OS | Windows Server 2019 Standard, 64-bit |
| RAM | 16 GB |
| C: free | about 10.1 GB |
| E: free | about 147.1 GB |
| Existing Node runtime | not found |
| Existing PostgreSQL service/install directory | not found |
| Port 5432 listener | none |
| Port 3333 listener | none |
| Proposed `E:\TalentNexus*` directories | not present |
| Pinpin SQL Server / IIS services | `MSSQLSERVER` and `W3SVC` running/automatic |
| Firewall profiles | enabled; no requested change |

## 24. Production Deployment Plan

The proposed isolated deployment is deliberately local-only:

- PostgreSQL **17.10**, selected because PostgreSQL 17 remains supported and the official Windows installer lists Windows Server 2019 as a tested platform. PostgreSQL 18 is not selected because the installer support table does not list Server 2019. Use the official EDB-hosted Windows installer linked from the PostgreSQL Windows download page.
- PostgreSQL service: `postgresql-x64-17`
- TN database: `talentnexus`
- TN application role: newly generated least-privilege `tn_app` role; no password printed/stored in repository
- PostgreSQL port/listen: `5432`, `127.0.0.1` only
- PostgreSQL data directory: `E:\TalentNexusData\PostgreSQL\17\data`
- Application directory: `E:\TalentNexus\tn-api`
- Protected config: `E:\TalentNexus\config\tn-api.env`, ACL limited to Administrators, SYSTEM, and the approved task identity
- Logs: `E:\TalentNexusLogs\tn-api.log`
- Node runtime: Node.js 24.18.0 LTS, matching the final Phase 3A build/test runtime
- TN API: `127.0.0.1:3333` only
- Startup: one Windows Task Scheduler startup task, `TalentNexusApi`, launched as a local-only TN process with restart-on-failure settings and redirected local logs. No third-party process manager is proposed.

Testing a loopback-only API, if needed later, uses SSH port forwarding rather than a public firewall opening.

## 25. Production Deployment Changes

The user explicitly approved Phase 3B with the required loopback/security constraints. One approved TN-only component was installed successfully:

- Node.js **v24.18.0** at the standard Windows program location.

No other production application component was created. In particular, no TN application/config/log directory, PostgreSQL data directory, PostgreSQL service, database, role, migration ledger, API process, API scheduled task, firewall rule, or Pinpin-related component exists.

Temporary official installer media and current-run installer/debug logs were removed after the PostgreSQL installation failure. No generated credential was returned or retained in source/report output.

## 26. PostgreSQL Deployment

**BLOCKED — NOT DEPLOYED.** The official signed PostgreSQL 17.10 EDB installer was downloaded to the VPS temporary directory and its signature was valid. Multiple unattended invocations with only approved components (`server,commandlinetools`), explicit service name, approved E: data path, loopback port, and compliant generated passwords ended with installer exit code 1.

The installer did not create any PostgreSQL binary directory, service, data directory, database, application role, listener, pgAdmin, or StackBuilder component. No alternate PostgreSQL package, manual binary/service installation, firewall change, or additional Windows identity was introduced. The installer and diagnostic artifacts were removed.

## 27. API Deployment

**NOT DEPLOYED.** It depends on the TN PostgreSQL foundation. No API application files, secrets, node modules, scheduled task, listener, or logs were created on the VPS.

## 28. Smoke Test Results

**NOT RUN — PostgreSQL deployment is unavailable.** The only completed production runtime verification is `node --version = v24.18.0`. Planned PostgreSQL/API smoke tests remain pending.

## 29. Pinpin Regression Check

No TN PostgreSQL/API component reached a state capable of interacting with Pinpin. Existing SQL Server/IIS services were not modified; no Pinpin file, configuration, database, API, candidate data, or service was touched.

## 30. Security Review

- TN is separate from `HiBole-2`, SQL Server, Pinpin IIS paths, and Pinpin configuration.
- No Pinpin BLOB/document data is copied.
- PostgreSQL and API are proposed as loopback-only with no firewall change.
- API token/database URL stay outside Git/source/logs.
- Queries are parameterized; query fields are allowlisted and bounded.
- Request logging includes generated request ID, route template, status, latency, and sanitized error name only; it avoids headers, authorization, query text, response body, email/phone, raw metadata, and resume text.
- Application startup does not mutate schema; migrations are explicit.

## 31. Rollback Procedure

If Phase 3B is later approved and requires rollback, affect TN-created components only:

1. stop/disable and remove `TalentNexusApi` scheduled task;
2. stop TN API process and remove `E:\TalentNexus\tn-api`, config, and log directories after preserving approved operational evidence;
3. revoke/drop the TN-only application role and `talentnexus` database only after explicit confirmation that no TN data must be retained;
4. uninstall PostgreSQL 17 only if it was installed solely for TN and no approved TN data needs retention.

Never modify IIS, Pinpin, SQL Server, `HiBole-2`, or Pinpin data to roll back TN.

Current partial-deployment state: temporary PostgreSQL installer/debug artifacts have already been removed and no PostgreSQL components exist. Node.js v24.18.0 remains because it was an approved prerequisite and did not create a conflict. If the user chooses to abandon Phase 3B, Node.js can be removed in a separately confirmed TN-only cleanup.

## 32. Known Limitations

- No real PostgreSQL migration has run because no local PostgreSQL exists and the approved PostgreSQL installer failed before creating a service.
- No actual API server process has connected to PostgreSQL yet; HTTP contract tests use Fastify injection and a stub repository.
- Node.js v24.18.0 is now installed on the VPS; PostgreSQL and all TN API components remain absent.
- Existing backup protection for `E:\TalentNexusData\PostgreSQL\17\data` could not be verified because the data directory was never created. No backup configuration was changed.
- The API is intentionally read-only and has no candidate data until a future Phase 4 import.
- Owner mapping, source taxonomy, archive semantics, merge/reseed behavior, and Pinpin preview persistence remain unresolved by design.

## 33. Deferred Phase 4+ Work

Pinpin read-only source adapter, initial candidate import, incremental signals, reconciliation, production source mapping, attachment metadata access, Plugin side-car, user authentication, UI/search, taxonomy/skills, AI, vector search, JD matching, duplicate/merge workflow, and any document archive are deferred.

## 34. Phase 4 Readiness

**RED.** The local code/schema/API foundation is ready, but production PostgreSQL 17.10 could not be installed through the approved official installer, so there is no TN database, migration verification, or API deployment. Phase 4 must not begin. Even after Phase 3 is repaired and rated GREEN, Phase 4 requires a separate explicit user instruction.

---

## Production deployment status

The required local implementation, tests, VPS preflight, manual PostgreSQL recovery, and approved Phase 3B deployment are complete. The authoritative final state is recorded below.

## 35. Phase 3B Completion Record — Authoritative Final State

### 35.1 Production components

- PostgreSQL `17.10` service `postgresql-x64-17`: running automatically.
- PostgreSQL data directory: `E:\TalentNexusData\PostgreSQL\17\data`.
- PostgreSQL listener: `127.0.0.1:5432` only.
- Isolated TN database: `talentnexus`.
- Dedicated runtime role: `tn_app`; the API does not run as `postgres`.
- Protected runtime configuration: `E:\TalentNexus\config\tn-api.env`; its contents were never read back, printed, logged, or committed.
- API application: `E:\TalentNexus\tn-api` using Node.js `v24.18.0`.
- API log directory: `E:\TalentNexusLogs`.
- Startup task: `TalentNexusApi`, running as `LOCAL SERVICE` with a boot trigger and restart-on-failure settings.

### 35.2 Migration and database verification

The reviewed `001_phase3_foundation.sql` migration applied once through the application role. The migration ledger contains one entry. Read-only schema verification confirmed 13 expected TN tables, 22 foreign keys, 56 constraints, and 36 indexes.

The `candidates.id` column is `uuid`; `candidate_code_sequence` exists; and the unique external identity constraint on `(source_instance_id, external_candidate_id)` exists. No Pinpin connection, source instance, candidate, document, or BLOB data was inserted. The candidate count at smoke-test time was zero.

### 35.3 API smoke tests

- Application-role database connectivity: pass.
- `GET /health`: HTTP 200.
- Authenticated `GET /api/v1/candidates?limit=1&offset=0`: HTTP 200 with total `0`.
- Unknown valid candidate code: HTTP 404 with `CANDIDATE_NOT_FOUND`.
- No temporary synthetic production candidate was needed or created.

### 35.4 Network, task, and access controls

- PostgreSQL listens only on `127.0.0.1:5432`.
- TN API listens only on `127.0.0.1:3333`.
- No enabled Windows Firewall rule was found for TCP 5432 or 3333; no firewall rule was added.
- The runtime account has read/execute access to the TN application, read access to the protected TN configuration file, and modify access only to TN logs. It has no granted Pinpin/IIS/SQL Server application access.

### 35.5 Pinpin regression and boundary verification

`MSSQLSERVER`, `W3SVC`, and `postgresql-x64-17` are running with automatic startup. Local read-only checks returned HTTP 200 from both existing Pinpin web applications on ports 5678 and 5679. No IIS setting, SQL Server setting, HiBole-2 data, Pinpin file, Pinpin API, Chrome Plugin, candidate record, resume BLOB, or public firewall setting was changed by Phase 3B.

### 35.6 Backup follow-up

Existing backup-related scheduled tasks were visible, but their task definitions did not provide safe, explicit evidence that `E:\TalentNexusData` is covered. No backup configuration was changed. Confirming backup inclusion and performing a restore drill are operational follow-ups before relying on TN for durable production data.

### 35.7 Final readiness and limits

**Phase 4 readiness: GREEN WITH EXPLICIT GATE.** The Phase 3 foundation is operational, but Phase 4 must not start without a separate approval. Pinpin read/import/sync, document access, AI, search, plugin integration, public API exposure, user authentication, and all candidate population remain deferred.
