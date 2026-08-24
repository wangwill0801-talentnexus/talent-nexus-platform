# TN Job Context Deployment Report

Date: 2026-08-22

## Result

The additive Job Context runtime and the follow-up search-quality hotfix were
deployed on the existing TN API search baseline. No Pinpin, IIS, SQL Server,
Connector or Entra configuration was changed.

## Runtime

- Initial Job Context archive: `tn-api-job-context-20260822165037.zip`
- Search-quality archive: `tn-api-search-quality-20260822172043.zip`
- Search-quality SHA-256: `829A5B85F04B68EC2D135169C851EA06713D712C5BA062B71475E81E8571C432`
- Current search-recall archive: `tn-api-search-recall-20260822175113.zip`
- Current search-recall SHA-256: `E73058A3646E06EDFF1F7F3165EC529DA9D69BC6BCA92A0082FCED799D2A11FC`
- `TalentNexusApi`: Running
- `TalentNexusProcessingWorker`: Running
- `/health`: 200
- Chinese ATS `/webapp/`: 200
- English ATS `/webapp/`: 200
- Public 3333, 5432 and 1433: closed

## API surface

The API now exposes protected, exact-scoped routes:

- `POST /api/v1/jobs/context`
- `GET /api/v1/jobs/:externalJobId`
- `POST /api/v1/jobs/:externalJobId/search`

Identity is `pinpin + pinpin-prod + numeric external_job_id`. The job search
route delegates to the existing Talent Search service; the Connector remains
outside this release.

## Database

The production migration ledger contains `005_job_context_foundation.sql` and
`006_search_quality_workflow.sql`. The four additive tables are present and
the schema metadata check found 48 constraints. No candidate rows or Pinpin
data were read or modified by this deployment.

## Validation

- TN API tests: 108/108 PASS
- TypeScript build: PASS
- Route smoke: health 200, unauthorized Job request 401, invalid context 400,
  Job #106 read 200, Job #106 search 200, candidate API 200, search coverage
  200, unknown candidate 404
- Production restart completed through the existing `TalentNexusApi` task;
  the deployment script verified the API remained bound to localhost only.
- Job Context search now prefers structured intelligence terms over raw
  numbered JD bullets, removes numbered/generic AI parser placeholders, and
  does not penalize missing nice-to-have preferences as hard requirements.
- Search criteria now discard generic JD/benefit/management noise, promote
  recognized role-family aliases (for example EE, Hardware and Firmware) into
  role-weighted criteria, and downweight standalone generic `Engineer` terms.
- Job search responses expose `queryQuality` and `queryWarning`; title-only or
  structurally sparse jobs remain searchable but are explicitly marked as
  needing JD content instead of appearing fully specified.
- Legacy ATS writes: 0
- Attachment mutations: 0

## Remaining manual gate

The Connector has not been released or changed. A human Golden check is still
required: open ATS Job #106, invoke the existing Connector Job action, verify
the captured title/JD reaches `POST /api/v1/jobs/context`, and confirm the
resulting TN search opens the intended Job Intelligence view. Until that
browser flow passes, the formal Connector release remains held.
