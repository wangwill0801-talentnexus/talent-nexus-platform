# Pinpin Contract / Mapping Verification

> Phase：1B-2 — Pinpin Contract / Mapping Verification  
> 稽核日期：2026-08-11  
> 模式：Part A 靜態唯讀驗證完成；Part B 未執行（尚未指定 synthetic / authorized candidate）  
> Production changes：none

## 1. Executive Summary

本報告延續 Phase 1A 與 Phase 1B-1，只進行安全的靜態唯讀查核。已驗證中文 ATS（5679）與英文 ATS（5678）是同一 VPS 的兩個 IIS 部署，兩站 `Web.config` 的 connection-string 條目逐字相同，並使用本機預設 SQL Server 執行個體的 `HiBole-2` 資料庫。故 Candidate ID 在目前正式部署中的正確 scope 不應以語言站台區分；應以**正式 Pinpin 資料庫部署**區分。

候選人主體是 `dbo.ZPResumeInfo.ID int IDENTITY`。其 ID 有真正的主鍵約束，外掛建立成功和重複履歷結果亦皆使用同一 ID 形式；但資料庫對 child tables 沒有 FK、主表沒有可靠 `updated_at`、owner/source 欄位未能用現有 lookup 表直接驗證、merge 行為未有靜態證據。因此 External ID 評等仍為 **USABLE WITH CAVEATS**，Phase 2 可在明確 nullable/unknown contract 下開始設計，整體 readiness 為 **YELLOW**。

Part B 需要一位由使用者明確指定的 synthetic / authorized candidate。依本階段安全規則，Codex 沒有建立、修改、上傳、刪除、合併或檢視任何候選人內容。

## 2. Phase Scope / Safety Confirmation

- 已閱讀 `docs/PLUGIN_BASELINE_AUDIT_5000.0.114.md` 與 `docs/PINPIN_VPS_DB_BASELINE_AUDIT.md`，未重複執行已完成的稽核。
- 只用既有 direct SSH、Windows/IIS 中繼資料、DB schema、indexes、identity metadata、table/attachment aggregate counts、以及 local plugin static source。
- 未執行 POST/PUT/PATCH/DELETE 或任何 Pinpin write API；未提交表單、未操作瀏覽器 UI。
- 未執行 DML/DDL、stored procedure、資料匯出、履歷下載或 BLOB 讀取。
- 未輸出候選人姓名、聯絡資料、履歷文字、檔名、使用者名稱、密碼、token 或連線字串。
- 唯一 repository 變更為本報告；未修改先前兩份 audit、source code、manifest、SQL、migration 或部署設定。

## 3. Evidence Used

| Evidence | 唯讀結論 |
|---|---|
| IIS site metadata | 5678 對應英文 ATS、5679 對應中文 ATS；各有獨立 V16 deployment root。 |
| 兩站 `Web.config` | connection-string entry count、provider、長度與每個原始 entry 均完全相同；未輸出字串本身。 |
| SQL Server system catalog | `HiBole-2` 的 tables、columns、indexes、identity、triggers、FK、type metadata。 |
| SQL aggregate queries | 無個資 row count、欄位存在性、附件類型/BLOB 存在性、lookup matching count。 |
| Phase 1A plugin source | `addFileName` / `uuidname`、Pinpin endpoint aliases、create/duplicate result Candidate ID flow。 |
| IIS directory metadata | `file`、`logger`、`rest`、`webapp` 等目錄存在；未讀取履歷/日誌內容。 |

## 4. Deployment Scope Verification

### 已驗證部署關係

| Site | Role | Port | DB configuration evidence |
|---|---|---:|---|
| `ats-en.talentnexus.com.tw` | 英文 ATS | 5678 | 與中文站完全相同的 connection-string entries |
| `ats.talentnexus.com.tw` | 中文 ATS | 5679 | 與英文站完全相同的 connection-string entries |

兩站是不同 IIS sites / 目錄，但同一 production VPS，且連線設定逐字一致。SQL Server 本機預設 instance 的正式 DB 為 `HiBole-2`。因此沒有 evidence 支持把 5678 或 5679 當成不同 tenant/company scope。

### RECOMMENDED DEPLOYMENT SCOPE

```text
deployment_scope = {
  production_vps_endpoint: "103.144.32.63",
  sql_instance: "MSSQLSERVER",
  database: "HiBole-2"
}
```

未來 TN 可將此 tuple 序列化為 implementation-owned scope key；本報告不臆造獨立 tenant/site ID。**5678 / 5679 只應記為 presentation/site channel，不應加入 identity uniqueness key。** 在相同 DB 中，`ZPResumeInfo.ID` 不可能同時有兩筆主列；若未來新增另一 DB、備份還原環境或 tenant DB，必須建立新 scope。

## 5. Candidate Master Contract

| Concept | Table | Column | Type | Confidence | Evidence / Notes |
|---|---|---|---|---|---|
| Candidate master | `dbo.ZPResumeInfo` | — | table | HIGH | Candidate-focused field set；child tables 以 `ResumeID` 或 `ZPResumeInfo_ID` 命名相連。 |
| Candidate ID | `dbo.ZPResumeInfo` | `ID` | `int IDENTITY` | HIGH | `PK_ZPResumeInfo`、unique、seed 1/increment 1；extension create/duplicate detail URL 使用同型 ID。 |
| Candidate status | `dbo.ZPResumeInfo` | `Active`, `Status`, `IsValid`, `CVStatus` | smallint / char / int / nvarchar | MEDIUM | 狀態欄位存在；code semantics 未完成 lookup mapping。 |
| Creator signal | `dbo.ZPResumeInfo` | `CreUser` | nvarchar | MEDIUM | 所有現有 candidate rows 有值；無可驗證 FK。 |
| Modifier signal | `dbo.ZPResumeInfo` | `ModifyUser` | int | LOW | 部分 candidate rows 有值；未證實 reference target。 |
| Master time-like field | `dbo.ZPResumeInfo` | `RDate` | nvarchar | LOW | 非 structure datetime；不可作 incremental watermark。 |
| Source signal | `dbo.ZPResumeInfo` | `CVSource` | nvarchar | PARTIAL | 部分 candidate rows 有值；未與兩個 candidate source lookup code 精確相符。 |

## 6. Candidate Core Field Mapping

`ZPResumeInfo` 是舊式 code-based schema，未發現可用的 `MS_Description`。以下按 schema / local ATS model / static naming 逐項列示；未以欄位代碼猜測真實業務語意。

