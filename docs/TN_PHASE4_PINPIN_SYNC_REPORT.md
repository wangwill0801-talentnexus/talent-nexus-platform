# Talent Nexus Phase 4 — Pinpin Synchronization Report

> Phase 6B.2B addendum (2026-08-12): the production Connector side-car uses
> the existing `tn_pinpin_ro` source path only to read one exact Candidate ID
> after a successful original Pinpin Save. It reuses the Phase 4 reconciler;
> Pinpin writes and BLOB reads remain zero. See
> `docs/TN_PHASE6B2B_CONNECTOR_ROLLOUT.md`.

> Status: **PHASE 4A DRY RUN REVIEW REQUIRED.**
> Scope completed: Gate 1 credential verification, native-driver compatibility, synthetic candidate verification, and one production read-only dry run. No Talent Nexus data was written.

## 1. Executive Summary

`tn_pinpin_ro` was provisioned with the approved minimum SQL Server permissions and its protected configuration was created without exposing the generated password. The dedicated credential successfully connects through the existing local SQL Server Shared Memory path, reads only its approved objects, cannot read attachment BLOB columns, and has no verified write, execute, schema, database-role, or server-role privilege.

The Node.js `mssql`/Tedious driver was unsuitable because it could not use the existing Shared Memory-only local transport. The approved native-driver checkpoint then passed: `msnodesqlv8` 5.2.3 loaded under Node.js 24.18.0, used the already-installed SQL Server Native Client 10.0, connected as `tn_pinpin_ro` with `SELECT 1`, and reported `Shared memory` transport. No SQL Server network/security setting was changed.

The Pinpin source adapter then completed an approved synthetic verification and one complete production read-only dry run. It reads only approved candidate, work, education, lifecycle, and attachment-metadata columns; it neither selects `Annex` / `Annex1` nor opens a PostgreSQL connection. The dry run completed with zero BLOB reads and zero Talent Nexus writes. Phase 4B and all imports remain unstarted.

## 2. Phase Scope

This checkpoint remained within approved Phase 4A. It did not modify Pinpin, IIS, SQL Server configuration, HiBole-2 data, PostgreSQL data, the TN API routes, the Chrome Plugin, or firewall rules. After the native transport gate passed, it performed only the approved synthetic verification and aggregate production read-only scan; it did not read BLOBs or resume content.

## 3. Source Access Security

The SQL Server metadata check used a local Windows integrated administrative session solely to read SQL Server system catalogs. The future sync adapter must not use that identity or any Pinpin application credential. A dedicated SQL Server login/user is required before source extraction.

## 4. Dedicated Read-Only Credential

`tn_pinpin_ro` now exists as a SQL-authenticated login and mapped `HiBole-2` database user. It has `CONNECT`; object-level `SELECT` on the five approved non-attachment entities; and column-level `SELECT` only on `ID`, `ZPResumeInfo_ID`, `FileName`, `FileType`, `Filesize`, and `CreDate` of `dbo.ZPResumeInfo_Annex_Other`.

Permission inspection and zero-row checks confirmed approved SELECT succeeds; `Annex` and `Annex1` are inaccessible; INSERT, UPDATE, DELETE, EXECUTE, schema ALTER, `db_datareader`, and `sysadmin` are absent. The configuration file is ACL-restricted to Administrators and SYSTEM; `LOCAL SERVICE` has not been granted access.

## 5. Verified Metadata at Gate 1

The following approved source entities were confirmed to exist through SQL Server metadata only:

- `dbo.ZPResumeInfo`
- `dbo.ZPResumeWork`
- `dbo.ZPResumeEdu`
- `dbo.ZPResumeInfo_Annex_Other`
- `dbo.zpresumeinfoDel`
- `dbo.ZPResumeInfo_Note`

At the initial Gate 1 permission-verification stage, no rows were selected from these entities. Later approved Phase 4A synthetic/dry-run reads used only the projections documented in section 8.

## 6. Gate 1 Completion

Gate 1 is complete. The dedicated, SQL-authenticated `tn_pinpin_ro` login and mapped `HiBole-2` user were created with only the approved `SELECT` permissions. Its secret is stored only in the protected server-side `E:\TalentNexus\config\pinpin-source.env` configuration file, restricted to Administrators and SYSTEM. The eventual sync runtime identity has not yet been selected and has not been granted file access.

## 7. Node Driver Compatibility Result

The Node.js 24 `mssql` package (Tedious transport) was used only for the prior compatibility test and then removed from the source dependencies. Its `SELECT 1` attempt returned sanitized `ESOCKET` results because the production SQL Server has no TCP listener and Tedious does not provide the required local Shared Memory path. No TCP fallback, protocol change, restart, or driver installation was performed.

The approved Option 1 native path passed instead:

1. installed client used: SQL Server Native Client 10.0, version `10.0.17763.6766`;
2. Node runtime: `24.18.0`;
3. native wrapper: `msnodesqlv8` `5.2.3`;
4. test: `SELECT 1` succeeded with the protected dedicated credential;
5. transport: `Shared memory` confirmed by `CONNECTIONPROPERTY('net_transport')`;
6. sanity: INSERT, UPDATE, DELETE and EXECUTE permissions were all absent; `Annex` and `Annex1` remained inaccessible.

No new ODBC driver was installed. The source adapter must retain this Windows-native dependency and must never fall back to TCP.

## 8. Phase 4A Source Adapter

The adapter is isolated under `services/tn-api/src/pinpin/` and is not wired into the HTTP API, the scheduled API task, PostgreSQL, or any recurring job. It explicitly builds an `lpc:<local-host>` connection string internally from the protected source configuration; it never logs that string.

Approved read projections are limited to:

- `ZPResumeInfo`: `ID`, `Active`, `email1`, `Address`, `CVSource`;
- `ZPResumeWork`: `ID`, `ResumeID`, `Company`, `F1`, `Dept`, `Industry`, `IsCur`;
- `ZPResumeEdu`: `ID`, `ResumeID`, `School`, `F1`, `F2`, `IsCur`;
- `ZPResumeInfo_Annex_Other`: `ID`, `ZPResumeInfo_ID`, `FileName`, `FileType`, `Filesize`, `CreDate` only;
- `zpresumeinfoDel`: `FID`, `DelDate`.

The adapter does not select candidate name, owner, unverified taxonomy/code values, note text, resume text, BLOB values, or `Annex` / `Annex1`. It treats source as raw/nullable wherever the Phase 1B contract remains unresolved.

## 9. Synthetic Candidate Verification

The pre-authorized synthetic candidate was queried only after native transport verification. The sanitized result confirmed the expected external identity, inactive/soft-delete state, its tombstone, one structured work record, zero structured education records, and three attachment metadata records. No candidate values, filenames, document content, or BLOB data were reported. This verifies the adapter joins and the established lifecycle/document relations without exposing PII.

## 10. Production Read-Only Dry Run

One bounded production read-only scan was completed in two pages. The run emitted aggregate counts only:

| Metric | Result |
|---|---:|
| Candidates seen | 178 |
| Inactive candidates | 7 |
| Tombstoned candidates | 7 |
| Candidates with non-empty selected `CVSource` | 39 |
| Work records seen | 512 |
| Education records seen | 135 |
| Attachment metadata records seen | 223 |
| BLOB reads | 0 |
| TN PostgreSQL writes | 0 |

The selected `email1` and `Address` projections were blank for all rows in this dry run. This is a source-coverage observation, not a claim that Pinpin lacks email or location data; no alternative fields were probed in Phase 4A. Treat email/location mapping as unresolved until a separately approved schema/semantic verification step.

The first dry-run attempt surfaced two adapter-only defects: legacy Native Client requires sequential statements on a connection, and an `IN` placeholder was parenthesized twice for multi-ID batches. Both were corrected locally, rebuilt, retested, and the final successful dry run above was re-run. Neither attempt wrote to Pinpin or Talent Nexus.

## 11. Phase 4A Review Gate

**PHASE 4A DRY RUN REVIEW REQUIRED.** The next decision must explicitly authorize or reject Phase 4B synthetic TN import. This report does not authorize a PostgreSQL write, pilot, full import, recurring sync, API exposure, task scheduling, or any source permission expansion.

## 12. Not Started

At the conclusion of Phase 4A, the following were intentionally unstarted: synthetic TN import, pilot import, full import, reconciliation writes, incremental discovery job, recurring synchronization, API exposure of source data, and runtime-identity access to `pinpin-source.env`. Phase 4B subsequently authorized the single fixture import documented below; all other listed work remains unstarted.

---

# Phase 4B — Deleted Synthetic Candidate Controlled Import

## 13. Scope and Safety Confirmation

Phase 4B was authorized only for the pre-approved deleted synthetic fixture:

```text
source_system = pinpin
source_instance = pinpin-prod
external_candidate_id = 43177
```

No other Pinpin candidate was imported or used for new field discovery. Pinpin remained read-only over the same Node.js 24.18.0 + `msnodesqlv8` 5.2.3 + SQL Server Native Client 10.0 Shared Memory path. The import did not select `Annex` or `Annex1`, did not read or copy BLOBs, did not call an AI provider, and did not modify Pinpin, IIS, SQL Server configuration, or firewall rules.

## 14. Source Fixture State

The fixture was verified immediately before import as an inactive/deleted source candidate with a tombstone, one structured work record, zero structured education records, and three attachment metadata rows. No candidate values, filenames, source payload, or document content were included in the technical output.

## 15. First Reconciliation Run

The first controlled run created exactly one canonical TN candidate and exactly one external reference for the approved Pinpin external identity. The allocated TN candidate code was produced by the existing PostgreSQL sequence and conforms to the required `TN########` format.

| Check | Result |
|---|---|
| TN UUID | `019ff016-73c4-7091-ac4e-372308111090` |
| TN candidate code | `TN00000001` |
| External references | 1 |
| Source active | false |
| Source deleted / tombstone | true |
| Lifecycle event created | one `deleted` event |
| Work rows | 1 |
| Education rows | 0 |
| Document metadata rows | 3 |
| BLOB reads / writes | 0 / 0 |
| Pinpin writes | 0 |

The canonical TN candidate remains physically retained while the Pinpin external reference is marked inactive and carries its source deletion time. This implements the required source-lifecycle distinction without hard-deleting the TN candidate.

## 16. Second Reconciliation Run and Idempotency

The identical source candidate was read again and reconciled a second time. It returned the same TN UUID and the same TN candidate code. No second candidate, external reference, work row, education row, document row, or lifecycle event was created.

Existing work/document metadata rows were reconciled in place; this updates observation metadata without creating duplicate identities. The unchanged deleted source state did not create lifecycle-event noise.

| Idempotency check | Result |
|---|---|
| UUID stability | PASS |
| Candidate-code stability | PASS |
| Duplicate candidate / external reference | 0 / 0 |
| Duplicate work / education / document rows | 0 / 0 / 0 |
| Duplicate lifecycle events | 0 |
| Final work / education / document counts | 1 / 0 / 3 |

## 17. TN Integrity Checks

After the second run, targeted integrity checks for the Phase 4B fixture passed:

| Check | Result |
|---|---:|
| Duplicate `(source_instance_id, external_candidate_id)` | 0 |
| Orphan work rows | 0 |
| Orphan education rows | 0 |
| Orphan document rows | 0 |
| Candidate-code duplicates | 0 |
| Source lifecycle linkage | valid |

The fixture is retained as a permanent deleted-source integration regression fixture. It must be excluded from normal production candidate search/count behaviour when that application feature is separately designed and approved; no new schema flag was introduced in this phase.

## 18. Unresolved Core Mappings

Candidate name, email, phone, and location/address mappings remain unresolved. This Phase 4B import deliberately leaves name, email, phone, and location null rather than guessing alternate Pinpin columns. Owner remains null/deferred. `CVSource` remains raw source metadata only and is not normalized.

The next intended verification is **Phase 4B.1 — Active Synthetic Candidate Core Mapping Verification** using a new active synthetic candidate created manually by the user. It is not authorized or started by this phase.

## 19. Operational Regression Checks

| System | Result |
|---|---|
| TN API `/health` | HTTP 200 |
| TN API candidate list/detail/unknown-candidate contract | 200 / 200 / 404 |
| IIS (`W3SVC`) | Running |
| SQL Server (`MSSQLSERVER`) | Running |
| PostgreSQL 17 | Running |
| Chinese ATS `/webapp/` | HTTP 200 |
| English ATS `/webapp/` | HTTP 200 |
| SQL Server TCP 1433 listener | absent / unchanged |
| Pinpin source transport | Shared Memory / LPC |
| Pinpin writes | 0 |

## 20. Phase 4B Review Gate

**PHASE 4B SYNTHETIC IMPORT REVIEW REQUIRED.** Do not start Phase 4B.1, a real-candidate pilot, broader imports, recurring synchronization, or a `TalentNexusPinpinSync` task without separate approval.

---

# Phase 4B.1 — Active Synthetic Candidate Core Mapping Verification

## 21. Scope and Safety Confirmation

Phase 4B.1 used only the manually created active synthetic candidate `43184`. All evidence was candidate-ID-scoped and returned only field names, boolean match results, source-row IDs, relations, and aggregate counts. No whole row/table dump, unrelated candidate inspection, BLOB access, Pinpin write, TN write, TCP/protocol change, driver installation, or permission expansion occurred.

The verified source transport remains Node.js 24.18.0 + `msnodesqlv8` 5.2.3 + existing SQL Server Native Client 10.0 + Shared Memory / LPC + `tn_pinpin_ro`.

## 22. Core Mapping Evidence

