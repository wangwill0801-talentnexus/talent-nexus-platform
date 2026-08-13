# Talent Nexus Plugin AI Fill 資料流稽核

> 稽核日期：2026-08-11  
> 性質：Future Design Audit（唯讀架構／資料流規劃）  
> 範圍：現有 Connector、AI Resume API 與 Pinpin New Talent 原始儲存鏈。  
> 非範圍：不修改 Pinpin、TN production、資料庫、IIS、排程、Chrome Plugin 或 API。

## 1. Executive Summary

**已找到可重用的 AI Fill 結構化 payload：YES。**

Connector 與後端已共享一份 `Standard Resume JSON`。它比 Pinpin New
Talent 的直接送出 payload 豐富許多：含候選人基本資料、目前任職、工作經歷、
教育、技能、語言、專案、證照、求職偏好、履歷摘要，以及 recruiter summary、
target roles、核心關鍵字等 AI intelligence。

但目前標準 New Talent save 的直接表單 payload 僅明確帶出姓名、電話、Email
（以及既有招聘顧問選定的 industry／status／folder／job／tags）。完整履歷內容由
Pinpin 伺服器以暫存檔識別值處理；Connector 並沒有把 AI 結構化工作／教育／技能
直接送進一個第二 Pinpin 寫入 API。因此，TN 未來最有價值且最安全的資料入口是：
**將已驗證的 AI Fill payload 作為非阻塞 side-car 保存，待原始 Pinpin Save 成功後再
以 Pinpin Candidate ID 綁定。**

這不是目前的實作授權。本文件只提出未來契約與受控寫回設計。

## 2. Scope / Safety Confirmation

- 本稽核只讀取本機 `working/` Connector source、`ai-page-netlify/` AI API source
  與既有 mapping 文件。
- 未對 Pinpin、HiBole-2、TN PostgreSQL、TN API production、IIS、Chrome extension
  或排程執行寫入。
- 未讀取 candidate resume BLOB，未查詢 production candidate 資料，未呼叫 Pinpin
  write API。
- 現行 Phase 4E 同步契約保持不變：**Pinpin → TN，read-only**。

## 3. Evidence Used

| Evidence | What it proves |
|---|---|
| `working/js/versions/v1/sites/tnai-schema.js` | Connector-side Standard Resume JSON schema and mock shape |
| `ai-page-netlify/lib/resume-schema.mjs` | Backend mirror schema and Gemini response schema |
| `working/js/versions/v1/sites/tnai.js` | source capture, AI call, deterministic source metadata, New Talent mapping and Note merge |
| `working/js/versions/v1/sites/site104.js` | 104 visible-DOM capture and candidate-card ambiguity fail-closed behavior |
| `working/js/versions/v1/sites/linkedin-public-pinpin.js` | public LinkedIn canonical URL, semantic preview capture and hydration behavior |
| `working/js/versions/v1/sites/tnpdf.js`, `working/pdf-import.mjs` | PDF.js local text extraction and `addFileName`-locked handoff |
| `working/js/versions/v1/sites/tnats-ai-fill.js` | ATS complete-resume AI Fill PDF/DOCX/HTML path |
| `working/js/versions/v1/default/page.js`, `working/background.js` | original Pinpin New Talent / duplicate / submit message contract |
| `docs/AI_PINPIN_FIELD_MAPPING.md` | source-verified direct persistence boundary |

## 4. Current Plugin AI Fill Architecture

```text
104 / LinkedIn / PDF
  visible DOM or local file text
        │
        ▼
Connector source capture (source-specific and fail-closed)
        │
        ▼
POST /resume-ai-parse over HTTPS
        │
        ▼
Gemini structured response + server validation
        │
        ▼
Standard Resume JSON
        ├── Connector formats deterministic AI Note + source metadata
        └── Pinpin New Talent live Angular model:
              chineseName / mobile / email only
                    │
                    ▼
          Recruiter manually uses original Pinpin Save
                    │
                    ▼
       /rest/resume/addbyplug → Pinpin Candidate ID
```

The ATS Complete Resume AI Fill route is a separate controlled feature:
it accepts PDF, DOCX, and HTML locally, displays review, then fills the active
ATS form without auto-saving. It is not the same as the original New Talent
candidate-import chain.

### 4.1 AI/API boundary

- Connector posts `source`, `resumeHtml`, `resumeText`, `currentPinpinFields`
  and optional `noteRetry` to `/.netlify/functions/resume-ai-parse`.