| Concept | Table | Column | Type | Semantic confidence | Evidence | Notes |
|---|---|---|---|---|---|---|
| Candidate ID | ZPResumeInfo | ID | int identity | HIGH | PK / plugin response shape | External ID source。 |
| Candidate name | ZPResumeInfo | `A0101` family | nvarchar | MEDIUM | ATS model / conventional base field family | Exact sub-field must use synthetic UI trace confirm。 |
| Gender | ZPResumeInfo | `A0102` family | nvarchar | LOW | Adjacent identity code family only | Not approved as semantic mapping。 |
| Birth/year/age | ZPResumeInfo | `A0103` / related base fields | nvarchar | LOW | Adjacent identity code family only | Do not ingest until verified。 |
| Mobile phone | ZPResumeInfo | `A0117`, `A0117_1` candidates | varchar / nvarchar | LOW | Existing index on `A0117`; plugin/ATS handles mobile | Must validate which is primary vs secondary。 |
| Secondary phone | ZPResumeInfo | `A0117_1` or other A01 field | nvarchar | UNKNOWN | Schema only | Needs synthetic trace。 |
| Email | ZPResumeInfo | `email1` | nvarchar | MEDIUM | Explicit field name | Could coexist with legacy A01 field; validate primary selection。 |
| Address/location | ZPResumeInfo | `Address`; `A0204` family | nvarchar | MEDIUM / LOW | Explicit Address; ATS model has location/city | Address is clear; city/current-location coding not yet confirmed。 |
| Current company | ZPResumeWork | `Company` plus most-recent `ResumeID` row | varchar | MEDIUM | Structured work table | No persisted order / update field proven; derive only after validation。 |
| Current title | ZPResumeWork | `F1...F22` / `Dept` candidates | nvarchar | LOW | Work schema / ATS model | Exact title field needs trace。 |
| Desired title | ZPResumeInfo | `A0201...A0209` family | nvarchar | LOW | Main classification field family | No safe code meaning verified。 |
| Current salary | ZPResumeInfoOther | `salary` | varchar | MEDIUM | Explicit column name | Separate one-to-many auxiliary table. |
| Expected salary | ZPResumeInfoOther | `expectSalary` | varchar | MEDIUM | Explicit column name | Separate one-to-many auxiliary table. |
| Years of experience | ZPResumeInfo | `WorkCount` | int | LOW | Explicitly count-like name | Could be count of work records rather than years; not confirmed. |
| Industry | ZPResumeInfo / ZPResumeWork | `A0204`, `A0204BM`, `Industry`, `IndustryBM` | nvarchar | MEDIUM for child / LOW for master | Explicit child names; code fields | Lookup/code mapping unresolved. |
| Job function | ZPResumeInfo / ZPResumeWork | A02 / F4-family candidates | nvarchar | LOW | ATS UI / code family | Needs trace and lookup resolution。 |
| Source | ZPResumeInfo | `CVSource` | nvarchar | PARTIAL | Explicit field; source reference tables exist | Value-to-lookup join absent in current data. |
| Owner / consultant | ZPResumeInfo | `CreUser`, `ModifyUser`, possible related fields | nvarchar / int | LOW | Creator/modifier fields exist | Owner semantic unconfirmed; see section 8。 |
| Delete/archive | ZPResumeInfo + `zpresumeinfoDel` | `Active`, `Status`, `IsValid`; `FID`, `DelDate` | mixed | PARTIAL | State fields + tombstone-like table | Exact operational semantics unverified。 |
| Merge/master reference | — | — | — | UNKNOWN | No static schema evidence | Must not infer。 |

## 7. Code / Enum Mapping

| Field / domain | Candidate code source | Meaning evidence | Confidence |
|---|---|---|---|
| Candidate source | `BM_ResumeSource (BM0000, MC0000, enus, zhtw)` and `BM_CVSource` | Both are hierarchy/lookup-shaped tables; `CVSource` has values but no exact static code match in current DB aggregate. | PARTIAL |
| Resume categories / tags | `BM_ResumeAll` includes `BM0000`, `MC0000`, hierarchy fields, `Tags`, `Titles` | Relational/hierarchy-shaped, but its precise candidate linkage/use is not yet proven. | PARTIAL |
| Talent folders / classification | `ZPResumeInfoFolder`, `ZPResumeInfoSCFolder`, `ZPResumeInfo_SC` | Folder master fields plus candidate `ResumeID` relation; metadata supports relational folder/classification model. | MEDIUM |
| Candidate state | `Active`, `Status`, `IsValid`, `CVStatus` | Fields exist, no verified lookup table/meaning. | LOW |
| Gender / degree / job function | Legacy `A01/A02` and child `F*` fields | No safe static lookup mapping found. | UNKNOWN |

No business meaning is derived solely from integer or code values. Phase 2 must model these as raw Pinpin code + nullable normalized mapping until Part B/API contract evidence exists.

## 8. Owner / Consultant Contract

**Owner mapping rating: UNKNOWN.**

| Evidence | Finding |
|---|---|
| Candidate creator | `ZPResumeInfo.CreUser` is populated for all existing candidate rows, but is nvarchar and does not exactly match `BoleUsers.CName` or `ZPUsersList.UserName` in the aggregate check. |
| Candidate modifier | `ZPResumeInfo.ModifyUser int` exists only for part of population; no FK. |
| User tables | `UserList` contains `A0188`, name/contact columns; `BoleUsers` contains `ID`, `CName`; `ZPUsersList` contains `ID`, UserName and mail configuration. |
| History actor | `ZPResumeInfo_R_N.LastUser int` and `LastDate` are populated for its history rows. |
| Candidate A0188 | field exists in candidate master but is not populated in the current aggregate population. |

There is no database FK to prove `CreUser` / `ModifyUser` / `LastUser` mapping. Future owner contract is therefore only a hypothesis:

```text
Pinpin candidate → owner reference (unverified) → Pinpin user entity → TN consultant
```

Part B owner-change observation is required before mapping any consultant ID.

## 9. Source Mapping

**Source mapping rating: PARTIAL.**

- Candidate-level field: `ZPResumeInfo.CVSource`.
- Reference-shaped source tables: `BM_ResumeSource` and `BM_CVSource`, each with code/name/localized-name hierarchy columns.
- Candidate source values exist, but static aggregate matching found no exact `CVSource = BM0000` join in the current DB. This may indicate display-name storage, another mapping table, historical data, or non-code values.
- Plugin capture URL / HTML, Pinpin `filename`, and future source categories are not yet proven to populate `CVSource` consistently.

Do not treat `104`, `LinkedIn`, `PDF`, plugin or manual-upload labels as canonical Pinpin source codes until a synthetic candidate trace confirms saved field/value behavior.