| UI concept | Source evidence | Status |
|---|---|---|
| Candidate ID | `ZPResumeInfo.ID = 43184`; `Active = 1` | VERIFIED |
| Name | `ZPResumeInfo.A0101` is populated and matches distinctive name fragments, but not the complete expected UI value | PARTIAL |
| English name | `ZPResumeInfo.EnglishName` is empty; no approved candidate-master text field matched the complete expected synthetic value | UNKNOWN |
| Phone | `ZPResumeInfo.A0118` exactly matched the synthetic phone | VERIFIED |
| Email | `ZPResumeInfo.A0122` exactly matched the synthetic email | VERIFIED |
| Current city | `ZPResumeInfo.A0112` exactly matched the synthetic city | VERIFIED |
| Desired cities | `ZPResumeInfo.A0202` contained each controlled desired-city value; raw serialized representation retained | VERIFIED |
| Date of birth | `A0103` is populated, but no distinctive UI value was supplied for exact semantic trace | DEFERRED |
| Gender | `A0102` is empty on the fixture; no source/value trace is available | UNKNOWN |
| Top-level education | `ZPResumeInfo.A0124` exactly matched the controlled education level | VERIFIED |
| Salary | No approved candidate-master projection matched the controlled salary token | UNKNOWN |
| Source / CVSource | `ZPResumeInfo.CVSource` is populated, but the UI label was not an exact raw-value match | PARTIAL |
| Industry | No controlled synthetic value was supplied for semantic trace | UNKNOWN |
| Function | No controlled synthetic value was supplied for semantic trace | UNKNOWN |
| Job title/category | No controlled top-level category value was supplied; structured work title is separately verified | UNKNOWN |
| Tags | `ZPResumeInfo.A9901` contains both controlled tag values in a raw serialized representation | VERIFIED (raw only) |
| Uploader / creator | `ZPResumeInfo.CreUser` is populated, but it was not normalized to the UI display identity | PARTIAL |
| Note | `ZPResumeInfo.LastRemark` exactly matched the controlled note. `ZPResumeInfo_Note` had no matching row and has no note-text column. | VERIFIED for last-remark persistence |

No tag-table permission was requested: the two controlled tags were verified in the already approved candidate-master `A9901` projection. Owner/user normalization remains deferred.

## 23. Work and Education Rows

| Entity / concept | Source evidence | Status |
|---|---|---|
| Current work identity | `ZPResumeWork.ID=670`, `ResumeID=43184`, `IsCur=1` | VERIFIED |
| Current company/title | `Company` / `F1` exactly matched the controlled values | VERIFIED |
| Current department | `F5` exactly matched the controlled department; `Dept` did not | VERIFIED for this controlled path |
| Current start | `YearB` retained the controlled `YYYY-MM` value | VERIFIED |
| Previous work identity | `ZPResumeWork.ID=671`, `ResumeID=43184`, `IsCur=0` | VERIFIED |
| Previous company/title | `Company` / `F1` exactly matched the controlled values | VERIFIED |
| Previous dates | `YearB` and `YearE` retained the controlled `YYYY-MM` values | VERIFIED |
| Previous department | No approved work-table text column exactly matched the controlled department | PARTIAL |
| Education identity | `ZPResumeEdu.ID=177`, `ResumeID=43184`, `IsCur=1` | VERIFIED |
| School / major / degree | `School` / `F1` / `F2` exactly matched the controlled values | VERIFIED |
| Education description | No approved education-table column matched the controlled description token | PARTIAL |
| Education dates | No distinctive date value was supplied for exact trace | DEFERRED |

## 24. Document Metadata

`ZPResumeInfo_Annex_Other` returned exactly two metadata rows related by `ZPResumeInfo_ID=43184`. Only approved metadata columns were queried. `Annex` and `Annex1` were not selected; BLOB reads and writes remained zero.

## 25. Source Adapter Correction and Read-Only Coverage Recheck

The adapter keeps Pinpin names isolated under `services/tn-api/src/pinpin/` and now uses the verified mappings:

- phone: `A0118`;
- email: `A0122`;
- current city: `A0112`;
- desired cities raw: `A0202`;
- top-level education raw: `A0124`;
- current work company/title/department/start/end: `Company` / `F1` / `F5` fallback `Dept` / `YearB` / `YearE`;
- education school/major/degree: `School` / `F1` / `F2`.

The production read-only recheck completed with zero TN writes and aggregate-only output:

| Metric | Result |
|---|---:|
| Candidates seen | 180 |
| Candidates with verified phone | 110 |
| Candidates with verified email | 134 |
| Candidates with verified current city | 62 |
| Candidates with desired-city raw value | 1 |
| Candidates with top-level education raw value | 26 |
| Candidates with work | 129 |
| Candidates with education | 84 |
| Candidates with document metadata | 175 |
| Work / education / document metadata rows | 517 / 137 / 227 |
| BLOB reads | 0 |
| TN writes | 0 |

Candidate-name coverage is intentionally not reported: its full source mapping remains only PARTIAL and must not be represented as verified coverage.

## 26. Active Synthetic TN Import Decision

**NOT RUN — CORE MAPPING REVIEW REQUIRED.** Although the existing TN schema permits a nullable display name, Phase 4B.1 requires reliable source mapping for candidate name before a controlled active import or any future real-candidate pilot. The full expected UI name did not exactly match any approved source field, and English name is also unresolved. Candidate `43184` was not written to TN.

## 27. Regression Checks

| System | Result |
|---|---|
| TN API `/health` | HTTP 200 |
| TN candidate list/detail/unknown contract | 200 / 200 / 404 |
| Chinese ATS `/webapp/` | HTTP 200 |
| English ATS `/webapp/` | HTTP 200 |
| IIS / SQL Server / PostgreSQL | Running / Running / Running |
| SQL Server TCP 1433 | not listening / unchanged |
| Pinpin writes | 0 |

## 28. Phase 4B.1 Review Gate

**PHASE 4B.1 CORE MAPPING REVIEW REQUIRED.** Do not import `43184`, start a real-candidate pilot, begin recurring synchronization, or expand source access without separate approval.

---

# Phase 4B.2 — Controlled Delta Mapping

## 29. Scope and Safety Confirmation

Only the user-authorized active synthetic candidate `43184` was compared before and after the user manually saved Edit Set A through the normal Pinpin UI. Codex performed no Pinpin write, did not read `Annex` or `Annex1`, did not read document content, and did not query another candidate. Before/after snapshots remain local, candidate-scoped test evidence and are not part of the repository.

The source transport remained `tn_pinpin_ro` through Node.js 24.18.0, `msnodesqlv8` 5.2.3, SQL Server Native Client 10.0, and local Shared Memory/LPC. No SQL Server TCP protocol, IIS, firewall, Pinpin configuration, or source permissions changed.

## 30. Candidate-Master Delta Results

| UI field tested | Source entity / column | Before/after evidence | Raw persistence / normalization | Status |
|---|---|---|---|---|
| Complete name | `ZPResumeInfo.A0101` | Exact controlled name changed with the UI save | Trimmed source text | **VERIFIED** |
| English name | No approved candidate-master column changed | No exact controlled value found in the approved delta | No mapping inferred | **UNKNOWN** |
| Birth year | `ZPResumeInfo.A0103` | Existing raw value changed to the user-entered `1999` | Year-only text in this controlled test | **VERIFIED (Birth Year)** |
| Full date of birth | None | Not tested: the user clarified that only `1999` was entered | No full `YYYY-MM-DD` value is derived or manufactured | **UNKNOWN** |
| Gender | `ZPResumeInfo.A0102` | Changed with the controlled UI value | Raw Pinpin text value | **VERIFIED (raw)** |
| Salary | `ZPResumeInfo.A01099` | Numeric raw value changed consistently with the controlled UI amount | Raw integer persisted; the controlled UI `456 萬` corresponded to `4,560,000` | **VERIFIED (raw numeric)** |

`A0117` also changed during the save, but its timestamp-like behavior does not establish a phone or identity mapping and it is not imported as such. A top-level `School` field also changed as a consequence of the education save; structured education remains the authoritative contract below.

No other full-date-of-birth column was proven by this candidate-scoped approved projection. This is not evidence that no such field exists elsewhere in Pinpin; it means Phase 4B.2 has no controlled evidence for one. Talent Nexus retains `birthYearRaw` only and must not turn `1999` into `1999-01-01` or another invented date.

## 31. Work and Education Delta Results

| UI field tested | Source entity / column | Before/after evidence | Status |
|---|---|---|---|
| Current work | `ZPResumeWork` relation through `ResumeID=43184` | Two structured source rows remained related to the candidate | **VERIFIED** |
| Current company/title/department | `Company` / `F1` / `F5` | Current row retained the controlled evidence | **VERIFIED** |
| Previous-work department | `ZPResumeWork.Dept` | The controlled prior-role department appeared in `Dept`; `F5` was empty for that row | **VERIFIED** |
| Work dates | `YearB` / `YearE` | Raw `YYYY-MM` representation retained | **VERIFIED (month precision)** |
| Education description | `ZPResumeEdu.detail` | Exact controlled description appeared after save | **VERIFIED (raw)** |
| Education start/end | `ZPResumeEdu.YearB` / `YearE` | Controlled `2020-09` / `2024-06` appeared after save | **VERIFIED (month precision)** |
| School / degree / major | `School` / `F1` / `F2` | Structured education row retained the controlled evidence | **VERIFIED** |

Saving the UI replaced the previous work source row IDs (`670`/`671`) with new IDs (`672`/`673`) and the education source row ID (`177`) with `178`. Therefore a Pinpin child row ID is a valid snapshot identifier but is **not durable across this UI save path**. The TN reconciler now first uses the source record ID and then falls back to a deterministic content fingerprint to update an equivalent row rather than create a duplicate. The fallback behavior is covered by synthetic automated tests; a future edit-after-import trace remains the appropriate way to validate it against Pinpin again.

One new `ZPResumeInfo_Note` metadata row was observed after the user save. No note body is selected or imported.

## 32. Optional Taxonomy Fields

Industry, function, and top-level job-category fields were not edited in Edit Set A. They remain raw/nullable and are not normalized or used as a Phase 4C gate. `A0202`, `A0124`, and `A9901` retain their previously verified raw-only treatment for desired locations, top-level education, and tags respectively.

## 33. Corrected Read-Only Production Coverage

After adding the verified complete-name projection, a bounded two-page production dry run completed with aggregate-only output and zero TN writes:

| Metric | Result |
|---|---:|
| Candidates seen | 180 |
| Candidates with complete-name source text | 179 |
| Candidates with verified phone / email / current city | 110 / 134 / 62 |
| Candidates with work / education / document metadata | 129 / 84 / 175 |
| Work / education / document metadata rows | 517 / 137 / 227 |
| BLOB reads | 0 |
| TN writes | 0 |

This coverage describes non-empty source fields only; it does not normalize optional taxonomies or claim that a value is correct for every candidate.

## 34. Controlled Active TN Import and Idempotency

After the complete-name gate passed, only `pinpin-prod / 43184` was imported into TN. The first run created exactly one active canonical candidate, one external reference, two work rows, one education row, and two attachment metadata rows. The second run returned the same UUID and candidate code and created no additional candidate, external reference, work, education, document, or lifecycle row.

| Check | Result |
|---|---|
| TN UUID | `019ff042-ed74-7628-9d20-992e6ec825c4` |
| TN candidate code | `TN00000002` |
| Source lifecycle | active; no lifecycle event required or created |
| First-run work / education / documents | 2 / 1 / 2 |
| Second-run created work / education / documents | 0 / 0 / 0 |
| UUID / candidate-code stability | PASS / PASS |
| External-reference duplicates | 0 |
| Orphan work / education / document rows | 0 / 0 / 0 |
| Candidate-code duplicates | 0 |
| BLOB reads / Pinpin writes | 0 / 0 |

## 35. Regression Checks

| System | Result |
|---|---|
| TN API `/health`, authenticated list/detail/unknown contract | 200 / 200 / 200 / 404 |
| Chinese ATS `/webapp/` | HTTP 200 |
| English ATS `/webapp/` | HTTP 200 |
| IIS / SQL Server / PostgreSQL | Running / Running / Running |
| SQL Server TCP 1433 listener | absent |
| PostgreSQL / TN API public listeners | absent |
| Pinpin writes | 0 |

The bare ATS roots return pre-existing MVC HTTP 500 responses, while the actual `/webapp/` application routes return HTTP 200. Phase 4B.2 did not modify IIS or either deployment.

## 36. Phase 4B.2 Review Gate

**PHASE 4B.2 CONTROLLED DELTA REVIEW REQUIRED.** Core searchable identity/contact/work/education/document mapping, active synthetic import, and rerun idempotency pass. Owner mapping, English-name mapping, full DOB, taxonomy normalization, and edit-after-import child-row churn validation remain explicitly partial or unknown. Do not start Phase 4C, broad import, recurring synchronization, Phase 5, or Phase 6 without separate approval.

---

# Phase 4C — 5-Candidate Real Production Pilot

## 37. Scope, Selection, and Safety

Phase 4C processed exactly five real Pinpin candidates. The synthetic fixtures `43177` and `43184` were explicitly excluded and did not count toward the pilot.

Selection was deterministic and non-discriminatory: active source status, non-empty verified complete-name field, at least one structured work row, attachment metadata preferred, then Pinpin numeric ID ascending. The selector also excluded clearly named TN system-test records. It did not use gender, birth year, salary, ethnicity, family status, health, or other sensitive attributes. The five numeric external IDs are recorded only in TN `sync_runs` audit metadata; they are intentionally omitted from this report.

The same approved source transport remained in use: `tn_pinpin_ro`, Node.js 24.18.0, `msnodesqlv8` 5.2.3, SQL Server Native Client 10.0, and local Shared Memory/LPC. No Pinpin write API, IIS change, SQL Server protocol change, TCP listener, firewall change, BLOB selection, or LLM processing occurred.

## 38. Backup Operational Check

The existing scheduled backup definitions were inspected read-only before the first real TN write. They did not provide explicit evidence that `E:\TalentNexusData\PostgreSQL\17\data` is included, and no explicit exclusion was found.

**BACKUP COVERAGE = UNVERIFIED.** This was recorded as an operational warning and did not block the approved five-candidate pilot. It remains a mandatory review item before any future Phase 4D full import approval; no backup job was changed.

## 39. Pre-Import Dry Check