- Gemini API key exists server-side only. The Connector does not contain the
  provider key.
- API returns validated structured resume JSON, model name, warnings and
  count-only metadata; it does not echo raw resume text/HTML.
- Mock mode returns the shared anonymized mock JSON and makes no model call.

### 4.2 Source capture routes actually present

| Source | Current capture route | AI Fill availability | Important boundary |
|---|---|---|---|
| 104 candidate | `TN104.capture104Resume()` captures current opened card + resume wrapper, otherwise safe fallback | Yes | Ambiguous list card omits summary card instead of guessing identity |
| LinkedIn Public | semantic profile header/sections, hydration scroll, canonical `/in/<slug>/` | Yes | Candidate URL/name freeze; candidate switch/incomplete capture fails closed |
| LinkedIn Recruiter | live profile text root resolver | Yes | Public `/in/` URL only when a verified anchor exists; no slug inference |
| PDF | bundled PDF.js extracts local text; memory bridge keyed by exact `addFileName` | Yes | No OCR; text stays run-scoped in memory |
| DOCX | Mammoth raw-text extraction in ATS Complete Resume AI Fill | ATS-only | Not an original New Talent source route |
| HTML | DOMParser text extraction in ATS Complete Resume AI Fill | ATS-only | Not an original New Talent source route |
| legacy sourcing sites | old HTML capture/import branches exist | Not established as current AI Fill contract | Outside this audit's verified AI payload path |

## 5. Actual Existing AI Fill Payload

`Standard Resume JSON` is the shared normalized object. The exact current
field groups are:

| Group | Fields |
|---|---|
| Candidate | `name`, `englishName`, `phone`, `email`, `location`, `expectedLocation`, `linkedin` |
| Current employment | `company`, `title` |
| Experience[] | `company`, `title`, `startDate`, `endDate`, `isCurrent`, `department`, `location`, `description` |
| Education[] | `school`, `degree`, `major`, `startDate`, `endDate` |
| Capability | `skills[]`, `languages[]`, `languageDetails[]`, `certifications[]`, `projectExperience[]` |
| Narrative | `jobPreferences`, `summary` |
| Recruiter intelligence | `targetRoles[]`, `recruiterSummary`, `coreKeywords[]`, legacy fallback `searchNote` |

The backend instructs Gemini to return missing values as null/empty rather
than placeholders, to preserve location wording/language, not infer degree,
not generate LinkedIn URL/104 code, and to ground recruiter intelligence in
resume evidence. The extension, not Gemini, formats the final Note markers and
source identity lines.

## 6. Current Pinpin Field Mapping and Reduction

### 6.1 Canonical save path

The original Angular `AddResumeCtrl.submit(true)` serializes `a.resume` and
sends it through `request.api.submit` to `/rest/resume/addbyplug`.
The success response `data` is used as the new Pinpin Candidate ID. In a
duplicate flow, Pinpin's duplicate response/list provides the existing
candidate `item.id`; save/replace continues through existing Pinpin endpoints.

The direct AI mapper writes only:

| Standard Resume field | Pinpin live model | Directly in original save |
|---|---|---|
| `candidate.name` | `resume.chineseName` | Yes |
| `candidate.phone` | `resume.mobile` | Yes, digits normalized; Taiwan `+886` becomes leading `0` |
| `candidate.email` | `resume.email` | Yes, only valid non-placeholder email |
| existing recruiter selections | `industry`, `function`, `status`, `folder`, `joborder_id`, `tags` | Preserved; AI does not invent/overwrite taxonomy |

The full captured resume is handed to Pinpin through its existing temporary
file route. The `addFileName` value is a temporary-file reference used for
`/rest/file/temp` / original Save processing; it is not a verified durable
candidate identity. The actual server-side persistence semantics for every
parsed field are not observable from Connector source alone.

### 6.2 Data reduced or not directly written by AI

| AI field | Current New Talent direct write | What is known |
|---|---|---|
| English name, LinkedIn, location, expected location | No | May exist in captured file/server parser, but not in `a.resume` direct AI map |
| Current company/title | No | Review/intelligence value; not direct AI map |
| Work / education / skills / languages / certifications / projects | No | Full source file goes through Pinpin temporary-file parsing; source alone cannot prove exact retained columns |
| Summary / recruiter summary / roles / keywords | AI Note field only | Connector finds Note input dynamically and merges TNT block; direct Note persistence must be validated via controlled UI behavior |
| 104 resume code / LinkedIn URL / LINE ID | Generated Note metadata only | Deterministically owned by Connector; no evidence they are structured Pinpin fields |