## 10. Work Experience Contract

| Item | Verified contract |
|---|---|
| Entity | `dbo.ZPResumeWork` (Chinese) and `dbo.ZPResumeWorkE` (English/legacy) |
| PK | `ID int IDENTITY` / primary key |
| Candidate relation | `ResumeID int`; non-unique index on Chinese work table |
| Dates | `YearB`, `MonthB`, `YearE`, `MonthE` |
| Company | `Company varchar(500)` |
| Department | `Dept nvarchar(2000)` |
| Current-role flag | `IsCur int` |
| Classification | `Industry`, `IndustryBM`, `A0204`, `A0204BM`, F-fields |
| Description-like fields | `CompanyNote`, `Leave`, F-fields |
| Order / creation / change | No explicit order or datetime change field verified |

**Can one candidate have multiple structured work history records: YES.** `ResumeID` is non-unique and existing aggregate rows exceed candidate rows. Child FKs are application-convention only, not DB constraints.

## 11. Education Contract

| Item | Verified contract |
|---|---|
| Entity | `dbo.ZPResumeEdu` (Chinese) and `dbo.ZPResumeEducation` (English/legacy) |
| PK | `ID int IDENTITY` |
| Candidate relation | `ResumeID int`; Chinese entity has non-unique ResumeID index |
| Dates | `YearB`, `MonthB`, `YearE`, `MonthE` |
| School | `ZPResumeEdu.School nvarchar(2000)` |
| Degree / major | `F1`, `F2`, `F2BM`, related code fields |
| Detail/current marker | `detail`, `IsCur` |
| Order / creation / change | No explicit order or consistent datetime change field verified |

**Quality: STRUCTURED**, but degree/major code semantics are not fully mapped. Use raw fields plus an explicitly unknown mapping state in any later design.

## 12. Skills / Tags / Classification

| Concept | Storage evidence | Representation | Confidence |
|---|---|---|---|
| Folder/classification | `ZPResumeInfo_SC` with `ResumeID`, `FolderID`; folder masters | normalized relational / hierarchy-coded | MEDIUM |
| Resume categories/tags | `BM_ResumeAll.Tags`, `Titles`, hierarchy fields | likely free text plus hierarchy | PARTIAL |
| Main candidate classification | `ZPResumeInfo.A020*` / `A0204BM*` | code / serialized fields | LOW |
| Work industry | `ZPResumeWork.Industry`, `IndustryBM`, `A0204*` | mixed text/code | MEDIUM |
| Skills / keywords | No dedicated, proven candidate-skill relation found in safe static evidence | UNKNOWN | UNKNOWN |

## 13. Attachment / Resume Contract

| Item | Main attachment | Multi-attachment / version-capable |
|---|---|---|
| Entity | `ZPResumeInfo_Annex` | `ZPResumeInfo_Annex_Other` |
| PK | `ZPResumeInfo_ID` | `ID int IDENTITY` |
| Candidate relation | `ZPResumeInfo_ID` | `ZPResumeInfo_ID` with non-unique index |
| Filename | none verified | `FileName` |
| Extension/type | `AnnexType` | `FileType`, `FileType1`, `AnnexType` |
| Binary | `Annex image` | `Annex image`, `Annex1 image` |
| Size | none verified | `Filesize int` |
| Created | none verified | `CreDate datetime`, `CreUser int` |
| Path/key | none verified | `filePath`, `fileway`, `RCD_URL` present but no semantic mapping |
| Soft delete | none verified | no explicit delete state column verified |

Observed no-PII aggregates verify PDF, DOCX and HTML/HTM BLOB attachment categories. `ZPResumeInfo_Annex_Other` has independent attachment ID and non-unique candidate relation, so **one candidate can retain multiple attachments and multiple resume versions can coexist: YES**. PDF/DOCX/HTML can coexist at schema level; DOC was not observed and remains unverified.

Attachment mapping rating: **PARTIAL**. It is strong enough for a future metadata-first contract but not yet for streaming/export or definitive original-vs-generated filename semantics.

## 14. addFileName Analysis

| Aspect | Verified evidence |
|---|---|
| First appearance | Plugin callback for `request.api.addResume.normal` after `/rest/file/htmlfile` response. |
| Derivation | Existing Golden code derives it from `response.data.substring(20)`. |
| Use | Passed as `filename` to `/rest/file/temp` for extraction; included in canonical `/rest/resume/addbyplug` submit. |
| DB evidence | `ZPResumeInfo_Annex_TempFile.TempFile` provides a temp-file-key schema clue, but current aggregate count is zero and no direct column name match exists. |
| Filesystem evidence | IIS `file` directories are primarily HTML/HTM artifacts. |
| Meaning | server-generated temporary intake filename/key, later consumed by candidate creation; not a TN identity. |

**Rating: PARTIAL.** It is not verified as the original filename, durable UUID or final attachment ID. Do not persist it as a long-lived external key.

## 15. uuidname Analysis

| Aspect | Verified evidence |
|---|---|
| First appearance | Plugin upload callback (`request.api.addResume.upload`) receives `response.data[0].uuidname`. |
| Use | Passed as an array in `request.api.addSaveOrReplace` to bind/replace candidate attachment. |
| DB evidence | No column named `uuidname`; attachment BLOB rows have identity IDs and metadata fields but no confirmed direct mapping. |
| Meaning | server upload/binding token or generated temporary storage key is likely, but its exact lifecycle is unverified. |

**Rating: PARTIAL.** It must be treated as an opaque, flow-local token only. A Part B attachment test is required to map it to `ZPResumeInfo_Annex_Other.ID`, FileName, filePath or another final record.

## 16. HTML File Directory Role

Both V16 deployment roots contain a `file` directory. Safe extension-only aggregates show mainly HTML/HTM, with small TXT/image populations and negligible non-resume office file presence. Combined with plugin HTML intake and `addFileName` flow, this is best classified as:

**TEMPORARY / SUPPLEMENTARY — DO NOT DEPEND ON.**

It can be an import/parser/preview intermediate but has not been proven authoritative. The SQL attachment BLOB entities are the validated candidate-document source of record.

## 17. Delete / Archive Contract

| Behavior | Static result | Evidence |
|---|---|---|
| Candidate deleted | PARTIAL | `zpresumeinfoDel` has identity PK plus `FID`, `A0188`, `DelDate`. |
| Candidate archived/disabled | PARTIAL | master has `Active`, `Status`, `IsValid`, `CVStatus`. |
| Attachment soft delete | UNKNOWN | no explicit attachment delete status field found. |
| Child retention after delete | UNKNOWN | needs controlled before/after test. |