The candidate-scoped read-only precheck returned exactly five selected candidates. All five were active, had a verified name and at least one work row, and had attachment metadata. No selected external identity already existed in TN. The precheck performed zero TN writes, zero Pinpin writes, and zero BLOB reads.

## 40. First Pilot Import

Each candidate was reconciled in its own bounded TN PostgreSQL transaction. All five completed successfully; none required a retryable error record.

| First-run metric | Result |
|---|---:|
| Candidates selected / created / updated / unchanged / failed | 5 / 5 / 0 / 0 / 0 |
| Active lifecycle references | 5 |
| Work rows reconciled | 15 |
| Education rows reconciled | 5 |
| Document metadata rows reconciled | 7 |
| New external references | 5 |
| BLOB reads / writes | 0 / 0 |
| Pinpin writes | 0 |

Verified candidate core fields were stored where present: name, phone, email, city, desired-city raw representation, birth-year raw representation, gender raw representation, top-level education raw representation, salary raw numeric representation, tags raw representation, CV source raw representation, and note raw representation. No full DOB, English name, owner, or taxonomy was invented or normalized beyond approved raw storage.

## 41. Second Run and Idempotency

The exact same five candidate snapshots were reconciled a second time without source changes initiated by Codex. No new candidate, external reference, work row, education row, document row, or lifecycle event was created. The five existing TN candidates were reconciled in place to refresh observation metadata.

| Second-run metric | Result |
|---|---:|
| Created / updated-in-place / unchanged / failed | 0 / 5 / 0 / 0 |
| TN identity stability | 5/5 |
| Candidate-code stability | 5/5 |
| New work / education / document rows | 0 / 0 / 0 |
| Duplicate lifecycle events | 0 |
| Idempotency | PASS |

## 42. Post-Import Contract and Integrity Verification

A fresh candidate-scoped source-to-TN comparison was run without emitting source values. All five candidates matched for candidate-core fields, work rows, education rows, document metadata, and active lifecycle state.

| Verification | Result |
|---|---:|
| Candidate-core mapping | 5/5 PASS |
| Work reconciliation | 5/5 PASS |
| Education reconciliation | 5/5 PASS |
| Document metadata reconciliation | 5/5 PASS |
| Active lifecycle reconciliation | 5/5 PASS |
| Duplicate external references | 0 |
| Duplicate candidate codes | 0 |
| Orphan work / education / document rows | 0 / 0 / 0 |
| BLOB reads / Pinpin writes | 0 / 0 |

`candidate_sync_state` was created or updated inside each candidate transaction with non-reversible core/work/education/document fingerprints. No source PII was written to operational logs.

## 43. API and Production Regression Checks

| Check | Result |
|---|---|
| TN API health / authenticated list / imported-pilot detail / unknown detail | 200 / 200 / 200 / 404 |
| Unauthenticated candidate API | 401 |
| Chinese Pinpin `/webapp/` | HTTP 200 |
| English Pinpin `/webapp/` | HTTP 200 |
| IIS / SQL Server / PostgreSQL | Running / Running / Running |
| SQL Server TCP 1433 listener | absent / unchanged |
| Public PostgreSQL 5432 / TN API 3333 listeners | absent / absent |
| Pinpin permissions and source transport | unchanged, read-only Shared Memory/LPC |

## 44. Known Limitations and Review Gate

Non-blocking deferred mappings remain: English name, full date of birth, industry/function/top-level-job-category taxonomy normalization, owner normalization, and CV source taxonomy normalization. Work and education row IDs are used as the primary reconciliation key; the reconciler retains its content-fingerprint fallback for the already observed Pinpin UI child-row replacement behavior.

**PHASE 4C PILOT REVIEW REQUIRED.** The pilot meets the Phase 4C completion criteria. Phase 4D remains explicitly unstarted and must not be approved without a separate backup-coverage review and explicit authorization.

---

# Phase 4C.1 — Production Import Gate

## 45. Backup Coverage Verification

The VPS scheduled-task configuration was inspected again read-only for explicit coverage of `E:\TalentNexusData\PostgreSQL\17\data`, plus the related TN configuration and application paths. No local task definition proved the PostgreSQL data directory is included, and no explicit exclusion was found.

**BACKUP COVERAGE = UNVERIFIED.** This is a VPS/image or provider-backup evidence gap, not proof that a backup does not exist. The VPS provider or administrator must confirm that its full-machine/image backup covers the E: data volume and specifically includes `E:\TalentNexusData\PostgreSQL\17\data` with a recoverable retention policy.

PostgreSQL-native logical/physical backup is **NOT CONFIGURED OR NOT VERIFIED** in this phase. A future `pg_dump` or physical PostgreSQL backup policy may be evaluated separately, but none was configured, changed, or run here.

## 46. Initial No-Op Measurement

The exact same five Phase 4C real pilot candidates were reselected using the deterministic selector. A source snapshot fingerprint before/after the pass was identical, confirming no source change was observed. The initial measurement showed the prior `updated = 5` result was not reporting-only: unchanged source data caused material TN writes.

| TN group | Rows with `updated_at` changed in initial measurement |
|---|---:|
| Candidate core | 5 |
| External references | 5 |
| Work | 15 |
| Education | 5 |
| Document metadata | 7 |
| Candidate sync state | 5 |

Pinpin writes and BLOB reads remained zero during this measurement.

## 47. No-Op Reconciliation Repair

The real-pilot reconciliation path was corrected without changing the schema or adding a migration:

- source core, work, education, and document fingerprints are now read before reconciliation;
- an unchanged entity group is skipped entirely;
- unchanged external references, candidate projection, work, education, document metadata, lifecycle, and `candidate_sync_state` are not rewritten;
- `source_instances` now uses insert-or-read behavior rather than an unconditional conflict update;
- result semantics now distinguish `materiallyChanged` from an unchanged reconciliation.

Automated tests were updated so a second real-pilot reconciliation must report no work, education, or document updates and no material change.

## 48. Final No-Op Rerun

The exact same five candidates were rechecked after the repair. Source fingerprints remained unchanged. The final no-op pass returned:

| Metric | Result |
|---|---:|
| Observed | 5 |
| Created | 0 |
| Materially updated | 0 |
| Unchanged | 5 |
| Failed | 0 |
| UUID stability / candidate-code stability | 5/5 / 5/5 |
| Candidate / external-ref / work / education / document / sync-state timestamp changes | 0 / 0 / 0 / 0 / 0 / 0 |
| New lifecycle events | 0 |
| Duplicate external references / candidate codes | 0 / 0 |
| Orphan work / education / document rows | 0 / 0 / 0 |
| BLOB reads / Pinpin writes | 0 / 0 |

## 49. Final Regression Check

| Check | Result |
|---|---|
| TypeScript build / automated tests | PASS / 14 of 14 PASS |
| TN API health / list / imported detail / unknown detail | 200 / 200 / 200 / 404 |
| Unauthenticated candidate API | 401 |
| Chinese / English Pinpin `/webapp/` | 200 / 200 |
| IIS / SQL Server / PostgreSQL | Running / Running / Running |
| SQL Server TCP 1433 listener | absent / unchanged |
| Public PostgreSQL 5432 / TN API 3333 listeners | absent / absent |

## 50. Phase 4D Gate

This was the pre-Phase 4C.2 state. The subsequent native backup/restore drill is documented below; Phase 4D was later separately approved. Recurring synchronization and all later phases remain unstarted pending separate authorization.

---

# Phase 4C.2 - PostgreSQL Native Backup & Restore Verification

## 51. Initial Credential Gate Result (Resolved by Approved Option 2)

The approved Phase 4C.2 native backup-and-restore drill was stopped at its credential gate before any archive, restore database, or production-data operation was created.

- The protected TN runtime configuration was consumed only inside the remote process; its contents and every secret were neither displayed nor recorded.
- A Windows capability probe that used `NUL` as a `pg_dump` custom-format output target failed because `pg_dump` cannot fsync that Windows device. It created no usable archive and is not evidence of a PostgreSQL credential failure.
- The `tn_app` role was then verified to have `CREATEDB = false`.
- An isolated `talentnexus_restore_verify` database therefore cannot be created with the currently approved application credential.

Per the Phase 4C.2 safety gate, no permission was broadened, no role was created or changed, no backup directory/archive was created, no restore was attempted, and no database was dropped. Pinpin, IIS, SQL Server, HiBole-2, the Chrome Plugin, and the production `talentnexus` data remain unchanged.

This initial credential block was resolved through the subsequently approved Option 2 Administrator-superuser procedure documented in section 54.

## 52. Proposed Least-Privilege Approval Option

Do not broaden `tn_app`. If a Codex-run native restore drill is required, approve a temporary, dedicated PostgreSQL backup/restore operator credential with only the privileges necessary to read the `talentnexus` objects for `pg_dump --format=custom --no-owner --no-privileges`, create one isolated verification database, and create/restore objects only inside that verification database. `CREATEDB` is a server-level role attribute, so the credential must be time-bounded, stored only in protected configuration, and removed or disabled after the drill.

An alternative is for the Administrator to perform the native dump/restore interactively with an existing administrative credential while Codex observes only sanitized aggregate results. Either option requires explicit approval before proceeding.

## 53. Backup Status and Phase Gate

| Item | Status |
|---|---|
| PostgreSQL-native `pg_dump -Fc` archive | Completed and retained; see section 54 |
| Archive listing / restore verification | Completed and passed; see section 54 |
| Temporary restore database cleanup | Completed; only `talentnexus_restore_verify` was removed |
| VPS/image backup coverage | Still unverified; separate from PostgreSQL-native backup |
| Phase 4D readiness | Historical YELLOW; Phase 4D was subsequently approved and completed in section 56 |

## 54. Option 2 Native Backup and Restore Result

Option 2 was performed locally by the Administrator with the PostgreSQL `postgres` superuser through interactive password prompts. No password was provided to, stored by, or displayed through Codex. The procedure created one PostgreSQL custom-format (`pg_dump -Fc`) logical archive of `talentnexus`, validated it with `pg_restore --list`, restored it into only `talentnexus_restore_verify`, and retained the validated archive in `E:\TalentNexusBackups\PostgreSQL`.

The backup directory is present, the archive is non-empty, and the directory ACL resolves to only `BUILTIN\\Administrators` and `NT AUTHORITY\\SYSTEM`. The archive was not copied or uploaded outside the VPS.

| Verification item | Production `talentnexus` | Temporary restore | Result |
|---|---:|---:|---|
| Candidates | 7 | 7 | MATCH |
| Candidate external references | 7 | 7 | MATCH |
| Work experiences | 18 | 18 | MATCH |
| Education records | 6 | 6 | MATCH |
| Document metadata records | 12 | 12 | MATCH |
| Migration ledger | 1 | 1 | MATCH |
| Candidate UUID primary key | true | true | MATCH |
| External identity uniqueness | true | true | MATCH |
| Foreign keys | 22 | 22 | MATCH |
| Candidate-code sequence present / last value | true / 7 | true / 7 | MATCH |
| Duplicate external references | 0 | 0 | PASS |
| Orphan work / education / documents | 0 / 0 / 0 | 0 / 0 / 0 | PASS |

The Administrator then dropped only `talentnexus_restore_verify`. A final read-only check confirmed that the production connection remains `talentnexus`, `talentnexus_restore_verify` no longer exists, the production candidate aggregate remains 7, and the production migration ledger remains 1.

## 55. Phase 4C.2 Regression and Boundary Confirmation

| Check | Result |
|---|---|
| PostgreSQL / IIS / SQL Server | Running / Running / Running |
| PostgreSQL listener | `127.0.0.1:5432` only |
| TN API listener | `127.0.0.1:3333` only |
| TN `/health` / candidate list / unknown candidate | 200 / 200 / 404 |
| Chinese / English Pinpin `/webapp/` | 200 / 200 |
| Pinpin writes / resume BLOB reads in this phase | 0 / 0 |
| Pinpin, IIS, SQL Server, HiBole-2, Chrome Plugin changes | None |

**PHASE 4C.2 BACKUP / RESTORE REVIEW REQUIRED.** A one-time native backup and restore drill is now verified. This does not by itself configure a recurring backup schedule, retention policy, off-VPS copy, or prove VPS/image-backup coverage. Phase 4D was subsequently approved and completed in section 56.

---

# Phase 4D - Full Initial Pinpin to TN Import

## 56. Scope and Preflight

Phase 4D was executed after explicit approval. Pinpin remained read-only through the existing local Shared Memory adapter and `tn_pinpin_ro`; no TCP SQL Server connectivity, IIS, SQL Server, Pinpin, PostgreSQL network, or Chrome Plugin configuration was changed.

Preflight and first-run timestamp: 2026-08-11 19:08:15.50566 +08:00 (recorded by the Phase 4D TN sync-run ledger).

| Source / target preflight metric | Result |
|---|---:|
| Pinpin candidate master population | 180 |
| Active / inactive candidates | 173 / 7 |
| Candidates with complete name / work / education / attachment metadata | 179 / 129 / 84 / 175 |
| Raw Pinpin work / education / attachment metadata rows | 516 / 137 / 498 |
| Importable work / education / attachment metadata rows linked to current master candidates | 516 / 137 / 229 |
| TN candidates before import | 7 |
| Existing Pinpin mappings before import | 7 |
| Expected new mappings | 173 |
| External-ref conflicts, multi-maps, orphans, unexpected migration state | 0 / 0 / 0 / 0 / PASS |
| Validated pre-Phase 4D native backup archive | Present, non-empty, retained, protected ACL |

The raw attachment table includes 498 metadata rows, while 229 are linked to the current 180-row Pinpin candidate master population. Only the latter candidate-linked metadata population is eligible for this import; no attachment BLOB was read.

## 57. Full Import and Second-Run Idempotency

The complete 180-candidate source population was reconciled with candidate-scoped TN transactions. The existing two synthetic fixtures and five real pilot candidates were encountered through the same identity contract; none was deleted, recreated, renumbered, or special-cased.

