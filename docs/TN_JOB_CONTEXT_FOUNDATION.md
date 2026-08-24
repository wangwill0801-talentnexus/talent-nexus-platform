# TN Job Context Foundation

Status: implemented on the current TN API search baseline; ready for manual
ATS Job #106 validation.

The Job Context API accepts only an exact scoped Pinpin identity:

`source_system = pinpin` + `source_instance = pinpin-prod` + numeric
`external_job_id`.

`POST /api/v1/jobs/context` stores verified title, client, description,
requirements, location, salary, source URL and supplemental text in TN. The
content fingerprint is deterministic. Optional Gemini structured intelligence
is stored separately and never changes Pinpin.

`GET /api/v1/jobs/:externalJobId` returns the stored Job Context and latest
intelligence. `POST /api/v1/jobs/:externalJobId/search` turns the verified Job
Context into the existing TN Talent Search query path. The API accepts either
the protected TN service token or the existing Entra resource-server token;
secrets and raw JD text are not logged.

Job search prefers compact structured intelligence terms over numbered raw JD
bullets, filters parser placeholders such as `1.`/`2.`, and treats
nice-to-have criteria as ranking preferences rather than hard-mismatch
penalties. This keeps broad recall while preserving explicit `mustHave` and
`mustMatchAll` behavior.

The search-quality pass also filters generic JD headers, benefits and
management/noise phrases, promotes recognized role-family aliases such as EE,
Hardware and Firmware into role-weighted criteria, and downweights standalone
generic `Engineer` terms. `POST /api/v1/jobs/:externalJobId/search` returns
`queryQuality` plus a safe `queryWarning` when the stored JD is title-only or
otherwise too sparse; sparse jobs remain searchable and are not rejected.

The two schema migrations are additive and idempotent:

- `005_job_context_foundation.sql`: `jobs`, `job_intelligence`
- `006_search_quality_workflow.sql`: search strategy and shortlist tables for
  the next UI iteration

No Connector release or Pinpin write is part of this change. A manual Golden
check remains: ATS Job #106 → Connector captures the verified Job Detail → TN
Job Context → Talent Search. Until that browser flow is checked, the
Connector remains on its existing release baseline.