Do not hard-delete TN data based on an absent source row. Future sync must process tombstones/status as reversible review events until Part B confirms Pinpin UI behavior.

## 18. Merge Contract

**Merge behavior: STATIC ONLY / UNKNOWN.**

No merge/master/replacement candidate table, FK or explicit column was found by safe static metadata inspection. No merge was requested or performed. Candidate ID reuse after merge is therefore unknown; a merge test is intentionally deferred unless the user supplies two dedicated synthetic candidates and explicitly approves it.

## 19. Candidate ID Stability Reassessment

**USABLE WITH CAVEATS**

Strengths:

- `ZPResumeInfo.ID` is an actual `int IDENTITY` primary key with unique constraint.
- Seed/increment are 1/1; normal deletion does not reuse identity values.
- Plugin new-candidate and duplicate detail flow use the same ID form.
- Both language sites use identical DB configuration, preventing language-site duplication inside the current DB scope.

Caveats:

- SQL identity gaps, failed transactions, manual reseed, restore/migration and future extra DB deployments remain possible.
- No DB FK protects child relations.
- Delete tombstone exists; merge/canonical/recreate semantics are unknown.
- Use deployment-scope tuple plus ID, never a bare ID across environments.

## 20. New Candidate Detection

`MAX(ID)` / ID high-water is suitable only as a **partial** new-candidate discovery signal. `ZPResumeInfo.ID` is identity-based with no reuse under ordinary delete, but gaps can occur and reseed/restore/migration cannot be ruled out.

| Signal | Rating | Notes |
|---|---|---|
| Identity high-water `ID > last_seen_id` | YELLOW | Reliable for most append-only creates in one stable DB; does not detect update/reseed/restore. |
| Full reconciliation by scoped ID | REQUIRED | Detects gaps, historic imports and drift. |
| Plugin success side-car event | PARTIAL | Strong immediate hint after create, but must remain non-blocking and converge with DB sync. |

**New candidate detection: YELLOW.**

## 21. Core Change Detection

| Candidate core signal | Rating | Evidence |
|---|---|---|
| `ZPResumeInfo.RDate` | NO DIRECT SIGNAL | nvarchar, not verified update timestamp. |
| `ModifyUser` | PARTIAL | optional field, no verified write coverage. |
| `ZPResumeInfo_R_N.LastDate/CreDate` | PARTIAL | history table has populated actor/time fields; coverage across all UI edits not known. |
| rowversion / timestamp | NO DIRECT SIGNAL | no rowversion/timestamp columns found on relevant resume tables. |
| DB trigger change capture | NO DIRECT SIGNAL | no user triggers found on relevant candidate/work/education/attachment/delete tables. |
| periodic scoped fingerprint/reconciliation | REQUIRED FUTURE OPTION | not implemented in this phase. |

**Core update detection: YELLOW.**

## 22. Child Entity Change Detection

| Change type | Primary signal | Rating | Notes |
|---|---|---|---|
| Work experience | query child rows by `ResumeID` + periodic compare | PARTIAL | no consistent child datetime/order/change field. |
| Education | query child rows by `ResumeID` + periodic compare | PARTIAL | same limitation. |
| Skills/tags/classification | child/lookup relation compare | PARTIAL | exact semantic mapping incomplete. |
| Owner | candidate/history comparison | PARTIAL | owner field not verified. |

No child table FK or universal audit trigger exists. Reconciliation is required for all child entities.

## 23. Resume Change Detection

| Signal | Rating | Evidence |
|---|---|---|
| `ZPResumeInfo_Annex_Other.ID` high-water | PARTIAL | identity attachment row; can identify new attachment rows. |
| `CreDate` | PARTIAL | present in `Annex_Other`. |
| Attachment count / metadata comparison | REQUIRED | detects coexistence/additions but not full replacement semantics. |
| Main `ZPResumeInfo_Annex` | PARTIAL | BLOB exists but no reliable create/update date. |

**Resume update detection: YELLOW.** A synthetic manual attachment test is required to establish replacement versus addition/version behavior.

## 24. Owner Change Detection

`CreUser` is consistently populated but cannot be joined to visible user tables; `ModifyUser` and history actors are incomplete semantic signals. No owner-history mapping is verified.

**Owner update detection: RED until Part B owner-change trace.**

## 25. API → DB Contract Evidence

| Endpoint | Static backend component | Candidate ID source | DB entity | Confidence |
|---|---|---|---|---|
| `/rest/resume/addbyplug` | ASP.NET `rest` application; controller compiled in production binaries | plugin reads successful `response.data` | likely creates `ZPResumeInfo.ID` + related records | MEDIUM (ID flow) / LOW (column mapping) |
| `/rest/candidate/listforcrx` | same application | `response.list[].id` used by plugin | likely `ZPResumeInfo.ID` | MEDIUM |
| `/rest/file/htmlfileauto2/3/4` | same application | duplicate response contains `idlist` | candidate lookup unknown | LOW |
| `/rest/file/htmlfile` | same application | response produces `addFileName` | temporary file/parser layer; possible `TempFile` relation | PARTIAL |
| `/rest/file/temp` | same application | takes `filename=addFileName` | parser/extract result, DB mapping unknown | PARTIAL |
| `/rest/file/upload` + bind endpoints | same application | response supplies `uuidname` | final attachment BLOB relation unknown | PARTIAL |

Controllers are compiled binaries. Per instructions, no binary reverse engineering or write endpoint probing was performed. Endpoint-to-column mapping beyond the static plugin contract is UNKNOWN.

## 26. Controlled Trace Results

| Test | Status | Result |
|---|---|---|
| Synthetic/authorized candidate identification | NOT PERFORMED | User has not supplied one. |
| Core field update | NOT PERFORMED | Codex did not alter any candidate. |
| Owner change | NOT PERFORMED | No approval / test candidate. |
| Attachment upload/replace | NOT PERFORMED | No synthetic file / candidate authorized. |
| Delete/archive | NOT PERFORMED | No explicit approval; static evidence only. |
| Merge | NOT PERFORMED | High-risk; requires two dedicated synthetic candidates and explicit approval. |

Part B is intentionally pending, not failed. Before it begins, the user must manually create or identify **TN SYSTEM TEST CANDIDATE** through normal Pinpin UI and provide its candidate ID and active site scope; Codex will then capture only non-PII before/after technical metadata.

## 27. Future Sync Signal Matrix