Therefore a future TN side-car must retain the **original validated structured
AI payload plus provenance**, rather than reconstructing it later from Pinpin's
reduced New Talent form.

## 7. Field Inventory

| Field / group | Current source | AI generated? | User editable? | Written to Pinpin? | Preserved by Pinpin proven? | Available after Save? | TN usefulness / sensitivity |
|---|---|---:|---:|---:|---:|---:|---|
| Pinpin Candidate ID | addbyplug success / duplicate list | No | No | N/A | Yes as response/list identifier | Yes | Identity; high value |
| 104 resume code | current captured 104 HTML `代碼:` pattern | No | No | Note only | Not as structured field | In Note only if saved | Provenance; high |
| 104 source URL | current page URL on original save | No | No | Original payload URL | Exact retention not verified | Not contractually exposed | Provenance; medium |
| LinkedIn canonical URL | public page URL or verified Recruiter anchor | No | No | Note only | Not as structured field | In Note only if saved | Identity/provenance; high |
| Name / English name | explicit source / AI extraction | Extracted | AI review varies by flow | Chinese name yes; English no direct map | Chinese name yes | Chinese name yes | Identity; high |
| Phone | explicit source / AI extraction | Extracted | Yes before save | Yes | Yes | Yes | Identity; highly sensitive |
| Email | explicit source / AI extraction | Extracted | Yes before save | Yes | Yes | Yes | Identity; highly sensitive |
| Location / expected location | explicit source / AI extraction | Extracted | ATS review; New Talent not direct | No direct New Talent map | Unknown | Not guaranteed | Profile; personal data |
| Current company / title | work evidence / AI extraction | Extracted | ATS review | No direct New Talent map | Unknown | Not guaranteed | Profile; medium |
| Work history | resume evidence / AI extraction | Extracted | ATS review | File parser path only | Exact mapping unverified here | Not guaranteed structured | Profile; medium |
| Education | resume evidence / AI extraction | Extracted | ATS review | File parser path only | Exact mapping unverified here | Not guaranteed structured | Profile; medium |
| Skills / languages / certifications | resume evidence / AI extraction | Extracted | ATS review | File parser path only | Exact mapping unverified here | Not guaranteed structured | Intelligence/profile; medium |
| Summary | AI structured output | AI generated from evidence | ATS review | Note only in New Talent | Note behavior requires controlled validation | Not guaranteed structured | AI enrichment; medium |
| Recruiter summary | AI structured output | Yes | Note edit possible | Note only | Same qualification | Not guaranteed structured | AI enrichment; medium |
| Target roles / keywords | AI structured output | Yes | Note edit possible | Note only | Same qualification | Not guaranteed structured | AI enrichment; medium |
| Consultant-authored note | existing Note content | No | Yes | Existing field | Existing text is preserved by Connector merge | If Pinpin saves note | Consultant intelligence; high |
| LINE ID | explicit visible source evidence | No | No | Note only | Not verified structured | Note only if saved | Contact identity; highly sensitive |
| Source type / filename | capture route / local file | No | No | Temp file route | Filename retention not fully verified | Not a stable API contract | Provenance; medium |
| AI model / generation time | backend response / request time | No | No | No | No | No | Provenance/audit; low PII |

## 8. Existing Identity Behavior

### 8.1 Pinpin ID

- New candidate: `/rest/resume/addbyplug` success response supplies the ID.
- Duplicate candidate: `/rest/candidate/listforcrx` returns existing `item.id`.
- This is the strongest future join only **after** the Pinpin save/duplicate
  resolution completes, and must include the verified Pinpin deployment scope.

### 8.2 104 number and URL

The accepted current Note label is `【104履歷代碼】<digits>`. The Connector reads
only the captured current candidate HTML in a detached element and conservatively
matches `代碼:` followed by at least six digits. It does not ask Gemini, infer
from name, or read an adjacent card. Ambiguity/missing evidence omits the line.

This proves the value is a deterministic **displayed resume-code capture**.
It does **not** prove that the code is a globally durable 104 candidate identity
across 104 products, URLs, exports or future account scopes.

**104 DURABLE ID = UNVERIFIED.** A future controlled test should compare the
same authorized 104 candidate across refresh/navigation/export paths and record
whether the visible resume code and source URL remain stable.

### 8.3 LinkedIn

- Public profile: URL is canonicalized to `https://www.linkedin.com/in/<slug>/`;
  query/tracking parameters are excluded.