| Metric | First run | Mandatory second run |
|---|---:|---:|
| Observed | 180 | 180 |
| Created | 173 | 0 |
| Materially updated | 2 | 0 |
| Unchanged | 5 | 180 |
| Failed | 0 | 0 |
| Duration | 4.034 s | 1.332 s |
| Approximate throughput | 44.6 candidates/s | 135.1 candidates/s |

The two first-run material updates were existing mapped records reconciled through the approved generic full-population path. The second full run had no material write result, confirming true no-op behavior for all 180 observed source identities.

## 58. Final Reconciliation and Integrity

| Final TN Pinpin-scoped metric | Result |
|---|---:|
| Candidate mappings / external references | 180 / 180 |
| Work / education / candidate-linked document metadata | 516 / 137 / 229 |
| Active / inactive-or-deleted source lifecycle | 173 / 7 |
| Lifecycle events retained | 7 |
| Candidate UUID identity stability | PASS, 180/180 across the two runs |
| Candidate-code stability | PASS, 180/180 across the two runs |
| Duplicate external refs / duplicate candidate codes | 0 / 0 |
| Orphan work / education / documents | 0 / 0 / 0 |
| Work / education / document metadata reconciliation | PASS / PASS / PASS |
| BLOB reads | 0 |
| Pinpin INSERT / UPDATE / DELETE performed by TN | 0 / 0 / 0 |

Source immutability evidence consists of the existing `tn_pinpin_ro` object/column-level grants with no DML or EXECUTE capability, plus the production adapter projections, which use only SELECT queries and exclude `Annex` and `Annex1`. The run output and importer contain no Pinpin write path.

## 59. Regression and Build/Test Results

| Check | Result |
|---|---|
| TypeScript build / automated tests | PASS / 15 of 15 PASS |
| TN API health / authenticated list / known detail / unknown detail / unauthorized list | 200 / 200 / 200 / 404 / 401 |
| PostgreSQL / IIS / SQL Server | Running / Running / Running |
| PostgreSQL / TN API listeners | `127.0.0.1:5432` only / `127.0.0.1:3333` only |
| SQL Server TCP 1433 listener | absent, unchanged |
| Pinpin Chinese / English `/webapp/` | 200 / 200 |

## 60. Known Limitations and Next Gate

The known non-blocking mapping limitations remain unchanged: English name UNKNOWN; full date of birth UNKNOWN (birth year only); owner normalization DEFERRED; CVSource PARTIAL; industry and function taxonomy UNKNOWN/DEFERRED; resume evidence and canonical AI profile deferred to future phases. No speculative mapping was introduced.

The validated pre-Phase 4D native archive remains retained. Before any Phase 4E decision, create and verify a separate post-initial-import native PostgreSQL backup through a separately approved checkpoint. Do not overwrite the pre-import recovery archive and do not create backup automation in this phase.

**PHASE 4E READINESS: GREEN.** The initial import is technically complete and stable. Phase 4E incremental sync, recurring tasks, and later phases remain explicitly unstarted pending separate design and approval.

**PHASE 4D FULL INITIAL IMPORT REVIEW REQUIRED.**

---

# Phase 4D.1 - Post-Initial-Import Backup

## 61. Post-Initial-Import Native Recovery Point

The Administrator created a new PostgreSQL 17 custom-format archive through the approved local interactive `postgres`-superuser procedure. The password was entered only at the PostgreSQL prompt and was not supplied to, stored by, or displayed through Codex.

| Item | Result |
|---|---|
| Backup path | `E:\TalentNexusBackups\PostgreSQL\talentnexus_post_initial_20260811_191549.backup` |
| Backup timestamp | 2026-08-11 19:15:59.1206682 +08:00 |
| Format | PostgreSQL native custom archive (`pg_dump -Fc`) |
| Archive size | 346,043 bytes |
| ACL | PASS - `BUILTIN\\Administrators`, `NT AUTHORITY\\SYSTEM` only |
| Archive validation | PASS - `pg_restore --list` completed and required TN tables plus `candidate_code_sequence` were present |

The previously validated pre-Full-Import archive remains present and non-empty. It was not overwritten, deleted, or copied outside the VPS.

## 62. Baseline and Regression Confirmation

Immediately after archive creation, the production baseline remained unchanged:

| Aggregate | Result |
|---|---:|
| Candidates | 180 |
| Candidate external references | 180 |
| Work rows | 516 |
| Education rows | 137 |
| Candidate-linked document metadata rows | 229 |
| Migration ledger | 1 |

| Regression check | Result |
|---|---|
| PostgreSQL / IIS / SQL Server | Running / Running / Running |
| TN API health / list / known detail / unknown detail / unauthorized list | 200 / 200 / 200 / 404 / 401 |
| Pinpin Chinese / English `/webapp/` | 200 / 200 |
| PostgreSQL listener | `127.0.0.1:5432` only |
| SQL Server TCP 1433 listener | absent, unchanged |
| Pinpin writes / BLOB reads in Phase 4D.1 | 0 / 0 |

## 63. Recovery-Point Classification and Next Gate

Two PostgreSQL-native recovery points are retained separately:

1. **PRE-FULL-IMPORT BACKUP** - created before Phase 4D and restore-verified in Phase 4C.2.
2. **POST-INITIAL-IMPORT BACKUP** - the archive above, representing the clean 180-candidate Phase 4D baseline before any incremental-sync work.

VPS/provider image-backup coverage remains UNVERIFIED and is operational follow-up work. PostgreSQL-native recovery is now verified as a retained pre-import recovery point plus a validated post-initial-import archive. No recurring backup automation was created.

**PHASE 4E READINESS: GREEN.** Phase 4E incremental synchronization remains unstarted and requires separate design and explicit approval.

**PHASE 4D.1 POST-INITIAL-IMPORT BACKUP REVIEW REQUIRED.**

---

# Phase 4E.1 - Incremental Sync Contract and Signal Validation

## 64. Signal Inventory and Reliability Matrix

Targeted read-only schema inspection was limited to the approved incremental-detection tables and columns. No BLOB column was selected.

| Change type | Detection signal | Reliability | Required fallback |
|---|---|---|---|
| New candidate | `ZPResumeInfo.ID` identity high-water | VERIFIED PARTIAL | periodic full reconciliation; reseed/reuse remains unproven |
| Core, phone/email, or note edit | `ZPResumeInfo_Note(ResumeID, LastDate, ID)` | VERIFIED PARTIAL | bounded aggregate reload plus periodic full reconciliation |
| Work add/edit/delete | no verified child timestamp; IDs can be replaced by UI save | NOT RELIABLE alone | history signal plus periodic full reconciliation |
| Education add/edit/delete | no verified child timestamp; IDs can be replaced by UI save | NOT RELIABLE alone | history signal plus periodic full reconciliation |
| Attachment add | `Annex_Other.ID`, `ZPResumeInfo_ID`, `CreDate` | VERIFIED RELIABLE for additions linked to current master | aggregate metadata comparison |
| Attachment metadata change/delete/replacement | no verified update/delete state | VERIFIED PARTIAL | periodic full reconciliation |
| Inactive/delete | `zpresumeinfoDel(FID, DelDate, ID)` plus `ZPResumeInfo.Active` | VERIFIED RELIABLE for tested delete path | aggregate lifecycle comparison |
| Reactivation | no verified reactivation history contract | UNKNOWN | periodic full reconciliation |

`ZPResumeInfo.RDate` remains an nvarchar legacy field and is not a valid universal update watermark. No relevant rowversion or universal updated_at was found.

## 65. Dry-Run Detector and Bootstrap Result

The Phase 4E.1 detector was implemented as a Pinpin read-only, TN-zero-write utility. It reads only candidate IDs and approved signal metadata, deduplicates candidate IDs while retaining reason sets, and does not import or reconcile candidates.

The dry run used a conservative bootstrap replay cursor (`candidate_id > 0`) because no source cursor snapshot was persisted at the precise Phase 4D completion boundary. This prevents skipping changes in the Phase 4D-to-4E gap.

| Dry-run metric | Result |
|---|---:|
| Current master candidate IDs discovered | 180 |
| Candidate ID high-water | 43184 |
| History rows / current-master candidates signalled | 53 / 44 |
| Attachment rows / current-master candidates signalled | 229 / 175 |
| Tombstone rows / current-master candidates signalled | 10 / 7 |
| Multi-signal candidates deduplicated | 175 |
| TN candidate writes / Pinpin writes / BLOB reads | 0 / 0 / 0 |

The raw attachment and tombstone tables contain historical rows whose candidate relation is absent from the current master population. The detector now filters every history, attachment, and tombstone event through the current master candidate-ID set before it can enter the final candidate set.

## 66. Cursor and Recovery Contract

Each signal needs its own replayable cursor; no single timestamp is sufficient.

| Signal | Safe cursor semantics |
|---|---|
| Candidate creation | `ID > high_water`; retain overlap/full reconciliation for reseed or exceptional backfill risk |
| History | lexicographic `(LastDate, ID)` cursor, inclusive overlap/replay; nullable dates are not authoritative |
| Attachment | `ID > high_water` for additions; retain `(CreDate, ID)` only as supplementary evidence |
| Delete | lexicographic `(DelDate, ID)` cursor with replay overlap; nullable/ambiguous events fall back to reconciliation |

Cursor state must be committed only after a later Phase 4E.2 aggregate reconciliation has completed successfully. A failed batch leaves the old cursor intact. At-least-once discovery is acceptable; missing a candidate is not.

## 67. Recommended Architecture and Remaining Unknowns

For the current 180-candidate population, the safest initial production architecture is **Option C**: full reconciliation on each future approved run, because the verified full true-no-op pass was approximately 1.3 seconds and eliminates missed child/attachment replacement changes. Multi-signal discovery should be retained as observability and a future scale path; the eventual scalable design is Option B (multi-signal discovery plus periodic full reconciliation).

Known gaps remain: candidate-ID reseed/reuse has not been proven impossible; history coverage is not universal; child-row edits/deletes have no reliable timestamp; attachment replacement/deletion and reactivation lack a complete source signal; and owner/source/taxonomy mappings remain deferred. No speculative cursor is persisted in this phase.

TypeScript build and the full automated suite passed (17/17), including high-water, history, attachment, delete, deduplication, replay/tie-stability, and zero-write detector coverage. Existing TN and Pinpin regression results remain PASS; no production service/network configuration changed.

**PHASE 4E.2 READINESS: GREEN.** The detector can safely identify candidate aggregates for controlled incremental reconciliation testing, beginning with the required reconciliation-first bootstrap. Phase 4E.2 remains unstarted pending explicit approval.

**PHASE 4E.1 INCREMENTAL CONTRACT REVIEW REQUIRED.**

---

# Phase 4E.2 - Controlled Change Reconciliation

## 68. Baseline Reconciliation Review Hold

Phase 4E.2 began with the required full-population baseline reconciliation after the reconciler was extended and tested to remove stale source-owned work, education, and document metadata rows. The implementation remains metadata-only for documents and does not read Pinpin BLOB columns.

| Baseline metric | Result |
|---|---:|
| Current Pinpin source population | 180 |
| Active / inactive source candidates | 173 / 7 |
| First-pass created / materially updated / unchanged / failed | 0 / 1 / 179 / 0 |
| First-pass duration | 1,569 ms |
| Second-pass created / materially updated / unchanged / failed | 0 / 0 / 180 / 0 |
| Second-pass duration | 1,476 ms |
| TN candidates / work / education / document metadata | 180 / 516 / 137 / 229 |
| Duplicate external refs / duplicate candidate codes | 0 / 0 |
| Orphan work / education / documents | 0 / 0 / 0 |
| Candidate identity stability across both passes | PASS |
| Pinpin writes by TN / BLOB reads | 0 / 0 |

The first pass identified one pre-existing source-to-target core fingerprint difference for external candidate ID `43181`. Sanitized TN-side metadata confirms that it was a core projection difference only; no work, education, or document metadata group was reconciled for that candidate. The immediate second pass was a complete true no-op, which proves the target is now consistent with the currently observed source state.

Candidate `43181` is not the approved Phase 4E.2 controlled fixture (`43184`). Per the approved Phase 4E.2 baseline stop condition, this is recorded as an unexplained production change and no Stage A source modification or subsequent controlled reconciliation was started. No Pinpin data was modified programmatically.

TypeScript build and the full automated suite passed **18/18**, including focused coverage for core-only reconciliation, work add/edit/delete, education add/edit/delete, document metadata add/delete, stable candidate identity, and final full no-op behavior.

**PHASE 4E.2 BASELINE REVIEW REQUIRED.**

## 69. Baseline Approval and Stage A - Controlled Core Edit

The `43181` baseline difference was explicitly confirmed by the administrator as an expected normal Pinpin production change. It is therefore not a Phase 4E.2 anomaly. The first baseline pass reconciled only that candidate; the second pass was `180/180` unchanged.

Stage A then used only approved active synthetic fixture external candidate ID `43184`. The administrator changed one reversible synthetic core field (candidate name) through the normal Pinpin UI and saved it. No Codex/TN process issued a Pinpin write.

| Stage A technical result | Result |
|---|---:|
| Source candidate population | 180 |
| First-pass created / materially updated / unchanged / failed | 0 / 1 / 179 / 0 |
| First-pass duration | 1,432 ms |
| Second-pass created / materially updated / unchanged / failed | 0 / 0 / 180 / 0 |
| Second-pass duration | 1,278 ms |
| Controlled fixture source state | active; not deleted |
| Fixture work / education / document metadata counts after reconciliation | 2 / 1 / 2 |
| Core, work, education, and document aggregate fingerprints after reconciliation | all match source |
| TN UUID / candidate code / external reference | stable / stable / exactly one |
| Final duplicate refs/codes | 0 / 0 |
| Final orphan work/education/documents | 0 / 0 / 0 |
| Pinpin writes by TN / BLOB reads | 0 / 0 |

The normal Pinpin UI save also reissued the fixture's work and education source-record identifiers. This is consistent with the previously verified UI-save behavior. Full aggregate reconciliation updated the relevant source identity mapping without creating duplicate child rows; source content is represented only by deterministic metadata/fingerprints in this validation record. Document metadata did not change.