| Change type | Primary detection signal | Fallback signal | Reconciliation required | Confidence |
|---|---|---|---|---|
| New candidate | scoped `ZPResumeInfo.ID` high-water | plugin success event + full ID sweep | Yes | YELLOW |
| Core profile change | history row / modifier signal if validated | periodic scoped comparison | Yes | YELLOW |
| Work experience change | child rows by `ResumeID` | periodic comparison | Yes | PARTIAL |
| Education change | child rows by `ResumeID` | periodic comparison | Yes | PARTIAL |
| Owner change | Part B-verified field/history | candidate comparison | Yes | RED currently |
| Resume change | AnnexOther ID + `CreDate` | attachment metadata/count comparison | Yes | YELLOW |
| Delete/archive | `zpresumeinfoDel` + master statuses | scoped missing-row reconciliation | Yes | YELLOW |
| Merge | no direct signal | manual review / future contract trace | Yes | UNKNOWN |

## 28. Verified Pinpin Source Contract

| Source concept | Pinpin entity | Pinpin field | Semantics | Scope | Change signal | Confidence |
|---|---|---|---|---|---|---|
| Candidate ID | ZPResumeInfo | ID | identity primary key | deployment tuple | high-water/full sweep | HIGH |
| Deployment scope | IIS + SQL | VPS/instance/database tuple | production source boundary | tuple in section 4 | configuration review | HIGH |
| Name | ZPResumeInfo | A0101 family | candidate name candidate field | candidate | Part B | MEDIUM |
| Phone | ZPResumeInfo | A0117 / A0117_1 candidates | primary/secondary phone unresolved | candidate | Part B | LOW |
| Email | ZPResumeInfo | email1 | explicit email-like field | candidate | Part B | MEDIUM |
| Current company/title | ZPResumeWork | Company / F-fields | structured work data, exact title field unresolved | candidate child | periodic compare | MEDIUM / LOW |
| Location | ZPResumeInfo | Address / A02 family | address clear; city semantics unresolved | candidate | Part B | MEDIUM / LOW |
| Source | ZPResumeInfo | CVSource | source field with unresolved lookup join | candidate | periodic compare | PARTIAL |
| Owner | ZPResumeInfo / history | CreUser / ModifyUser / LastUser candidates | unverified | candidate | Part B | UNKNOWN |
| Experience | ZPResumeWork | ResumeID relation | structured child entity | candidate | reconcile | HIGH relation / partial semantics |
| Education | ZPResumeEdu | ResumeID relation | structured child entity | candidate | reconcile | HIGH relation / partial degree semantics |
| Skills/tags | multiple | folder/tag/code fields | mixed relation/text, not finalized | candidate | reconcile | PARTIAL |
| Created | ZPResumeInfo | ID identity | append order proxy only | scope | ID high-water | YELLOW |
| Changed | history/children | LastDate/CreDate candidates | partial change signals | candidate | reconcile | YELLOW |
| Deleted | zpresumeinfoDel | FID / DelDate | tombstone-like record | scope | tombstone + reconcile | PARTIAL |
| Merged | — | — | no static contract | scope | unknown | UNKNOWN |
| Attachment ID | AnnexOther | ID | attachment identity | candidate | high-water + compare | HIGH |
| Original filename | AnnexOther | FileName | metadata field, original/generated status not confirmed | attachment | compare | MEDIUM |
| Generated filename | — | no direct `uuidname` column | unresolved | attachment | Part B | UNKNOWN |
| MIME/extension | AnnexOther | FileType / FileType1 / AnnexType | type metadata; MIME not verified | attachment | compare | MEDIUM |
| Resume blob | Annex / AnnexOther | Annex / Annex1 | SQL image BLOB | attachment | metadata-first | HIGH |
| Attachment created | AnnexOther | CreDate | datetime create signal | attachment | time/ID sweep | MEDIUM |
| Attachment changed | AnnexOther | no verified update time | unresolved | attachment | reconcile | LOW |

## 29. Remaining Unknowns

1. Exact candidate code-field semantics, especially A01/A02, title, function, city and phone variants.
2. Owner field and its true user/entity mapping; creator versus current owner distinction.
3. `CVSource` value encoding and lookup relationship.
4. `addFileName` and `uuidname` final persistence/binding lifecycle.
5. Exact attachment replacement/version/soft-delete behavior.
6. Which edits populate `ZPResumeInfo_R_N` and whether it covers all relevant changes.
7. Merge, canonical candidate, recreation and ID reuse rules.
8. Attachment streaming/read-only API contract and authorization boundary.

## 30. Production Risks

1. SQL Server 2008 R2-era platform has support/security/compatibility constraints.
2. No database FK on key candidate child relations means data integrity is application-enforced.
3. No reliable global update timestamp or rowversion makes naïve incremental sync lossy.
4. Owner and source semantics are not verified; wrong mapping would pollute future TN intelligence.
5. Attachment BLOB source-of-record and HTML temporary files must never be conflated.

## 31. Phase 2 Readiness Assessment

**PHASE 2 READINESS: YELLOW.**

Phase 2 may begin only with explicit representation of `unknown` / nullable Pinpin mappings. The externally scoped Candidate ID, deployment boundary, work/education relations and attachment metadata are sufficiently understood for a conservative data-model/API contract. Owner, source-code mapping, full field semantics, merge and change coverage must not be modeled as settled facts.

## 32. Recommended Next Step

Run **Phase 1B-2 Part B** only after the user supplies a manually created/identified `TN SYSTEM TEST CANDIDATE`. Observe a harmless core-field update first, then (only with explicit separate approval) owner, attachment, archive and merge traces. No implementation, PostgreSQL, sync worker, plugin modification, SharePoint configuration or production change follows from this report.

---

### Audit completion statement

Part A is complete. Part B was correctly not started because no synthetic/authorized candidate was provided. No production change was made.

---

# Phase 1B-2 Part B — Controlled Synthetic Verification

> Test scope：僅 `TN SYSTEM TEST CANDIDATE`（使用者手動建立的 synthetic candidate）  
> Safety：Codex 僅讀取該 candidate 的技術中繼資料；未開啟 BLOB、未讀取履歷文字、未修改任何 production state。  
> Checkpoint state：Snapshot A complete；等待使用者手動上傳 V2。

## Snapshot A — Candidate exists / V1 uploaded and selected

### A. Candidate technical baseline