- Recruiter: only a verified in-page public `/in/<slug>/` anchor is accepted.
- Missing/ambiguous identity is omitted. Gemini is explicitly forbidden from
  generating URL or slug.

**LinkedIn identity available = YES**, as a canonical deterministic source
reference when capture succeeds; it remains a mutable external profile URL,
not an immutable universal key.

### 8.4 Phone and email

Phone and email are available only when explicit source evidence exists. Phone
normalization is presentation/matching support, not identity proof:
`0912-345-678`, `0912345678`, and `+886912345678` normalize to `0912345678`.
Email should be trimmed and case-normalized for matching. Neither should become
an immutable primary key; the future model must support multiple observed
values with provenance and time.

## 9. Notes / Summary / Keywords

Current Note behavior is intentionally mixed at the Pinpin presentation layer:

1. Connector keeps recruiter-authored text before `--- TNT 人才備註 ---`.
2. Repeated AI Fill replaces the previous generated TNT block; it does not
   append a second generated source block.
3. Generated block includes recruiter summary, target roles, keywords, highest
   education and location when supported.
4. Connector appends deterministic LINE / LinkedIn / 104 metadata last; Gemini
   does not generate those values or markers.

For TN, this should be decomposed rather than stored as one generic Note:

- **Candidate summary** — versioned AI enrichment.
- **Keywords / skills** — structured AI enrichment with source evidence.
- **Consultant notes** — human-authored content, separately protected.
- **AI insights / screening** — distinct, optional future domain; no current
  schema assumption.
- **Source metadata** — immutable observation/provenance record.

## 10. Recommended TN Data Classification

| TN domain | Recommended current inputs |
|---|---|
| Candidate identity | TN candidate UUID; Pinpin deployment scope + Candidate ID; observed 104 displayed code (unverified durable); LinkedIn canonical URL; normalized/raw phone and email |
| Structured profile | names, raw location, expected location, current employment, work, education, explicit skills/languages/certifications/projects |
| AI enrichment | summary, recruiter summary, target roles, core keywords; model/version, generation timestamp and source evidence reference |
| Consultant intelligence | human note text, human verification, screening decisions; never silently blend with AI fields |
| Source/provenance | source type, canonical/ref URL, filename/reference where valid, captured/observed/generated times, model, confidence, verification actor/time |

## 11. Recommended Plugin → TN Side-Car

### 11.1 Non-blocking future flow

```text
Source → Connector capture → AI Fill → validated Standard Resume JSON
                                    ├─ existing Pinpin form fill / original save
                                    └─ temporary encrypted-or-ephemeral side-car payload

Original Pinpin Save / duplicate resolution
                    │
                    ▼
            Pinpin Candidate ID available
                    │
                    ▼
 Connector sends idempotent TN enrichment attach request
                    │
                    ▼
 TN resolves identity, stores payload + provenance and returns success/failure
```

Requirements for a later implementation:

- Pinpin completion remains primary. TN network/API failure must not block,
  retry, or alter original Pinpin save behavior.
- Stage raw structured payload before save with a short TTL and random run ID;
  do not use URL parameters or persistent plaintext browser storage for PII.
- Bind only after receipt of a Pinpin ID or confirmed duplicate target ID.
- Use HTTPS plus server-side authentication; do not expose TN API token, Gemini
  key, Pinpin cookies or PII in logs.
- Send an idempotency/correlation ID and payload fingerprint. Explicitly retain
  a source provenance record instead of overwriting an earlier observation.
- If Pinpin save fails or user closes New Talent, discard the temporary payload.

### 11.2 Feasibility

**Technically feasible: YES, with a small future Connector + TN API contract.**
The necessary junction exists: original save success supplies Pinpin ID, and
the AI parser already returns structured JSON. It is not currently wired to
TN, and should not be piggybacked on Pinpin endpoints.

## 12. Candidate Identity Resolution Proposal

Use a confidence outcome, never automatic weak-evidence merge:

| Priority | Evidence | Proposed outcome |
|---:|---|---|
| 1 | same deployment scope + exact Pinpin Candidate ID | `EXACT_MATCH` |
| 2 | exact verified 104 durable identifier, only after controlled verification | `EXACT_MATCH` or `PROBABLE_MATCH` based on verification result |
| 3 | exact canonical LinkedIn URL | `EXACT_MATCH` for external-ref observation; candidate merge still checks conflict state |
| 4 | exactly one compatible normalized email or phone ref | `PROBABLE_MATCH`; review if competing identity signals |
| 5 | name + company/title/location combination | `AMBIGUOUS` / review-only; never auto-merge |
| 6 | no credible match | `NEW_CANDIDATE` provisional until Pinpin ID arrives |