**STAGE A PASS - PHASE 4E.2 CONTROLLED CHANGE REVIEW REQUIRED BEFORE STAGE B.**

## 70. Stage A.1 - Child-Identity Stability Review (Read Only)

No reconciliation and no Pinpin UI action was executed for this review. The evidence was limited to candidate `43184`, approved source metadata, and TN child metadata/timestamps. No candidate content or attachment BLOB was read.

| Check | Result |
|---|---|
| Pinpin work snapshot identifiers before / after Stage A | `672, 673` / `679, 680` |
| Pinpin education snapshot identifier before / after Stage A | `178` / `181` |
| TN work rows / education rows | 2 / 1 |
| TN work internal UUIDs created before Stage A | YES, both |
| TN education internal UUID created before Stage A | YES |
| TN work / education rows updated during Stage A | YES, provenance mapping only |
| TN child physical delete/recreate evidence | NONE |
| Work duplicate / orphan count | 0 / 0 |
| Education duplicate / orphan count | 0 / 0 |

This confirms that the Pinpin UI can reissue `ZPResumeWork.ID` and `ZPResumeEdu.ID` during an unrelated candidate-core save. Those values are therefore **not durable child identities**. They are retained in TN as source provenance and matching hints. TN uses its own stable UUID child identity; reconciliation first attempts the current source ID, then uses a deterministic semantic fingerprint to preserve the equivalent TN row when Pinpin reissues the source ID.

**CHILD IDENTITY STABILITY = PASS.** TN work and education internal identities did not churn solely because Pinpin reissued source row IDs. **STAGE B READINESS = GREEN.** Stage B remains unstarted pending separate approval.

## 71. Stage B - Controlled Work Edit (Review Hold)

Stage B used only synthetic fixture `43184`. The administrator saved edits to the department field on both existing work rows rather than the originally requested single row. This is recorded as a controlled two-row work-edit deviation; no real candidate was modified and no Codex/TN process issued a Pinpin write.

| Stage B reconciliation result | Result |
|---|---:|
| Source population observed | 180 |
| First-pass created / materially updated / unchanged / failed | 0 / 1 / 179 / 0 |
| First-pass duration | 1,459 ms |
| Second-pass created / materially updated / unchanged / failed | 0 / 0 / 180 / 0 |
| Second-pass duration | 1,362 ms |
| Pinpin work source snapshot IDs before / after | `679, 680` / `681, 682` |
| TN work count | 2 |
| Pre-Stage-B TN work UUID survivors | 1 of 2 |
| TN work rows created during Stage B | 1 |
| External reference count | 1 |
| Duplicate / orphan work rows | 0 / 0 |
| Work aggregate fingerprint after reconciliation | matches current source |
| Pinpin writes by TN / BLOB reads | 0 / 0 |

The complete aggregate reconciliation and second-run no-op behavior both passed. However, one of the two logical work rows did not retain its prior TN internal UUID: one existing TN work row survived and one was replaced by a newly created TN work row while total count remained two. This is not acceptable as proof of durable logical-work identity through a Pinpin source-ID reissue plus a semantic work edit.

The Stage B matching enhancement passed local synthetic coverage but production evidence shows that the current logical-match key is not yet sufficient for every existing synthetic work row. No further source change was performed. Stage C is not authorized to begin until the matching strategy and this evidence are reviewed.

**CHILD IDENTITY CONTRACT REVIEW REQUIRED. STAGE B = REVIEW HOLD.**

## 72. Stage B.1 - Child Logical Identity Strategy Review and Fix

### Root Cause and Contract

Stage B churn occurred because the former matcher used one full content fingerprint both as a change detector and as an identity fallback. When Pinpin reissued the source ID and the department changed, neither value matched. `ZPResumeWork.ID` and `ZPResumeEdu.ID` remain source provenance/matching hints only; TN child UUID remains the durable identity.

The matcher now separates identity from content: (1) exact current source-record match, (2) exact content match, then (3) candidate-local unique logical match. Work logical evidence is scored deterministically from company, title, industry, start date, end date, and current-role flag; department is deliberately excluded from this logical hint because it is a controlled mutable field. A match is accepted only when it is uniquely highest and meets the conservative threshold. Equal eligible candidates throw `ambiguous-child-identity`, causing the candidate transaction to roll back rather than silently remap or create a replacement. Content fingerprint is evaluated only after identity is selected.

No schema migration was required: the matching logic remains candidate-local and source `source_record_id` is retained as current provenance. Existing source schema evidence confirms no verified order, creation timestamp, change timestamp, or durable child relationship field. Source ordering is not used as identity. Company/title/industry/dates/current status are **verified useful hints**, not claimed durable; department and education description are **mutable**; source row order and hidden stable fields are **unknown**.

### Automated Coverage

The prior suite had 19 tests. The suite now has **20/20 PASS** after adding title-edit-with-source-ID-churn UUID retention and ambiguous-work fail-closed coverage, alongside existing source-ID churn/no-change, department edit, add, delete, education churn/edit, and no-op coverage. TypeScript build PASS.

### Current Stage B State and Restoration Decision

The Stage B historical evidence proves one of two original work UUIDs survived and one was replaced. The deleted pre-Stage-B UUID has no retained source-provenance alias or durable source-side child key, while source order is not verified stable. Therefore mapping the currently replaced logical row back to that exact old UUID cannot be proven unambiguously. No TN-side UUID swap or synthetic repair was performed.

**PRE-STAGE-B UUID RESTORATION REVIEW REQUIRED.** This is an intentional fail-closed result; no identity was manufactured.

### Post-Fix Stabilization

The deployed matcher was run against the unchanged current source state. Its second pass was a full `0 created / 0 materially updated / 180 unchanged / 0 failed` no-op in 1,147 ms. The first pass observed one independent, expected production change: external candidate `43181` document metadata (not `43184` and not work/education). It reconciled once and then became a no-op. Current aggregate integrity remains duplicate external refs `0`, orphan work/education/documents `0/0/0`.

TN-originated Pinpin INSERT/UPDATE/DELETE remains `0/0/0`; BLOB reads remain `0`. No Pinpin UI action was requested or performed in Stage B.1. Stage B retry and Stage C remain unstarted.

**PHASE 4E.2 STAGE B.1 CHILD IDENTITY REVIEW REQUIRED. STAGE B RETRY READINESS = YELLOW.** The forward matcher is tested and stable, but the historical Stage B UUID cannot be safely restored without further explicit review/evidence.

## 73. Phase 4E.2 - Stage B Retry

The pre-fix historical UUID is explicitly not restored. The current two TN work UUIDs were recorded as the forward baseline. The administrator changed only the current-role department to the approved B2 trace through normal Pinpin UI.

| Result | Value |
|---|---:|
| First pass created / updated / unchanged / failed | 0 / 1 / 179 / 0 |
| Second pass created / updated / unchanged / failed | 0 / 0 / 180 / 0 |
| Work UUID baseline survivors | 2 of 2 |
| Work count / duplicate / orphan | 2 / 0 / 0 |
| Candidate UUID/code/external ref | stable / stable / exactly one |
| Pinpin writes / BLOB reads | 0 / 0 |

**PHASE 4E.2 STAGE B RETRY REVIEW REQUIRED. Stage C remains unstarted.**

## 74. Phase 4E.2 - Stage C Work Add

The two forward work UUIDs were recorded before the administrator added one synthetic work row through normal Pinpin UI. After full reconciliation, both baseline UUIDs remained present and exactly one additional TN work UUID exists; fixture work count is now three. No existing work row was recreated, and work duplicate/orphan integrity remains zero.

| Result | Value |
|---|---:|
| First pass created / updated / unchanged / failed | 0 / 2 / 178 / 0 |
| Controlled fixture work delta | +1 TN work UUID |
| Second pass created / updated / unchanged / failed | 0 / 0 / 180 / 0 |
| Work total / duplicate / orphan | 517 / 0 / 0 |
| Pinpin writes / BLOB reads | 0 / 0 |

One independent document-metadata change was also observed in the same first full population pass; it is distinct from the controlled work addition and the second pass was complete no-op. **PHASE 4E.2 STAGE C REVIEW REQUIRED. Stage D remains unstarted.**

## 75. Phase 4E.2 - Stage D Work Delete

All three work UUIDs were recorded before the administrator deleted only the uniquely identified Stage C synthetic work row through normal Pinpin UI. Full reconciliation removed that synthetic TN work row only. The two pre-existing forward UUIDs remained exactly present; fixture work count returned from three to two.

| Result | Value |
|---|---:|
| First pass created / updated / unchanged / failed | 0 / 1 / 179 / 0 |
| Stage C synthetic work row removed | YES |
| Original work UUIDs preserved | 2 of 2 |
| Second pass created / updated / unchanged / failed | 0 / 0 / 180 / 0 |
| Work total / duplicate / orphan | 516 / 0 / 0 |
| Pinpin writes / BLOB reads | 0 / 0 |

**PHASE 4E.2 STAGE D REVIEW REQUIRED. Education stages remain unstarted.**

## 76. Phase 4E.2 - Stage E.1 Post-Deploy Stabilization

No Pinpin change was made. The deployed education matcher reconciled the current 180-candidate source population twice: both passes returned `0 created / 0 updated / 180 unchanged / 0 failed`. Candidate `43184` therefore received no provenance or content adjustment. Education count remains one and aggregate duplicate/orphan integrity remains zero; work count and all candidate identities remain unchanged. Pinpin writes and BLOB reads remain zero.

**PHASE 4E.2 STAGE E.1 STABILIZATION REVIEW REQUIRED. Stage E retry remains unstarted.**

## 77. Phase 4E.2 - Stage E Retry (Forward Education UUID Stability)

### Forward Baseline and Controlled Source Action

The original pre-fix Stage E education UUID churn is retained as historical
synthetic-test evidence only. The prior deleted UUID was not restored because
there was no durable source-side alias that could prove the mapping safely.
After the Stage E.1 matcher deployment and two-pass no-op stabilization, the
current TN Education UUID was approved as the forward durable baseline.

Before this retry, synthetic Pinpin candidate `43184` had exactly one education
row, current Pinpin education source ID `186`, and current TN education UUID
`019ff129-ba76-761d-bc61-d743ae984f61`. It also had two recorded forward TN
work UUIDs. The administrator then changed only the approved education detail
through the normal Pinpin UI to the synthetic value `TN-E2-EDU-EDIT-E2`.
No Codex/TN process issued a Pinpin write.

### Reconciliation Result

| Check | Result |
|---|---:|
| Live source population | 180 |
| First pass created / materially updated / unchanged / failed | 0 / 1 / 179 / 0 |
| First pass duration | 1,218 ms |
| Second pass created / materially updated / unchanged / failed | 0 / 0 / 180 / 0 |
| Second pass duration | 1,169 ms |
| Pinpin education source ID before / after | 186 / 187 |
| TN education UUID before / after | same current forward UUID / same current forward UUID |
| Education detail source and TN metadata | exact approved synthetic value / exact match |
| Fixture education count | 1 |
| Fixture work UUID survivors | 2 of 2 |
| Candidate UUID / code / external ref | stable / stable / exactly one |
| Education duplicate / orphan count | 0 / 0 |
| Aggregate work / education / document metadata | 516 / 137 / 231 |
| Aggregate duplicate external refs / candidate codes | 0 / 0 |
| Aggregate orphan work / education / documents | 0 / 0 / 0 |
| TN-originated Pinpin writes / BLOB reads | 0 / 0 |

The Pinpin education source record ID changed from `186` to `187`, while the
same logical education retained the current TN UUID. This is the required
forward proof that the logical matcher treats Pinpin child IDs as provenance
hints rather than durable TN child identity. No education delete/recreate was
observed in TN. Both work UUIDs also remained stable despite Pinpin reissuing
their source IDs during the normal UI save.

### Build and Operational Regression Checks

- TypeScript build: PASS.
- Full automated suite: **20/20 PASS**.
- TN `/health`: HTTP 200.
- Authenticated candidate list: HTTP 200; unknown candidate contract: HTTP 404.
- Pinpin Chinese `/webapp/`: HTTP 200.
- Pinpin English `/webapp/`: HTTP 200.
- PostgreSQL, IIS/W3SVC, and SQL Server services: Running.
- PostgreSQL `5432` and TN API `3333` listeners: `127.0.0.1` only.

**PHASE 4E.2 STAGE E RETRY REVIEW REQUIRED. Stage F Education Add remains
unstarted.**

## 78. Phase 4E.2 - Stage F Education Add

### Controlled Source Action and Taxonomy Observation

Before the action, synthetic candidate `43184` had one education row with
forward durable TN Education UUID `019ff129-ba76-761d-bc61-d743ae984f61` and
two recorded forward TN work UUIDs. The administrator added exactly one
synthetic education row through the normal Pinpin UI; no existing education,
work, candidate-core field or document was edited.

The Pinpin education taxonomy is a UI-controlled dropdown. The administrator
could not enter the requested free text for degree and selected the actual
available simplified-Chinese option `硕士`. The source adapter observed that
exact source value and TN retained it unchanged. The current Pinpin source
projection places this UI selection in `major_raw` and the supplied synthetic
major text in `degree_raw`; this is recorded as a **source UI/column semantic
mapping observation**, not silently normalized or translated by TN. Stage F
validates source-to-TN lifecycle/identity behavior, so validation uses the
actual saved source record as truth.

### Reconciliation Result

| Check | Result |
|---|---:|
| Live source population | 180 |
| First pass created / materially updated / unchanged / failed | 0 / 1 / 179 / 0 |
| First pass duration | 1,381 ms |
| Second pass created / materially updated / unchanged / failed | 0 / 0 / 180 / 0 |
| Second pass duration | 1,186 ms |
| Pinpin education source IDs before / after | `187` / `188, 189` |
| Education count before / after | 1 / 2 |
| Original forward TN Education UUID preserved | YES |
| New TN Education UUID created | `019ff142-9629-725b-a8f8-378dac8253b3` |
| Exactly one new TN Education UUID | YES |
| Existing education content | unchanged; approved E2 detail retained |
| New education content | exact match to the actual saved Pinpin source row, including `硕士` |
| Work UUID survivors | 2 of 2 |
| Candidate UUID / code / external ref | stable / stable / exactly one |
| Education duplicate / orphan count | 0 / 0 |
| TN-originated Pinpin writes / BLOB reads | 0 / 0 |