| Item | Verified result |
|---|---|
| Synthetic candidate Pinpin ID | `43177` |
| Candidate master | `dbo.ZPResumeInfo` |
| Primary key equality | **YES** — synthetic Pinpin Candidate ID equals `ZPResumeInfo.ID` |
| Deployment context | production Pinpin scope: same `HiBole-2` / `MSSQLSERVER` database used by both language sites |
| Candidate state | `Active=1`, `Status=0`; `IsValid` / `CVStatus` empty at snapshot |
| Master time field | `RDate=2026-08-11 13:51:54` (non-null, string-compatible legacy field) |
| Candidate attachment count field | `AnnexCount=2` at Snapshot A |
| Source field | `CVSource=ColdCall`; not matched to `BM_ResumeSource` / `BM_CVSource` code or name columns |
| Owner-related fields | `CreUser=751`, `ModifyUser=NULL`; value did not match the inspected `BoleUsers.ID`, `UserList.A0188`, or `ZPUsersList.ID` references |

The candidate confirms the stable identity relation, but does **not** resolve owner mapping or source lookup mapping. No owner display/user value was read or recorded.

### B. V1 attachment mapping

| Item | Verified result |
|---|---|
| V1 original filename | `TN_SYSTEM_TEST_RESUME_V1.pdf` |
| Candidate → document relation | `ZPResumeInfo_Annex_Other.ZPResumeInfo_ID = 43177` |
| Stable attachment/document ID | `ZPResumeInfo_Annex_Other.ID = 983` |
| File type | `pdf` |
| File size metadata | 2,819 bytes |
| Attachment create time | `2026-08-11 13:58:27.500` |
| Actual file storage | SQL BLOB: `Annex` and `Annex1` are both non-null; BLOB contents were not read |
| Primary/main resume record | `ZPResumeInfo_Annex` row exists for candidate, with non-null `Annex` BLOB |
| Preview/default relation evidence | `ZPResumeInfo_5` has `AnnexOtherID=983`, `ResumeID=43177`, `ResumeAnnexOtherID=983`, and non-null rendered/content field |
| V1 and preview conclusion | **LIKELY / high-confidence**: `ZPResumeInfo_5` is a candidate-to-selected-resume representation that points to V1 attachment ID 983. Part B Snapshot C must verify whether this changes when the UI preview changes. |

The candidate also has a separate HTML-type attachment row. It is treated as parser/preview support data; its filename/content were not inspected or reported. This is consistent with the existing `AnnexCount=2` and does not alter the verified V1 document mapping.

### C. `addFileName` / `uuidname` at Snapshot A

| Token | Snapshot A rating | Evidence |
|---|---|---|
| `addFileName` | PARTIAL | No matching persisted DB column/value for this UI-created V1; plugin source still proves it is an HTML intake temporary key passed to `/rest/file/temp` and submit. |
| `uuidname` | PARTIAL | No `uuidname` DB column was found. V1 is durably represented by attachment ID 983 and BLOB metadata, but the upload-token-to-attachment-ID relation needs a controlled upload observation. |

### D. Snapshot A answers

- **A1 / A2:** Candidate ID is `43177`; it equals `dbo.ZPResumeInfo.ID` — VERIFIED.
- **A3 / A4:** Candidate → V1 is `ZPResumeInfo_Annex_Other.ZPResumeInfo_ID → ID=983` — VERIFIED.
- **A5:** Original filename is `ZPResumeInfo_Annex_Other.FileName` — VERIFIED.
- **A6:** `addFileName` is bounded as a temporary HTML intake key — PARTIAL.
- **A7:** `uuidname` is bounded as an opaque upload/bind token — PARTIAL.
- **A8:** V1 is stored in SQL BLOB fields, not a verified filesystem path — VERIFIED.
- **A9:** The currently strongest preview evidence is `ZPResumeInfo_5.ResumeAnnexOtherID=983` — LIKELY pending preview-switch verification.
- **A10:** V1 upload time is available on the attachment row; master `RDate` precedes V1 attachment time. This indicates the master field is not a sufficient attachment-change watermark — PARTIAL.
- **A11:** Owner mapping remains UNKNOWN.
- **A12:** Source mapping remains PARTIAL.

### Checkpoint 1

Snapshot A is complete. Do not continue to Snapshot B until the user manually performs this exact normal-Pinpin UI action:

1. Upload `TN_SYSTEM_TEST_RESUME_V2.pdf`.
2. Do **not** delete V1.
3. If the UI allows it, keep V1 as the displayed/preview resume.

No Codex write action is authorized or required.

## Snapshot B — V2 uploaded / V1 retained

### A. Before / after result

| Item | Snapshot A | Snapshot B | Verified conclusion |
|---|---:|---:|---|
| Candidate ID | 43177 | 43177 | Same stable candidate master identity. |
| `ZPResumeInfo.AnnexCount` | 2 | 3 | New attachment increments master attachment count. |
| `ZPResumeInfo.RDate` | `2026-08-11 13:51:54` | unchanged | Master `RDate` does **not** detect V2 upload. |
| V1 attachment | ID 983 | ID 983 remains | V1 is retained. |
| V2 attachment | absent | ID 984 | V2 is a new stable attachment/document row. |
| V1 original filename | V1 PDF | unchanged | Preserved. |
| V2 original filename | absent | `TN_SYSTEM_TEST_RESUME_V2.pdf` | Preserved in `ZPResumeInfo_Annex_Other.FileName`. |

### B. Attachment model verified

```text
Candidate 43177
  ├── AnnexOther 982  (HTML/parser-support attachment)
  ├── AnnexOther 983  (TN_SYSTEM_TEST_RESUME_V1.pdf)
  └── AnnexOther 984  (TN_SYSTEM_TEST_RESUME_V2.pdf)
```

Both V1 and V2 have their own `ZPResumeInfo_Annex_Other.ID`, `FileName`, `FileType=pdf`, `Filesize`, `CreDate`, and non-null SQL BLOB columns (`Annex`, `Annex1`). No filesystem path or remote URL metadata is populated for either PDF. Therefore:

- Multiple attachments coexist: **VERIFIED**.
- V2 has a distinct stable document ID: **VERIFIED** (`984`).
- Original filenames are preserved: **VERIFIED**.
- Original document storage is SQL BLOB: **VERIFIED**.
- Document upload detection requires child/document signal: **VERIFIED**. `AnnexCount` changed, but `RDate` did not.
- `uuidname` cannot yet be mapped to attachment ID 984 because the user upload was observed only after completion: **PARTIAL**.

### C. Preview relation correction

Snapshot A showed a `ZPResumeInfo_5` row for V1. Snapshot B now shows **one row for each PDF attachment**:

| `ZPResumeInfo_5.AnnexOtherID` | `ResumeID` | `ResumeAnnexOtherID` |
|---:|---:|---:|
| 983 | 43177 | 983 |
| 984 | 43177 | 984 |