Conflicts (for example a LinkedIn URL pointing to one TN candidate and a phone
to another) must produce `AMBIGUOUS`, retain observations, and request human
resolution rather than choose a winner.

## 13. Future Controlled TN → Pinpin Write-Back

The appropriate future path is **TN → Connector → live Pinpin page →
recruiter diff/review → existing Pinpin Save**. It preserves Pinpin validation,
normal business flow and the user's final confirmation.

Direct SQL Server updates should not be the default write-back design. They
would bypass application validation, audit behavior, attachment rules and
future Pinpin upgrade compatibility.

### 13.1 Field classification

| Level | Examples | Future policy |
|---|---|---|
| 1 — Fill Empty | explicit email, normalized phone, canonical LinkedIn URL, explicit location, explicitly sourced skills | Propose only if target Pinpin field is blank and evidence/provenance is clear |
| 2 — Review Difference | name spelling, current company/title, summary, work/education, skills, language, source URL | Show Pinpin vs TN values and require Keep Pinpin / Use TN |
| 3 — Verified Auto-Fill Candidate | None approved by this audit | Do not enable until field-specific controlled validation and governance approval |
| 4 — Never Auto-Overwrite | human consultant notes, owner, source, tags/folder/job, status, taxonomy selections, gender, birth data, salary, nationality/ID, marital status, screening outcomes, original documents | Always preserve or require explicit human action |

Dropdown/taxonomy values (industry, function, degree, language proficiency,
location classification) require an actual Pinpin option match. The AI/TN may
recommend but must not insert arbitrary text where there is no verified option.

## 14. Loop Prevention Proposal

Every future approved write-back should create a TN audit event with:

`candidate_uuid`, `target_pinpin_id`, `entity_type`, field-level before/after
fingerprints, payload fingerprint, TN enrichment/version ID, `written_at`,
`status`, actor and `correlation_id`.

During later Pinpin → TN reconciliation:

1. If observed Pinpin content fingerprint equals the approved write-back event,
   record source acknowledgement/provenance and perform a true no-op.
2. If it differs, treat it as a new external/source change; do not force TN
   content back into Pinpin.
3. Preserve field-level provenance and source observation times so a recruiter
   can see why a value differs.

This is a design only. It requires a future schema migration and tested
reconciliation behavior before it can be enabled.

## 15. Unknowns Requiring Controlled Testing

1. Which full parsed captured-file fields Pinpin actually persists and exposes
   after its normal New Talent save.
2. The exact Pinpin model/API field for the dynamically located Note input and
   its normal save/autosave behavior.
3. Whether a displayed 104 resume code is durable across 104 scopes/URLs.
4. Whether Pinpin stores / exposes source URL, source type, AI note and source
   metadata as structured values rather than only rendered resume content.
5. Canonicalization, duplicate and collision behavior for multiple phones/emails.
6. The final authentication/trust contract for Connector → TN side-car requests.
7. Consent, retention, access-control and audit requirements before storing
   AI enrichment separately from Pinpin.

## 16. Recommended Implementation Order

1. Complete and review the current Phase 4E candidate synchronization work.
2. Approve this audit's field/provenance and identity decisions; do not infer
   104 durability meanwhile.
3. Build a minimal read-only TN Candidate Search / Candidate 360 view from
   already synchronized Pinpin baseline data.
4. Design and migrate a narrow enrichment/provenance contract (not a full
   Pinpin mirror) with explicit identity conflict states.
5. Implement Connector → TN non-blocking side-car behind an opt-in/review
   gate; validate only synthetic and authorized candidates.
6. Add AI summary/keywords/location enrichment presentation with provenance
   and separation from consultant notes.
7. After controlled validation, implement Pinpin **Fill Empty** proposal UI.
8. Later add Pinpin **Review Difference** UI and loop-prevention ledger.
9. Only then consider richer resume evidence, canonical profile, AI search and
   JD matching.

## 17. Audit Conclusion

The existing AI Fill workflow already provides a credible enriched structured
intake point. The key design rule is to preserve it as a **separate, versioned,
provenanced TN enrichment**, attached after the normal Pinpin candidate
identity is known—not to assume Pinpin's New Talent form is a complete mirror
of the AI result, and not to use direct database write-back.

**TN PLUGIN / AI FILL DATA AUDIT REVIEW REQUIRED**