The normal Pinpin UI save reissued both source education IDs and work IDs. The
original logical education retained its forward TN UUID, and exactly one new
TN UUID was allocated for the added logical education. No existing education
was deleted/recreated and no unexpected third education row was produced.

### Build and Operational Regression Checks

- TypeScript build: PASS.
- Full automated suite: **20/20 PASS**.
- TN `/health`, authenticated candidate list and candidate detail: HTTP 200.
- Unknown candidate contract: HTTP 404.
- Pinpin Chinese and English `/webapp/`: HTTP 200.
- PostgreSQL, IIS/W3SVC and SQL Server: Running.
- PostgreSQL `5432` and TN API `3333`: `127.0.0.1` listeners only.

**PHASE 4E.2 STAGE F EDUCATION ADD REVIEW REQUIRED. Stage G Education Delete
readiness is GREEN for the controlled lifecycle test; the observed Pinpin
education taxonomy column semantics remain a separately recorded contract
follow-up.**

## 79. Phase 4E.2 - Stage G Education Delete

### Controlled Source Action

Before the action, synthetic candidate `43184` had two TN education UUIDs:
the original forward durable UUID `019ff129-ba76-761d-bc61-d743ae984f61` and
the Stage F synthetic UUID `019ff142-9629-725b-a8f8-378dac8253b3`. The
administrator used the normal Pinpin UI to delete only the Stage F row
identified by school `TN STAGE F TEST UNIVERSITY`. No candidate-core, work,
document or original education content was modified. Simplified-Chinese source
taxonomy values were not translated or normalized.

### Reconciliation Result

| Check | Result |
|---|---:|
| Live source population | 180 |
| First pass created / materially updated / unchanged / failed | 0 / 1 / 179 / 0 |
| First pass duration | 1,452 ms |
| Second pass created / materially updated / unchanged / failed | 0 / 0 / 180 / 0 |
| Second pass duration | 1,249 ms |
| Pinpin education source IDs before / after | `188, 189` / `190` |
| Education count before / after | 2 / 1 |
| Original forward TN Education UUID preserved | YES |
| Original education content | unchanged; approved E2 detail retained |
| Stage F synthetic TN Education UUID removed | YES |
| Unexpected replacement education UUID | NO |
| Forward TN Work UUID survivors | 2 of 2 |
| Candidate UUID / code / external ref | stable / stable / exactly one |
| Education duplicate / orphan count | 0 / 0 |
| Work orphan count | 0 |
| Aggregate work / education / document metadata | 516 / 137 / 231 |
| Aggregate duplicate external refs / candidate codes | 0 / 0 |
| Aggregate orphan work / education / documents | 0 / 0 / 0 |
| TN-originated Pinpin writes / BLOB reads | 0 / 0 |

The normal Pinpin UI save reissued the remaining education source ID and the
two work source IDs. The reconciliation treated those values as current source
provenance only: the original logical education retained its TN UUID, the
deleted Stage F UUID did not reappear, and no substitute TN education UUID was
created.

### Build and Operational Regression Checks

- TypeScript build: PASS.
- Full automated suite: **20/20 PASS**.
- TN `/health`, authenticated candidate list and candidate detail: HTTP 200.
- Unknown candidate contract: HTTP 404.
- Pinpin Chinese and English `/webapp/`: HTTP 200.
- PostgreSQL, IIS/W3SVC and SQL Server: Running.
- PostgreSQL `5432` and TN API `3333`: `127.0.0.1` listeners only.

**PHASE 4E.2 STAGE G EDUCATION DELETE REVIEW REQUIRED. Education
Edit/Add/Delete validation is COMPLETE. Attachment-stage readiness is GREEN;
attachment testing remains unstarted pending separate approval.**

## 80. Phase 4E.2 - Stage H Attachment Add

### Scope and Live Baseline

This stage used only synthetic candidate `43184` and only the approved
attachment metadata projection: attachment ID, candidate relation, filename,
type, size and created time. `Annex` and `Annex1` were not selected; no file
content or BLOB was read, copied or stored. Before the user action, the live
fixture had two source attachment metadata IDs (`996`, `997`) and two matching
TN document metadata identities. Candidate, work and education UUID baselines
were recorded without exposing attachment filenames.

The administrator added exactly one harmless synthetic, non-PII attachment
through the normal Pinpin UI. A source-only re-read before reconciliation
confirmed an exact controlled delta: existing metadata IDs remained present
and one new source metadata ID (`1003`) appeared. No reconciliation was run
until this +1 check passed.

### Reconciliation Result

| Check | Result |
|---|---:|
| Live source population | 180 |
| Fixture source document metadata before / after | 2 / 3 |
| Source attachment IDs before / after | `996, 997` / `996, 997, 1003` |
| First pass created / materially updated / unchanged / failed | 0 / 1 / 179 / 0 |
| First pass duration | 1,538 ms |
| Second pass created / materially updated / unchanged / failed | 0 / 0 / 180 / 0 |
| Second pass duration | 1,282 ms |
| TN fixture document metadata before / after | 2 / 3 |
| Baseline TN document identities preserved | YES, 2 of 2 |
| New TN document metadata identity | `019ff151-07ad-71a6-b3f6-f17ed6f12bed` |
| Exactly one new TN document identity | YES |
| New metadata source-to-TN match | PASS, approved metadata fields match |
| Candidate UUID / code / external ref | stable / stable / exactly one |
| Work UUID survivors | 2 of 2 |
| Education UUID survivor | 1 of 1 |
| Document duplicate / orphan count | 0 / 0 |
| Aggregate document metadata count | 232 |
| Aggregate duplicate external refs / candidate codes | 0 / 0 |
| Aggregate orphan work / education / documents | 0 / 0 / 0 |
| TN-originated Pinpin writes | 0 |
| Annex reads / Annex1 reads / BLOB reads | 0 / 0 / 0 |

The initial complete metadata fingerprint comparison differed only because
SQL Server and PostgreSQL serialize the same timestamp in different raw string
formats. A field-level, normalized-time comparison verified for all three
fixture metadata rows that filename, extension/type, size and created-time
semantics match source exactly. No filename or document content is included in
this report.

### Build and Operational Regression Checks

- TypeScript build: PASS.
- Full automated suite: **20/20 PASS**.
- TN `/health`, authenticated candidate list and candidate detail: HTTP 200.
- Unknown candidate contract: HTTP 404.
- Pinpin Chinese and English `/webapp/`: HTTP 200.
- PostgreSQL, IIS/W3SVC and SQL Server: Running.
- PostgreSQL `5432` and TN API `3333`: `127.0.0.1` listeners only.

**PHASE 4E.2 STAGE H ATTACHMENT ADD REVIEW REQUIRED. Attachment Delete
readiness is GREEN; Attachment Delete remains unstarted pending separate
approval.**

## 81. Phase 4E.2 - Stage I Attachment Delete

### Controlled Source Delta

This stage used only synthetic candidate `43184` and the approved attachment
metadata projection. Before the user action, source attachment IDs were
`996, 997, 1003`; the Stage H synthetic metadata row was ID `1003`, represented
in TN by document UUID `019ff151-07ad-71a6-b3f6-f17ed6f12bed`. The two older
document identities were recorded as the durable baseline. No attachment
filename, content, BLOB or `Annex` / `Annex1` column was exposed or read.

The administrator deleted only the Stage H synthetic attachment through the
normal Pinpin UI. A source-only metadata re-read completed before
reconciliation and verified the required exact delta: `1003` was absent,
`996` and `997` remained, and the metadata count changed `3 -> 2`.

### Reconciliation Result

| Check | Result |
|---|---:|
| Live source population | 180 |
| Fixture source attachment IDs before / after | `996, 997, 1003` / `996, 997` |
| Fixture document metadata count before / after | 3 / 2 |
| First pass created / materially updated / unchanged / failed | 0 / 1 / 179 / 0 |
| First pass duration | 1,271 ms |
| Second pass created / materially updated / unchanged / failed | 0 / 0 / 180 / 0 |
| Second pass duration | 1,217 ms |
| Baseline TN document identities preserved | YES, 2 of 2 |
| Stage H TN document UUID removed | YES |
| Unexpected replacement document UUID | NO |
| Candidate UUID / code / external ref | stable / stable / exactly one |
| Work UUID survivors | 2 of 2 |
| Education UUID survivor | 1 of 1 |
| Document duplicate / orphan count | 0 / 0 |
| Aggregate document metadata count | 231 |
| Aggregate duplicate external refs / candidate codes | 0 / 0 |
| Aggregate orphan work / education / documents | 0 / 0 / 0 |
| TN-originated Pinpin writes | 0 |
| Annex reads / Annex1 reads / BLOB reads | 0 / 0 / 0 |

This confirms the approved Option C full-source reconciliation safely detects
and removes stale TN document metadata when the Pinpin source row disappears.
It preserves pre-existing document identities, does not create a replacement,
and does not depend on a separate attachment-delete signal.

### Build and Operational Regression Checks

- TypeScript build: PASS.
- Full automated suite: **20/20 PASS**.
- TN `/health`, authenticated candidate list and candidate detail: HTTP 200.
- Unknown candidate contract: HTTP 404.
- Pinpin Chinese and English `/webapp/`: HTTP 200.
- PostgreSQL, IIS/W3SVC and SQL Server: Running.
- PostgreSQL `5432` and TN API `3333`: `127.0.0.1` listeners only.

**PHASE 4E.2 STAGE I ATTACHMENT DELETE REVIEW REQUIRED. Attachment
Add/Delete validation is COMPLETE. Lifecycle-stage readiness is GREEN;
lifecycle testing remains unstarted pending separate approval.**

## 82. Phase 4E.2 - Stage J Lifecycle Inactive / Delete

### Controlled Fixture and Source Delta Gate

This stage did not alter long-term synthetic fixtures `43184` or `43177`.
The administrator created and then, through the normal Pinpin UI, deleted
only the dedicated minimal lifecycle fixture `43185`. No real candidate,
work, education, or attachment was used for this controlled test.

Before the lifecycle action, the fixture had a stable TN candidate UUID
`019ff15f-b646-734c-b25f-517e49c71769`, candidate code `TN00000181`, one
active external reference, no lifecycle event, and source/TN child metadata
counts of work / education / document = `1 / 0 / 1`. The creation baseline
reconciliation was `1 / 0 / 180 / 0` (created / materially updated /
unchanged / failed); its immediate second pass was a full `0 / 0 / 181 / 0`
no-op.

After the user action, a source-only read completed before reconciliation.
It confirmed the required lifecycle shape: the `ZPResumeInfo` master row
still exists, `Active = 0`, exactly one tombstone row with a deletion time is
present, and source child counts remain `1 / 0 / 1`. The current retained
source metadata identifiers are work `698` and document `1004`; no BLOB,
`Annex`, or `Annex1` column was selected. Therefore the lifecycle source
contract passed and reconciliation was permitted.

### Reconciliation Result

| Check | Result |
|---|---:|
| Live source population | 181 |
| Source active / inactive population | 173 / 8 |
| Source master row retained | YES |
| Source lifecycle condition | `Active=0` + one dated tombstone |
| Source child counts work / education / document | 1 / 0 / 1 (unchanged) |
| First pass created / materially updated / unchanged / failed | 0 / 1 / 180 / 0 |
| First pass duration | 1,422 ms |
| Second pass created / materially updated / unchanged / failed | 0 / 0 / 181 / 0 |
| Second pass duration | 1,491 ms |
| Candidate UUID / candidate code | preserved / preserved |
| External reference | exactly one, retained |
| TN external reference active / deleted timestamp | false / present |
| Deleted lifecycle events for fixture | exactly 1 |
| Fixture TN child counts work / education / document | 1 / 0 / 1 |
| Duplicate external references | 0 |
| Orphan work / education / documents | 0 / 0 / 0 |
| TN-originated Pinpin writes | 0 |
| Annex reads / Annex1 reads / BLOB reads | 0 / 0 / 0 |

This verifies the intended contract: Pinpin lifecycle deletion is represented
in TN as retained candidate identity plus inactive/deleted external-reference
state and one durable lifecycle event. TN does not hard-delete the candidate,
does not recreate it, and does not remove unchanged child metadata solely due
to the parent lifecycle transition. Reactivation remains deliberately
untested and deferred.

### Build and Operational Regression Checks

- TypeScript build: PASS.
- Full automated suite: **20/20 PASS**.
- TN `/health`, authenticated candidate list and unknown-candidate contract:
  HTTP `200 / 200 / 404`.
- Pinpin Chinese and English `/webapp/`: HTTP 200.
- PostgreSQL, IIS/W3SVC and SQL Server: Running.
- PostgreSQL `5432` and TN API `3333`: `127.0.0.1` listeners only.

**PHASE 4E.2 STAGE J LIFECYCLE DELETE REVIEW REQUIRED. Stage J PASS pending review.
Reactivation remains deferred. Do not start Phase 4E.3, scheduled
synchronization, Phase 5, or Phase 6 without separate approval.**

## 83. Phase 4E.3 - Recovery / Replay

### Scope and Recovery Contract Review

Phase 4E.3 used the unchanged live Pinpin source only. No Pinpin candidate
was created, edited, deleted, reactivated, or otherwise modified. The source
adapter remained read-only, and attachment access remained limited to approved
metadata; `Annex`, `Annex1`, and BLOB content were never selected.