Both rows have non-null content representation and no populated `LastDate` / `LastA0188`. Consequently, `ZPResumeInfo_5` is an attachment-associated rendered/content representation, **not sufficient evidence of which single resume is currently displayed in the UI**. The Snapshot A preview conclusion is superseded by this result.

Current preview-selection mechanism: **UNKNOWN pending Snapshot C**. The user reports V1 was kept as preview where the UI allowed it; no dedicated selected/default flag or reference has yet appeared in the observed rows.

### Checkpoint 2

Snapshot B is complete. Do not continue to Snapshot C until the user manually performs this exact normal-Pinpin UI action:

1. Switch the candidate's displayed/preview resume from `TN_SYSTEM_TEST_RESUME_V1.pdf` to `TN_SYSTEM_TEST_RESUME_V2.pdf`.
2. Do **not** delete either file.

No Codex write action is authorized or required.

## Snapshot C — User switched displayed preview from V1 to V2

### A. Read-only comparison result

The user manually switched the UI preview from V1 to V2 without deleting either attachment. The following narrowly targeted DB rows were compared with Snapshot B:

| Entity / signal | Snapshot C result | Change detected? |
|---|---|---|
| `ZPResumeInfo` technical fields (`RDate`, status, owner fields, AnnexCount, preview-adjacent counters) | unchanged | NO |
| `ZPResumeInfo_Annex_Other` V1 / V2 rows | IDs 983 / 984, metadata and BLOB-presence unchanged | NO |
| `ZPResumeInfo_5` rendered/content rows | one row for each PDF; references unchanged | NO |
| `ZPResumeInfo_5AutoSave` | no candidate row | NO |
| `ZPResumeInfo_Annex_Other_HtmlRead` | one parser/HTML-read relation per attachment; no selection flag observed | NO |
| `ZPResumeInfo_Annex_Other_HtmlReadAutoSave` | no candidate attachment row | NO |
| `ZPResumeInfo_R_N` / `ZPResumeInfo_Note` history | no candidate history/note row observed | NO |

`ZPResumeInfo_Annex_Other_HtmlRead` confirms that each attachment has a generated HTML-read/parser representation tied by `AnnexOtherID`, but it contains no selected/default/preview column. Generated local paths and identifiers were intentionally not recorded in this report.

### B. Preview selection conclusion

**Current preview resume represented independently from document list: PARTIAL / NOT DB-VERIFIED.**

The normal Pinpin UI accepted a V1 → V2 preview change, but the controlled database observation found no changed candidate master column, attachment flag, attachment relation, selected/default field, timestamp, or history row in all currently identified candidate-document entities. Therefore the selection may be UI/client/session-only, an application-side representation outside the safely identified DB contract, or a DB representation not discoverable without broad inspection or binary reverse engineering.

It must **not** be treated as a current-resume DB watermark or a candidate-master field. For the future TN document model, retain all document rows and make any `primary_resume_document_id` nullable / derived-unconfirmed until an API contract or further permitted evidence validates it.

### C. Timestamp behavior

- V2 upload created attachment-level evidence (`Annex_Other.ID`, `CreDate`, BLOB metadata) and increased `ZPResumeInfo.AnnexCount`.
- The master `RDate` was unchanged after both upload and preview switch.
- Preview switch created no observed change signal.

Current child/document strategy classification: **B — MULTI-TABLE WATERMARK REQUIRED**, with periodic reconciliation. A master watermark is insufficient.

### Checkpoint 3

Snapshot C is complete. Do not continue to Snapshot D until the user manually performs one harmless synthetic core-field update through normal Pinpin UI.

Preferred action: change the synthetic candidate's current title to:

```text
Synthetic Candidate Updated
```

Do not change owner, attachments, source, or any real candidate data. No Codex write action is authorized or required.

## Snapshot D — User manually updated synthetic current title

### A. Exact before / after field mapping

The user manually changed the harmless synthetic current title to `Synthetic Candidate Updated`. Read-only, candidate-scoped comparison found the exact persisted target:

| Concept | Entity | Row / field | Verified result |
|---|---|---|---|
| Current title | `dbo.ZPResumeWork` | `ID=640`, `ResumeID=43177`, `F1` | **VERIFIED** — updated title is stored in `F1`. |
| Current-role marker | `dbo.ZPResumeWork` | `ID=640`, `IsCur=1` | Supports interpreting this as the current work record. |
| Current company | `dbo.ZPResumeWork` | `ID=640`, `Company` | Structured company field remains on the same work record; no value is recorded here. |

This upgrades the structured work contract: `ZPResumeWork.Company` is company and `ZPResumeWork.F1` is title for the controlled current-role record. The result is scoped to the verified candidate/UI action; additional work-field semantic mappings remain unverified.

### B. Change signals observed

| Signal | Snapshot C | Snapshot D | Conclusion |
|---|---|---|---|
| `ZPResumeInfo.RDate` | unchanged legacy value | unchanged | Not a core-update watermark. |
| `ZPResumeInfo.ModifyUser` | null | populated | Master modifier signal changed, but no timestamp accompanies it. |
| `ZPResumeInfo_Note` | no candidate row | one row with `ResumeID=43177`, `LastUser`, `LastDate=2026-08-11 14:09:43.610` | This UI update produced a candidate history/note time signal. |
| `ZPResumeInfo_R_N` | no candidate row | no candidate row | Not used by this update path. |
| Work row | current work row already exists | `F1` content changed | No work-row create/update timestamp exists. |
| Attachments | unchanged | unchanged | Core edit did not affect attachments. |

### C. Core update detection rating

**YELLOW.** This test proves that a core/current-title edit can be identified by a combination of candidate child-row comparison and an accompanying `ZPResumeInfo_Note.LastDate` signal. It does not prove that every candidate, work, education, source or owner edit will create that note row. The future strategy must be:

```text
history/note LastDate candidate signal
  + candidate master / work / education targeted comparison
  + periodic scoped reconciliation
```

There is no safe evidence for a single, universal master `updated_at` watermark.

### Owner verification checkpoint

Owner mapping is still UNKNOWN. The controlled candidate confirms `CreUser=751` and now `ModifyUser=751`, but neither value joins to the inspected visible user entities by static read-only evidence. No ownership change has been made.

Before any owner test, the user must explicitly confirm that a safe second internal test owner is available. If none is available, record **OWNER DEFERRED** and continue without an owner mutation.

### Owner verification result

**OWNER DEFERRED.** The user confirmed that no safe second internal test owner is available for this controlled production observation. No ownership change was requested, performed or inferred. Candidate-owner contract remains explicitly deferred and does not block the documented Phase 2 YELLOW readiness boundary.

### Lifecycle checkpoint

Before Snapshot F, the user must manually perform one normal Pinpin lifecycle action on synthetic candidate `43177`: Archive, Delete, or the UI's equivalent removal/deactivation action. The exact UI action used must be reported back before read-only observation. Codex is not authorized to invoke or automate it.

## Snapshot F — User manually used Delete on synthetic candidate

| Entity / signal | Before delete | After user Delete | Conclusion |
|---|---|---|---|
| `ZPResumeInfo.ID=43177` | row exists | row still exists | Not a physical hard delete. |
| `ZPResumeInfo.Active` | `1` | `0` | Verified deactivation / soft-delete state change. |
| `ZPResumeInfo.Status` | `0` | `0` | Status did not change in this UI action. |
| `zpresumeinfoDel` | no candidate tombstone | new `FID=43177` / `DelDate=2026-08-11 14:14:43.560` | Verified deletion tombstone. |
| Main and related attachments | V1/V2 BLOBs exist | all rows and BLOBs remain | Documents are retained. |
| `ZPResumeInfo_5` rows | V1/V2 rows exist | unchanged | Render/attachment relations remain. |
| Candidate note history | core-edit row exists | unchanged | No additional observed delete-history row. |

### Delete / archive contract

**PINPIN LIFECYCLE MODEL: SOFT DELETE / DEACTIVATION with tombstone.** The tested Delete UI path retains the candidate and documents, sets `ZPResumeInfo.Active=0`, and inserts `zpresumeinfoDel` with `FID` and structured `DelDate`. TN must retain the candidate/document records and update lifecycle state; it must not hard-delete its copy.

**DELETE/ARCHIVE DETECTION: GREEN** for the tested Delete path:

```text
zpresumeinfoDel.FID / DelDate
  + ZPResumeInfo.Active = 0
  + candidate/document retention reconciliation
```

Archive UI semantics, if distinct from Delete, remain untested.

## Part B contract conclusions

### Candidate identity and deployment scope

```text
source_system = pinpin
source_instance = pinpin-prod
external_candidate_id = dbo.ZPResumeInfo.ID
```

Operational metadata remains separate: production endpoint `103.144.32.63`, instance `MSSQLSERVER`, database `HiBole-2`. The controlled candidate confirms the UI Candidate ID equals `ZPResumeInfo.ID`. Candidate identity is **VERIFIED WITH CAVEATS**: normal identity is stable, but reseed/restore/future instance/merge caveats remain.

### Verified / bounded contract summary

| Contract | Part B conclusion |
|---|---|
| Owner | DEFERRED — `CreUser` / `ModifyUser` observed, no safe owner trace or verified user mapping. |
| Source | PARTIAL — `CVSource` is populated but did not join to inspected source masters. |
| Current work company | VERIFIED on tested current row: `ZPResumeWork.Company`. |
| Current work title | VERIFIED on tested current row: `ZPResumeWork.F1`, with `IsCur=1`. |
| Multiple attachments | VERIFIED — independent V1 ID 983 and V2 ID 984 coexist. |
| Attachment stable ID | VERIFIED — `ZPResumeInfo_Annex_Other.ID`. |
| Original filename | VERIFIED — `ZPResumeInfo_Annex_Other.FileName`. |
| Original document storage | VERIFIED — SQL BLOB `Annex` / `Annex1`. |
| `addFileName` | PARTIAL — plugin HTML intake temporary key; no durable column mapping verified. |
| `uuidname` | PARTIAL — upload/bind token; final attachment-row mapping not observable post-upload. |
| Preview selection | PARTIAL — UI switch produced no observed authoritative DB signal. |
| Resume versions | VERIFIED for coexistence and Delete-time retention. |
| Merge | STATIC ONLY / DEFERRED. |

### Sync signal matrix

| Concern | Primary signal | Reconciliation / fallback | Rating |
|---|---|---|---|
| Initial import | scoped candidate ID + children/documents | paged baseline scan | GREEN |
| New candidate | identity high-water | periodic scoped ID reconciliation | YELLOW |
| Core update | candidate note `LastDate` observed for tested title edit | candidate/work/education comparison | YELLOW |
| Work / education update | child rows by `ResumeID` | periodic child comparison | YELLOW |
| Document addition | `Annex_Other.ID`, `CreDate`, metadata | attachment comparison | GREEN |
| Preview switch | no observed DB signal | do not synchronize as authoritative state | RED as DB watermark |
| Delete | tombstone + `Active=0` | state reconciliation | GREEN |
| Owner | no verified mapping | defer / future controlled trace | DEFERRED |
| Source | raw `CVSource` | preserve raw and map later | YELLOW |

**Recommended incremental strategy:** master candidate discovery plus **multi-table watermarks and periodic reconciliation**. Do not rely on `ZPResumeInfo.RDate`; it did not change after V2 upload, preview switch or tested core edit.

### Future TN document model assessment

Evidence supports separate conceptual `candidate` and `candidate_documents` entities. Documents should use scoped candidate ID + `ZPResumeInfo_Annex_Other.ID`, with filename/type/size/create-time/BLOB-presence metadata. A TN `primary_resume_document_id` may be useful but must remain nullable/user-selected until Pinpin's preview mechanism is verified.

### Final Part B ratings

- Initial import: **GREEN**.
- New candidate detection: **YELLOW**.
- Core update detection: **YELLOW**.
- Child-table update detection: **YELLOW**.
- Document update detection: **GREEN for addition / YELLOW for replacement**.
- Delete/archive detection: **GREEN for tested Delete path**.
- Overall incremental sync: **YELLOW**.
- Plugin + DB hybrid identity model: **GREEN with non-blocking plugin event and DB reconciliation**.

### Remaining unknowns and Phase 2 readiness

Remaining unknowns: owner/user mapping, `CVSource` lookup contract, `addFileName`/`uuidname` final controller mapping, authoritative preview-selection persistence, archive UI semantics, and merge/reseed behavior.

**PHASE 2 READINESS: GREEN for conservative contract design.** Identity, scoped documents, attachment IDs/storage, tested work-title mapping, soft-delete lifecycle and reconciliation requirements are verified. Owner/source/preview mappings must remain nullable/deferred. No Phase 2 implementation is authorized by this report.

### Part B completion statement

All authorized checkpoints completed: Snapshot A (V1), Snapshot B (V2 coexistence), Snapshot C (preview switch), Snapshot D (core field), owner deferred, Snapshot F (Delete). No merge was tested. No production change was made by Codex.