The current Option C reconciler opens a PostgreSQL transaction per candidate,
commits each successful aggregate independently, and rolls back the candidate
transaction on an error. `sync_runs` and `sync_errors` already provide the
run ledger; no migration or cursor schema was added. Full-source replay is the
correctness path, therefore **SIGNAL CURSOR PERSISTENCE = DEFERRED / NOT
REQUIRED FOR OPTION C**.

One narrowly scoped automated test was added. A test-only `beforeCommit` hook
throws after candidate projection, child reconciliation, and lifecycle logic,
but before `COMMIT`. The test verifies that `COMMIT` is absent, `ROLLBACK` is
issued, and a clean replay followed by a second replay creates no duplicate
candidate, external reference, child, or lifecycle identity. The hook is
dependency-injected only by the test suite. It is not wired into the API,
Windows startup task, or normal import environment.

For the production-shaped interruption, `import-full` recognizes a fault only
when both `TN_RECOVERY_TEST_MODE=1` and an explicit abort threshold of at
least two are supplied to that one runner process. It is not enabled by
default. The approved run stopped after five successfully committed candidate
transactions, between candidate transactions; it exited non-successfully and
the corresponding ledger row is `failed`.

### Clean Baseline

Before fault injection, a normal full reconciliation observed the live source
population of 181 and completed two complete no-op passes:

| Check | Result |
|---|---:|
| First baseline created / materially updated / unchanged / failed | 0 / 0 / 181 / 0 |
| Second baseline created / materially updated / unchanged / failed | 0 / 0 / 181 / 0 |
| TN Pinpin-scoped candidates / external refs | 181 / 181 |
| Work / education / document metadata | 517 / 137 / 232 |
| Lifecycle events | 8 |
| Duplicate external refs / candidate codes / lifecycle events | 0 / 0 / 0 |
| Orphan work / education / documents | 0 / 0 / 0 |

Regression fixture fingerprints were recorded without PII. Candidate UUID,
candidate code, external-reference identity, source lifecycle state and child
counts were unchanged for `43177` (1 / 0 / 3), `43184` (2 / 1 / 2), and
`43185` (1 / 0 / 1) across the interruption, recovery, and final replay.

### Controlled Interruption and Replay

The first instrumentation attempt exposed that the runner's ordinary
per-candidate error accumulator intercepted the test abort. It recorded a
failed ledger run (four successful no-op candidates and 177 failures), made no
source writes, and did not affect data integrity, but it was rejected as the
Phase 4E.3 interruption result. The runner was corrected so the explicit
test-only abort is rethrown to the batch boundary. Build and tests were rerun
before the single accepted interruption.

| Run | Ledger status | Result |
|---|---|---|
| Clean baseline | succeeded | `0 / 0 / 181 / 0`, followed by same no-op pass |
| Rejected instrumentation attempt | failed | retained as failed audit evidence; not counted as the accepted interruption |
| Controlled interruption | failed | deterministic abort after 5 committed candidate transactions; non-zero runner exit |
| Recovery replay | succeeded | first / second pass `0 / 0 / 181 / 0` |
| Final replay | succeeded | first / second pass `0 / 0 / 181 / 0` |

The accepted interrupted run is recorded by the existing ledger with
`controlledRecoveryAbort=true`, `processedBeforeFailure=5`, `records_failed=1`
and status `failed`. It is not marked successful. The recovery and final
replay rows are separately labeled and successful. This confirms the ledger
distinguishes the clean baseline, failed interruption, recovery, and final
no-op without a schema change.

### Integrity and Operational Regression

- Recovery and final replay: no candidates created, updated, or failed; all
  181 observed candidates were unchanged on every pass.
- Candidate/external-reference/candidate-code/lifecycle duplicates: 0 / 0 / 0.
- Orphan work / education / documents: 0 / 0 / 0.
- No unexpected candidate, work, education, document, or lifecycle UUID churn.
- TypeScript build: PASS. Full automated suite: **21/21 PASS**.
- TN `/health`, authenticated list, known candidate, unknown candidate:
  HTTP `200 / 200 / 200 / 404`.
- Pinpin Chinese and English `/webapp/`: HTTP 200.
- PostgreSQL, IIS/W3SVC and SQL Server: Running.
- PostgreSQL `5432` and TN API `3333`: `127.0.0.1` listeners only.
- Pinpin writes: 0. Annex reads / Annex1 reads / BLOB reads: 0 / 0 / 0.

**PHASE 4E.3 RECOVERY / REPLAY REVIEW REQUIRED. Recovery/replay validation
PASS. Phase 4E.4 Manual Production Sync readiness is GREEN. Do not start
Phase 4E.4, scheduled synchronization, reactivation testing, Phase 5, or
Phase 6 without separate approval.**

## 84. Phase 4E.4 - Manual Production Sync

### Operator Entry Point

The single production operator command is:

```powershell
Set-Location E:\TalentNexus\tn-api
npm run pinpin:sync:manual
```

It is a thin manual wrapper around the existing Option C full-source runner;
there is no second reconciliation implementation. It loads only the already
protected TN and Pinpin source configuration files, verifies the local
`talentnexus` PostgreSQL database, obtains a PostgreSQL advisory lock, runs a
read-only Pinpin Shared Memory/LPC aggregate preflight, and invokes the
approved `import-full` runner. Its output is sanitized aggregate data only.

Exit code contract: `0` is a completed reconciliation with zero failed
candidates and a passing integrity gate. `2` is preflight/runner failure,
`3` is an already-held concurrent lock, `4` means candidate failures, and
`5` means post-run integrity failure. No secret, connection string, candidate
PII, attachment filename, or resume content is printed.

### Concurrency and Safety

The manual entrypoint uses a session-bound PostgreSQL advisory lock before
Pinpin preflight or reconciliation. A bounded production-safe lock-holder
test confirmed a concurrent invocation returns the sanitized `lock-held`
result with exit code `3`, and does not start reconciliation. The lock is
released with its session and is also explicitly released on normal command
completion; no filesystem flag or scheduler was introduced.

Focused automated coverage adds manual exit-contract and lock-held tests.
The suite also retains the Phase 4E.3 test-only transaction rollback/replay
coverage. The test-only recovery fault remains disabled unless explicit
per-process recovery variables are supplied; it is not used by the manual
operator command.

### Production Runs and Integrity

| Check | First manual run | Final manual rerun |
|---|---:|---:|
| Exit code | 0 | 0 |
| Observed | 181 | 181 |
| Created / materially updated / unchanged / failed | 0 / 0 / 181 / 0 | 0 / 0 / 181 / 0 |
| Sync-run ledger status | succeeded | succeeded |
| Duplicate external refs / candidate codes | 0 / 0 | 0 / 0 |
| Orphan work / education / documents | 0 / 0 / 0 | 0 / 0 / 0 |
| Pinpin writes | 0 | 0 |
| Annex / Annex1 / BLOB reads | 0 / 0 / 0 | 0 / 0 / 0 |

The final rerun is a complete true no-op. Regression fixture identities for
`43177`, `43184`, and `43185` remain stable. PostgreSQL, IIS/W3SVC and SQL
Server are running; TN `/health`, authenticated list, known detail and
unknown detail returned HTTP `200 / 200 / 200 / 404`; Pinpin Chinese and
English `/webapp/` returned HTTP 200. PostgreSQL `5432` and TN API `3333`
remain bound only to `127.0.0.1`; SQL Server TCP `1433` remains unavailable.

### Files and Operator Documentation

- `services/tn-api/src/pinpin/manual-sync.ts`
- `services/tn-api/src/pinpin/manual-sync-lock.ts`
- `services/tn-api/src/pinpin/manual-sync-contract.ts`
- `services/tn-api/src/pinpin/import-full.ts`
- `services/tn-api/src/pinpin/source-adapter.ts`
- `services/tn-api/tests/manual-sync.test.ts`
- `services/tn-api/package.json`
- `docs/TN_PINPIN_MANUAL_SYNC.md`

TypeScript build: PASS. Full automated suite: **23/23 PASS**.

**PHASE 4 IMPLEMENTATION COMPLETE. Scheduled Synchronization = NOT STARTED.
Reactivation = DEFERRED. Plugin Side-car = NOT STARTED. Phase 5+ = NOT
STARTED.**

**PHASE 4E.4 MANUAL PRODUCTION SYNC REVIEW REQUIRED.**

## 85. Phase 6A.1 - TN Backend AI Foundation

### Scope and Architecture

Phase 6A.1 adds an internal, optional server-side AI provider foundation only:

```text
TN Backend -> Gemini
```

No AI HTTP route was added. No candidate search, candidate embedding, vector
schema, enrichment record, Plugin change, Pinpin write, TNT migration, SOP
migration, or Netlify change was made. Existing Phase 4 manual synchronization
remains unchanged and the TN API remains bound to localhost.

### Implementation

The backend now has a small `AiProvider` boundary with structured-generation,
embedding and health-check contracts. `GeminiProvider` encapsulates the
official `@google/genai` SDK. Provider and model selection are configuration
driven; no Gemini model name is hardcoded into business logic.

`tn-ai.env` is optional. Its intended protected VPS path is
`E:\TalentNexus\config\tn-ai.env`; it was not created automatically and no
key was requested or read. A missing file or key reports `AI NOT CONFIGURED`
from `npm run ai:check` and does not affect TN API startup, candidate routes,
PostgreSQL, or the Pinpin manual sync. The key is neither logged nor returned
by configuration status, provider errors, command output, or HTTP responses.

### Validation

- `npm run ai:check` on the VPS: `AI NOT CONFIGURED`, exit 2, as expected
  before administrator-provided protected configuration.
- TypeScript build: PASS.
- Full automated suite: **26/26 PASS**, including absent-config, redaction,
  Gemini error normalization, structured generation, embedding, manual sync,
  and all existing reconciliation tests.
- TN `/health`, authenticated list, known detail, unknown detail: HTTP
  `200 / 200 / 200 / 404`.
- Pinpin Chinese and English `/webapp/`: HTTP 200.
- PostgreSQL, IIS/W3SVC and SQL Server: Running.
- PostgreSQL `5432` and TN API `3333`: `127.0.0.1` listeners only; SQL Server
  TCP `1433` remains unavailable.
- Pinpin manual sync command remains available; no reconciliation was run for
  this phase.
- Candidate data sent to Gemini: 0. Annex / Annex1 / BLOB reads: 0 / 0 / 0.

### Operator Setup

See `docs/TN_AI_BACKEND_SETUP.md`. An administrator must manually create the
protected `tn-ai.env`, enter the key and chosen models, then run:

```powershell
Set-Location E:\TalentNexus\tn-api
npm run ai:check
```

Existing TNT and SOP Netlify Gemini functions remain unchanged.

**PHASE 6A.1 BACKEND AI FOUNDATION REVIEW REQUIRED. Real Gemini connectivity
= PENDING ADMIN KEY. Plugin Side-car readiness is GREEN; Enrichment Contract
readiness is GREEN. Do not start Plugin side-car, Candidate Search, embeddings,
or enrichment work without separate approval.**

## 86. Phase 6A.2 - Enrichment / Provenance Contract

### Scope

Phase 6A.2 adds a TN-only, additive evidence layer. It creates the versioned
`candidate_enrichment_snapshots` table and a Standard Resume V1 validation and
persistence service. It does not alter Pinpin baseline candidate data,
external refs, work, education, documents, lifecycle, notes, owner or TN code.

Each snapshot retains validated JSONB payload plus source/provenance metadata,
payload fingerprint, idempotency key, optional AI/provider metadata and a
self-referential `supersedes_id`. Exact replay is idempotent; a changed payload
creates a new historical snapshot and latest retrieval orders by
`created_at DESC, id DESC`.

### Explicit Boundaries

- Candidate identity resolution/merge: NOT IMPLEMENTED.
- 104 durable identity promotion: UNVERIFIED / NOT IMPLEMENTED.
- LinkedIn external reference promotion: NOT IMPLEMENTED.
- Canonical Profile, Plugin Side-car, public enrichment endpoint, scheduled
  work, Candidate Search, embeddings, pgvector and vector indexes:
  NOT IMPLEMENTED.
- Gemini was not called. No candidate data was sent to an AI provider.
- Pinpin writes and Annex / Annex1 / BLOB reads: 0 / 0 / 0.

### Validation and Controlled TN-only Verification

TypeScript build and the full automated suite passed **28/28**. The added
coverage validates sparse/full Standard Resume V1 evidence, rejects malformed
or oversized input, preserves unknown forward-compatible fields, verifies
idempotent replay, history/latest behavior and asserts baseline tables are
unchanged.

The production controlled verification uses only the existing synthetic source
fixture mapping `43184` to its TN candidate. It stores synthetic evidence once,
replays it exactly, then stores a changed synthetic version. It verifies the
candidate code and external-ref/work/education/document/lifecycle counts remain
unchanged. No Pinpin query, write, BLOB read or AI request is performed.

Production deployment applied `002_phase6a2_enrichment.sql` to `talentnexus`
only. Database verification found the snapshot table, 8 constraints (including
2 foreign keys), 4 indexes, the migration ledger entry, and the two expected
synthetic snapshots with one supersession relation. Controlled verification
returned: first `created`, exact replay `unchanged`, changed payload `created`,
latest snapshot correct, candidate code stable and baseline counts stable.

TN `/health`, authenticated list, known candidate and unknown candidate again
returned HTTP `200 / 200 / 200 / 404`. Pinpin Chinese and English `/webapp/`
returned HTTP 200. PostgreSQL, IIS/W3SVC and SQL Server remained Running;
PostgreSQL 5432 and TN API 3333 remained bound only to `127.0.0.1` and no SQL
Server TCP 1433 listener appeared. The optional AI check remains available and
returned `AI NOT CONFIGURED` (expected exit 2); the existing manual Pinpin sync
module remains present. No service restart, firewall change or Pinpin change
was made.

See `docs/TN_ENRICHMENT_CONTRACT.md` for the complete data and provenance
contract.

**PHASE 6A.2 ENRICHMENT / PROVENANCE REVIEW REQUIRED. Do not start Plugin
Side-car, Canonical Profile, Candidate Search, embeddings, scheduled sync or a
subsequent Phase without explicit approval.**

## 87. Phase 6B.1 - Plugin Side-car Backend Intake

### Scope

Phase 6B.1 adds only the TN backend's localhost-only intake endpoint:
`POST /internal/plugin-sidecar/v1/candidate-enrichment`. The request contract
is versioned (`plugin_sidecar_intake_v1`) and reuses Standard Resume V1.
It requires exact Pinpin identity: `pinpin` + `pinpin-prod` + text external
candidate ID. The resolver queries the existing `source_instances` and
`candidate_external_refs` relation only; it never resolves by name, phone,
email, LinkedIn or 104 code, and never creates or merges identity records.

The endpoint reuses the existing localhost TN API bearer-token guard. That is
an internal control only: no Plugin token, browser credential, public HTTPS,
domain, reverse proxy, IIS, DNS or firewall change was introduced. Browser
authentication remains a mandatory future Phase 6B.2 design item before any
public exposure.

### Persistence and Safety

After exact resolution, the route calls the existing
`CandidateEnrichmentService`; it does not duplicate snapshot or idempotency
logic. First evidence returns 201/`created`, exact replay returns
200/`unchanged`, and changed evidence retains history and creates a new
snapshot. `correlationId` remains trace metadata and does not defeat payload
fingerprint idempotency.

Only `candidate_enrichment_snapshots` is writable. Candidate baseline,
identity/code, external refs, work, education, documents, lifecycle, notes and
owner remain unchanged. There are no Pinpin writes, Annex/Annex1/BLOB reads,
Gemini calls, embeddings, pgvector, Plugin changes or public routes. Logs and
responses are PII-safe and do not contain request payloads.

### Validation

TypeScript build: PASS. Full automated suite: **31/31 PASS**. New focused
coverage verifies valid/sparse intake, invalid contract handling, missing exact
identity handling, no auto-create, exact replay despite correlation ID change,
changed-payload history/latest behavior, baseline invariants, bearer guard and
PII-safe responses.

The controlled localhost verification uses only synthetic evidence bound to the
existing synthetic Pinpin mapping `43184`; it does not modify Pinpin. Regression
checks retain manual sync and AI/enrichment helper availability. TN health and
candidate contract, both Pinpin webapps, service state and localhost-only port
binding are checked after deployment.

Production controlled verification returned first `created`, exact replay
`unchanged`, changed payload `created`, two synthetic side-car snapshots and a
latest snapshot matching the changed request. The TN candidate code and all
external-ref/work/education/document/lifecycle baseline counts remained stable.
Pinpin writes and Annex / Annex1 / BLOB reads were `0 / 0 / 0 / 0`.

The deployed `TalentNexusApi` task was restarted only to load the new TN API
route. TN `/health`, authenticated list, known candidate and unknown candidate
returned `200 / 200 / 200 / 404`; both Pinpin `/webapp/` endpoints returned
HTTP 200. PostgreSQL, IIS/W3SVC and SQL Server remained Running. PostgreSQL
5432 and TN API 3333 remained `127.0.0.1` listeners only, with no TCP 1433
listener. The existing manual-sync, enrichment verifier and optional AI check
remain available; AI correctly reports `AI NOT CONFIGURED` while no protected
AI configuration is supplied.

See `docs/TN_PLUGIN_SIDECAR_BACKEND.md`.

**PHASE 6B.1 PLUGIN SIDE-CAR BACKEND REVIEW REQUIRED. Do not start Plugin
sender changes, public exposure, browser authentication, Candidate Search,
Canonical Profile, embeddings, Gemini candidate processing or later phases
without explicit approval.**

## 88. Phase 6B.2A-1 - TN Public Domain Edge

### Read-only Baseline and Hold

This checkpoint performed only narrow, readable, non-encoded PowerShell
inspection. The administrator later confirmed the GoDaddy A record and public
Google DNS resolution; Codex did not repeat that completed DNS check and did
not change the existing Netlify `api.talentnexus.com.tw` hostname.

The VPS has existing Pinpin IIS sites on 5678/5679, Default Web Site HTTP 80,
no installed IIS Rewrite/Proxy/Routing module or ACME client, no trusted
certificate for the new hostname, and no 443 listener. TN Fastify remains
`127.0.0.1:3333` and PostgreSQL remains `127.0.0.1:5432`; SQL Server TCP 1433
has no listener.
TN `/health` returned 200, both Pinpin webapps returned 200, and PostgreSQL,
IIS/W3SVC and SQL Server were Running.

No DNS, IIS, certificate, firewall, Fastify binding, Pinpin, Entra, Plugin or
Gemini change was made. The required next administrator action is to provide
the ACME notification email and explicitly authorize installation of only IIS
URL Rewrite, IIS ARR and a Windows ACME client. Certificate issuance and a
separate scoped IIS reverse proxy remain pending that decision.

See `docs/TN_PUBLIC_DOMAIN_EDGE.md`.

**Historical checkpoint only. The DNS hold was resolved and the completion
record is in section 89.**

## 89. Phase 6B.2A-1 - TN Public Domain Edge Completion

The DNS checkpoint was subsequently confirmed by the administrator. The
approved IIS URL Rewrite, IIS ARR and win-acme components were installed from
their official sources, and the isolated `TalentNexusApiEdge` IIS site was
created with host-header-only bindings for `tn-api.talentnexus.com.tw`.

Let's Encrypt issued a production hostname certificate. The public HTTPS
health endpoint returns 200 with normal certificate validation; HTTP redirects
to HTTPS. ARR forwards only this site's requests to `127.0.0.1:3333`; the
single shared ARR server setting enables proxy capability only and no Pinpin
rewrite rule, binding or content changed. Authentication forwarding was
verified with a status-only authenticated candidate-list request, while an
unauthenticated side-car POST returned 401. No token or candidate data was
logged in this verification.

External TCP checks show 3333, 5432 and 1433 remain unavailable. Fastify and
PostgreSQL remain loopback-only, no firewall port was added, and TN health plus
both Pinpin webapps returned 200. IIS/W3SVC, SQL Server and PostgreSQL remain
running. No Pinpin, SQL Server, Entra, Plugin, Gemini, existing
`api.talentnexus.com.tw`, or candidate data change occurred.

win-acme renewal is installed as the persistent Task Scheduler job
`win-acme renew (acme-v02.api.letsencrypt.org)`. See
`docs/TN_PUBLIC_DOMAIN_EDGE.md` for the deployment contract and operating
evidence.

**PHASE 6B.2A-1 TN PUBLIC DOMAIN EDGE REVIEW REQUIRED. Do not begin Entra
SSO, Plugin sender/authentication, public anonymous side-car access, Candidate
Search, embeddings, scheduled sync or any later phase without explicit
approval.**

## 90. Phase 6B.2A-1.5 - Pinpin HTTPS Hardening

Trusted HTTPS was added to the existing Chinese and English Pinpin IIS sites
using SNI bindings and separate Let's Encrypt certificates. The original HTTP
5679/5678 bindings and application pools remain unchanged; no forced redirect
or HSTS was introduced. Both HTTPS and retained legacy HTTP `/webapp/`
endpoints returned 200, and TN health, loopback-only bindings, closed public
database/API ports, services and TN automated tests remained healthy.

The static Connector inspection found its current production source recognizes
only the retained `http://` ATS URLs with explicit ports. It does not recognize
the new HTTPS URLs. No Plugin change was made under this phase's hard boundary,
so this is recorded as a controlled compatibility HOLD rather than silently
expanding Plugin scope. See `docs/TN_PINPIN_HTTPS_HARDENING.md`.

**PHASE 6B.2A-1.5 PINPIN HTTPS HARDENING REVIEW REQUIRED. Do not begin Plugin
HTTPS recognition work, HTTP migration, HSTS, Entra, or any later phase without
explicit approval.**

## 91. Phase 6B.2A-2A - Existing Entra SSO Discovery

Read-only inspection located the existing TNT, Hub and SOP Entra source. They
share a custom Authorization Code + PKCE and Netlify ID-token validation model;
they do not use MSAL or an existing TN API access-token audience/scope. Hub and
SOP provide a silent-first `prompt=none` reference, while TNT legacy default
uses `select_account` and must not be copied as Plugin default. The attendance
system also uses Entra through NextAuth, but its actual deployed App
Registration relationship was not inspected.

The recommended additive topology is a same-tenant dedicated TN API resource
registration plus a dedicated Chrome Extension public-client registration. No
Entra, Plugin, TNT, Hub, SOP, TN runtime or production configuration changed.
See `docs/TN_EXISTING_ENTRA_SSO_DISCOVERY.md`.

**PHASE 6B.2A-2A EXISTING ENTRA SSO DISCOVERY REVIEW REQUIRED. Do not start
Entra Portal changes, TN Entra middleware, public side-car routing, Plugin
authentication or Plugin HTTPS recognition without explicit approval.**
# Phase 6B.2A-2B — TN Entra Access Token Validation

TN API now has a separate Entra-protected public side-car route at `POST /api/v1/plugin-sidecar/candidate-enrichment`. It validates Microsoft Entra v2 access tokens using tenant OpenID/JWKS metadata, RS256 signature verification, configured issuer, API client-ID GUID audience, tenant claim, expiry/not-before, `ver=2.0`, and delegated `TN.Sidecar.Write` scope. The existing internal route remains on the existing TN bearer token. The public route reuses `PluginSidecarIntakeService` and preserves Pinpin-first, exact external identity, snapshot-only semantics. Chrome redirect configuration, Plugin sender, and Silent SSO remain deferred to Phase 6B.2B.

## 92. Controlled Pinpin BLOB Evidence Adapter — Golden #43213

### Scope and safety gate

This phase implemented only the controlled Pinpin attachment-content boundary.
The Legacy ATS remains read-only: no candidate/attachment DML, no DDL, no
bulk BLOB scan, and no BLOB read outside the explicitly selected current
resume. The existing Connector Browser Evidence Bridge remains available as a
fallback; it was not removed or redesigned.

The TN backend release was deployed through the existing rollback-aware
`TalentNexusApi` procedure. Production commit was `ea39155` and the deployed
archive SHA-256 was
`212E227528D003CA64A18A0E2BB8780C33E97BECE940E6029283821EFFD77ECD`.
No migration was applied (the existing migration ledger already contained
`005_historical_evidence_bridge.sql`). TN API and the processing worker are
running on their existing loopback/local boundaries.

### BLOB reader and credential

A dedicated `tn_pinpin_blob_ro` SQL login was created outside source control.
It has `CONNECT` and column-level `SELECT` only on
`dbo.ZPResumeInfo_Annex_Other` for `ID`, `ZPResumeInfo_ID`, `FileName`,
`FileType`, `Filesize`, `CreDate` and `Annex`. `Annex1` is not readable;
`INSERT`, `UPDATE`, `DELETE`, `EXECUTE`, `ALTER`, `db_datareader` and
`sysadmin` checks are all negative. The protected credential file remains
outside the application tree with its existing restricted ACL. No secret was
printed, logged or committed.

Two runtime issues found by the first controlled request were repaired in the
minimum possible scope: the protected SQL env file is now loaded by a
content-preserving server-only loader, and the existing evidence insert uses
generic `ON CONFLICT DO NOTHING` so it correctly cooperates with the existing
partial unique identity index. No new data model or competing intake protocol
was introduced.

### Golden result — ATS Candidate 43213

The deterministic scoped identity resolved exactly one TN candidate for
`pinpin + pinpin-prod + 43213`. Candidate UUID and operational TN code stayed
unchanged (`TN00000188`). The resolver selected `CV1106` as the newer DOCX
resume. `CV1056` remains historical Resume Evidence; `CV1075` (image) and
`CV1105` (recruiter report) were not selected. The CV1106 filename metadata is
known to be a DOCX resume; its personal filename value is intentionally omitted
from this report.

The exact CV1106 BLOB read returned 47,929 bytes, matching the declared
metadata size, and produced a raw-byte SHA-256. DOCX extraction produced
bounded text (2,842 characters) and submitted only that text to the existing
`candidate_evidence_intake_v1` path. The persisted evidence is content-backed,
`source_type=docx`, `representation_kind=local_file_text`,
`processing_eligible=true`, with a normalized-text SHA/evidence identity key.
The existing worker completed processing with one extraction, one completed
job, one StandardResumeV1 snapshot and one AI Profile. Data Browser and
Candidate Intelligence returned 200.

The same controlled endpoint was then invoked again without source changes.
Both replay responses were `unchanged`; evidence count, snapshot count,
candidate UUID/code, and all duplicate counters remained stable at zero.
The controlled diagnostics performed four exact reads of CV1106 in total (one
failed-intake diagnostic, one successful creation, and the two final replay
checks); unselected BLOB reads were zero. No Pinpin writes or attachment
mutations occurred.

The existing schema stores `candidate_resume_evidence.content_sha256` as the
hash of normalized extracted text. The raw BLOB SHA was computed and verified
for this Golden but is not stored in a separate raw-hash column; this remains an
explicit contract limitation rather than a source-identity substitute.

### Validation and deferred work

TN TypeScript build: PASS. Full TN test suite: **89/89 PASS**. Connector
fallback-related tests remain passing. Production smoke checks: TN health 200,
candidate API 200, Data Browser 200, Candidate Intelligence 200, Pinpin Chinese
and English `/webapp/` 200, PostgreSQL/IIS/SQL Server Running, API and worker
tasks Running, and listeners remain loopback-only (3333/5432; no 1433
listener). Credentials exposed, ATS cookies sent to TN, Legacy ATS writes,
attachment mutations and arbitrary BLOB scans: 0.

The 100+ Candidate baseline backfill and the controlled 5–10 resume pilot were
**not executed** in this phase. Metadata Watcher work is deferred. They require
a separate explicit gate after review of this Golden result.

**PHASE 4 CONTROLLED PINPIN BLOB GOLDEN REVIEW REQUIRED. Core Golden path
PASS; do not start baseline backfill, resume pilot, Metadata Watcher or later
features without explicit approval.**
