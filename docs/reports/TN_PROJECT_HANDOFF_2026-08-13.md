# Talent Nexus 專案完整交接快照

**快照日期：** 2026-08-13（Asia/Taipei）  
**工作區：** `C:\Users\William Wang\Desktop\TalentNexus-104-Golden`  
**用途：** 提供下一位 AI／工程代理可直接接手的 repository、production、資料契約與治理基線。  
**性質：** 唯讀稽核後的狀態輸出；本次沒有修改程式、資料庫、production、Connector、IIS、DNS、Entra、Netlify 或 Git history。

---

## 1. Executive Summary

Talent Nexus 已不是單純的 Chrome 擷取插件。現況是一套以 Pinpin ATS 為作業主系統、以 PostgreSQL 為候選人智慧資料層、以 Chrome Connector 為來源擷取與 recruiter workflow、以 TN API 為 identity／baseline／evidence／AI interpretation 接收邊界的混合架構。

截至本快照，以下 production 能力已有明確證據：

- PostgreSQL 17.10 與 TN API 已在 VPS 上運作，分別只監聽 `127.0.0.1:5432` 與 `127.0.0.1:3333`。
- 公開入口 `https://tn-api.talentnexus.com.tw` 經 IIS HTTPS reverse proxy 導向本機 Fastify；3333、5432、1433 不公開。
- Pinpin → TN 初始匯入、手動 reconciliation、child logical identity、附件 metadata、soft-delete lifecycle 與 recovery/replay 已完成多階段驗證。
- Connector `5000.0.115 Entra Side-car` 已具備 Entra Authorization Code + PKCE、silent-first、session-only token、成功 ATS Save 後才 side-car dispatch 的能力。
- Candidate Intake migration 003、immutable snapshot、AI projection、evidence metadata、processing state 與 internal Data Browser 已部署；既有人選 43198 與全新 Connector E2E 43219 均 PASS。
- Production migration ledger目前為 001、002、003；43219 驗證後總量為 194 candidates、194 external refs、536 baseline work、137 baseline education、245 document metadata、17 snapshots，scoped external-reference duplicates = 0。

下一個合理 build 是 **Candidate Evidence & AI Processing Foundation**，但只能在現有 identity、evidence、read-only ATS 與 no-BLOB 原則下進行。VPS worker／queue、deterministic extraction、controlled original-evidence reference、normalization、reprocessing 尚未建置；Talent Search／Candidate 360 應排在該基礎之後。

最大的非 runtime 風險是 Git 治理：`services/tn-api` 是根工作區的一般 source directory，但目前完全未被 root Git 追蹤；大量 production-relevant Connector、docs、release artifacts 也處於 untracked／dirty 狀態。下一位 AI 不得把現在的 root HEAD `c5537e1` 當成完整 production source of truth，也不得在沒有先定義 ownership 與乾淨 release branch 的情況下 blanket stage／commit。

---

## 2. Repository Map 與 Source of Truth

### 2.1 根工作區

- 路徑：`C:\Users\William Wang\Desktop\TalentNexus-104-Golden`
- Root Git branch：`master`
- Root HEAD：`c5537e1`
- 工作樹：大量 dirty／untracked；`.gitignore` 為空。
- `AGENTS.md` 存在但尚未追蹤，記錄永久工程不變量。
- 根目錄沒有總 README；專案真相分散於 code、phase reports、architecture、roadmap 與 production E2E report。

### 2.2 重要目錄

| 路徑 | 角色 | 目前可信度／治理狀態 |
|---|---|---|
| `working/` | Connector 主要 source 工作區；另有 nested Git | 實際程式重要；branch `feature/ai-resume-review`、HEAD `ecf8de4`，但有大量未提交變更 |
| `original/` | Golden／原始 Connector 基線 | Freeze zone；不得用新功能直接覆寫 |
| `dist/chrome-extension/unpacked-ai-test/` | Chrome 目前測試載入的 unpacked runtime | 關鍵檔案 hash 與 `working/` 相符；不是乾淨、可重建性已證明的 release artifact |
| `dist/chrome-extension/*.zip` | 歷次 POC／release ZIP | 保留 release history；多數未被 Git 追蹤 |
| `services/tn-api/` | TN Fastify/PostgreSQL backend source | **production-relevant 但 root Git tracked files = 0；最高治理風險** |
| `ai-page-netlify/` | 現行 Connector Gemini parser、PDF workspace、job/company parser | Root tracked 部分 + dirty/untracked 新功能；目前 source 與 deploy worktree 需另行收斂 |
| `_backend_publish_worktree/` | GitHub/Netlify backend publish worktree | branch `main`、HEAD `de0b04c`、origin `talent-nexus-ai-api`；有 dirty changes |
| `docs/` | 歷史 phase audit、contracts、security、runbook、SOP | 有權威 production evidence，也有過期敘述；必須看日期與 completion appendices |
| `docs/architecture/` | 現行 candidate intake architecture decisions | 目前最接近設計 source of truth |
| `docs/roadmap/` | 下一階段順序與 deferred scope | 目前有效，但每一 phase 仍需 explicit gate |
| `docs/reports/` | 最新 production E2E 證據 | `TN_CANDIDATE_INTAKE_PRODUCTION_E2E_REPORT.md` 為目前最權威完成證據 |

### 2.3 Git 特別注意

- Root 將 `working` 記錄為 mode `160000` gitlink，但沒有 `.gitmodules`；不能把它當正常可 clone 的 submodule。
- `services/tn-api` 不是 nested repo、submodule、ignored path 或 generated artifact，卻從未加入 root repository。
- `working/`、`unpacked-ai-test/` 與其他 unpacked release 內存在各自 `.git`，容易讓 `git status`、commit scope 與 source ownership 判斷錯位。
- `_backend_publish_worktree` 是另一個有 GitHub origin 的 publish worktree，不可和 TN VPS backend 混為一個 repository。
- `CHANGELOG.md` 與部分 README 停留在較早版本；例如 Golden base 5000.0.108、未 live test、TN backend 尚未連 Pinpin／AI 等描述已被後續 production evidence 取代。

**接手原則：** 先決定 root、Connector、Netlify backend、TN API 各自的正式 Git ownership，再做任何 commit。禁止 `git add .`、禁止覆蓋 user dirty changes、禁止用 dist artifact 反向取代 source。

---

## 3. 系統與邊界總覽

```text
104 / LinkedIn / PDF-DOCX-HTML / ATS pages
                |
                v
Talent Nexus Connector 5000.0.115
  - deterministic capture
  - local document extraction
  - recruiter preview / AI Fill
  - original Pinpin Save remains authoritative
                |
                +--> api.talentnexus.com.tw (Netlify Gemini parser, transitional)
                |
                +--> after successful ATS Save + exact numeric ATS ID
                      Entra access token / TN.Sidecar.Write
                              |
                              v
                  tn-api.talentnexus.com.tw (IIS HTTPS edge)
                              |
                              v
                  127.0.0.1:3333 TN Fastify API
                     |                    |
                     |                    +--> PostgreSQL 17.10 / talentnexus
                     |
                     +--> read-only LPC / Shared Memory
                          SQL Server HiBole-2 metadata only
                          no Pinpin writes / no Annex BLOB reads
```

### Canonical system roles

- **Pinpin ATS：** recruiter operational system of record；原始 Save／人選作業流程仍由 Pinpin 控制。
- **TN PostgreSQL：** scoped identity、read-only ATS baseline、immutable AI snapshots、evidence metadata、processing state 與未來 search/intelligence 的資料層。
- **Connector：** deterministic capture、輕量文件抽取、preview、recruiter confirmation、ATS Save callback 與 side-car package；不應成為長時間 deep AI worker。
- **Netlify AI backend：** 現行 Gemini resume/job/company parser 與 PDF workspace，stateless、無 TN database；屬過渡中的 active dependency。
- **TN API／未來 worker：** 深度 parsing、normalization、enrichment、replay、historical reprocessing 的長期正確邊界。
- **TNT／HUB／SOP／行政打卡：** 其他工作區的外部系統；共享同一 Entra ecosystem 的部分登入設計，但不在此 repository，不能從本 repo 推論其最新 release state。

---

## 4. Connector 現況

### 4.1 Release 與 runtime

- Manifest V3。
- Current version：`5000.0.115`
- Version name：`5000.0.115 Entra Side-car`
- `working/manifest.json` 與 `dist/chrome-extension/unpacked-ai-test/manifest.json` 相符。
- 主要 runtime files（background、options、tnai、sidecar、recovery、ATS/job/company adapters、104/LinkedIn/PDF）在 `working/` 與 `unpacked-ai-test/` hash 相符。
- 正式 distribution／SharePoint 是否指向哪個 ZIP，本次未登入外部系統重驗；不得僅由檔名宣稱已正式發布。

### 4.2 支援來源與流程

- 104 candidate／resume capture。
- LinkedIn Public 與 LinkedIn Recruiter／legacy LinkedIn path。
- PDF、DOCX、HTML：bundled PDF.js、Mammoth、本機文字抽取與 ATS AI Fill。
- ATS candidate add/edit：中文與英文 adapters。
- Job AI Fill：104 job、LinkedIn job、中文／英文 ATS job adapters、補充資訊、翻譯／AI enhancement UI。
- Company AI Fill：104 company、ATS company adapter、公司預覽與隱名簡介方向。
- LINE、deterministic 104 resume code、canonical LinkedIn URL 等既有功能仍存在。
- ATS candidate/job/company 按鈕使用 mutation observation／recovery 邏輯處理 Angular route 與動態 DOM。

### 4.3 Standard Resume 與 AI Note

- Canonical schema version：`standard_resume_v1`。
- 內容涵蓋姓名、英文名、電話、Email、位置、期望地點、LinkedIn、summary、skills、languages、certifications、projects、job preferences、多筆 work／education 與 recruiter intelligence。
- Gemini 不產生 source identity；104 code 與 LinkedIn canonical URL 必須由 Connector deterministic capture 提供。
- Accepted 104 Note metadata format：`【104履歷代碼】<actual code>`。
- Accepted LinkedIn metadata format：`【LinkedIn】<canonical /in/.../ URL>`。
- source identity 在 AI run start freeze；不明確時 fail closed，不猜測、不用姓名相關聯。
- AI Fill 不應自動點 Pinpin Save；recruiter 仍需確認並使用原始 Save。

### 4.4 Side-car 與 Entra

- Public route：`POST /api/v1/plugin-sidecar/candidate-enrichment`。
- Auth：Microsoft Entra Authorization Code + PKCE S256，silent-first。
- Required delegated scope：`TN.Sidecar.Write`。
- Access token 僅存在 `chrome.storage.session`；不要求 `offline_access`，不保存 refresh token。
- Queue 位於 extension local storage，最多 5 筆、24 小時 expiry、最多 4 次 retry；terminal failure 保留供人工 retry。
- Payload contract：`plugin_sidecar_intake_v1` + `standard_resume_v1`。
- 只有 original Pinpin Save 成功回傳 numeric Candidate ID 後才 queue／send。
- frozen-run recovery 優先 extension-owned run/tab/session 與 `addFileName`；LinkedIn 可使用 same session + exact canonical `/in/<slug>/`；phone/email 只是可選輔助，name 單獨永遠不夠。
- 最終 identity 一律是 successful Save 後的 Pinpin Candidate ID，而不是姓名、email、phone、104 code 或 LinkedIn URL。

### 4.5 Connector 安全與已知風險

- Manifest content script 使用 `<all_urls>`，host permissions 也保留多個 legacy recruiting sites；這是高權限面，未來 release 應檢查最小化可能性，但不可在未做完整 regression 前直接縮減。
- Pinpin core controllers、original submit、duplicate/update binding、toolbox Angular binding 屬 freeze zone。
- `unpacked-ai-test` 是目前驗證 runtime，不等於 reproducible release pipeline。
- Job／Company AI Fill 是後加入功能；不得讓其 schema、mode 或 bridge 汙染 candidate AI Fill。
- 現行 Netlify parser auth 仍偏 deploy/test token 模型，不是 TN Entra resource-server 等級。

---

## 5. Pinpin Source Contract

### 5.1 Deployment 與 identity

- Production Windows Server 2019。
- Chinese／English ATS 經 IIS；現有 HTTPS：
  - `https://ats.talentnexus.com.tw/webapp/`
  - `https://ats-en.talentnexus.com.tw/webapp/`
- Legacy HTTP 5679／5678 暫時仍存在。
- SQL Server：Microsoft SQL Server 2008 R2 series，database `HiBole-2`。
- Candidate master：`dbo.ZPResumeInfo`。
- Candidate primary key：`ZPResumeInfo.ID int IDENTITY`。
- Verified deployment scope：`pinpin-prod`。
- Durable external identity tuple：`source_system=pinpin` + `source_instance=pinpin-prod` + `external_candidate_id=ZPResumeInfo.ID`。
- Rating：usable/verified with caveats；restore、reseed、future instance、merge 仍需避免跨 scope 假設。

### 5.2 Read-only adapter

- Dedicated SQL credential：`tn_pinpin_ro`。
- Transport：`msnodesqlv8` + Windows local Shared Memory／LPC。
- Object-level read only：candidate、work、education、delete tombstone、notes 等已核准表。
- Attachment table僅 column-level metadata；`Annex`／`Annex1` 明確不可讀。
- TN runtime沒有 Pinpin DML、EXECUTE、schema/server role 權限。
- Routine sync 規則：Pinpin writes = 0、BLOB reads = 0。

### 5.3 Baseline entities

- Candidate：`ZPResumeInfo`。
- Work：`ZPResumeWork`，一人多筆；已驗證 company／title／department／dates／current flag 等 mapping。
- Education：`ZPResumeEdu`，一人多筆；school／degree／major／detail／dates mapping 已驗證。
- Attachment metadata：`ZPResumeInfo_Annex_Other`，document identity 為其 `ID`，candidate relation 為 `ZPResumeInfo_ID`；可保留多版本與 PDF/DOCX/HTML metadata。
- Original documents：SQL BLOB architecture，保留在 Pinpin；TN目前不複製 binary。
- Delete：測試路徑為 soft delete／deactivation；master row 與 attachments 保留，`Active=0` 並有 `zpresumeinfoDel` tombstone。
- Owner mapping：仍 deferred／partial；`CreUser`／`ModifyUser` 已觀察，但 user/consultant join 未完成 controlled verification。
- Source mapping：`CVSource` raw value 可保留，lookup／business semantics 尚未完全驗證。
- Merge／archive distinct semantics：static only／unknown，未做高風險 production mutation。

### 5.4 Incremental reconciliation

- Initial import：GREEN。
- New candidate：identity high-water + periodic reconciliation，YELLOW。
- Core／work／education update：child comparison + partial note/change signal，YELLOW。
- Attachment add：attachment ID／created metadata，GREEN；replacement／preview selection 較弱。
- Delete：tested delete path GREEN。
- Owner：deferred。
- 整體策略：multi-table watermarks + periodic full/scoped reconciliation；不可只依賴 `ZPResumeInfo.RDate`。
- Pinpin child IDs (`ZPResumeWork.ID`, `ZPResumeEdu.ID`) 只當 provenance/matching hints；Pinpin save 可能重發 IDs。TN child UUID 必須用 candidate-local logical matching 保持穩定，ambiguous 時 fail closed。

---

## 6. TN Backend 與 PostgreSQL

### 6.1 Runtime／network

- Backend：TypeScript + Fastify 5 + PostgreSQL + Zod + jose。
- Validated runtime：Node.js 24.18.0；package engine 為 Node >=22。
- Production app：`E:\TalentNexus\tn-api`。
- Protected config：`E:\TalentNexus\config\tn-api.env`、`tn-entra.env`、Pinpin source env；內容不得讀回報告或聊天。
- Startup：Windows Task Scheduler `TalentNexusApi`，least-practical-privilege runtime identity。
- Fastify：`127.0.0.1:3333` only。
- PostgreSQL 17.10：`127.0.0.1:5432` only，database `talentnexus`，runtime role `tn_app`。
- Public edge：IIS site `TalentNexusApiEdge` + URL Rewrite + ARR + Let's Encrypt；HTTP 轉 HTTPS，ACME renewal task 已配置。
- Existing `api.talentnexus.com.tw` Netlify site 未被 TN edge 改動。

### 6.2 API surface

- `GET /health`
- `GET /api/v1/candidates`
- `GET /api/v1/candidates/:idOrCode`
- `GET /internal/data-browser`
- `GET /internal/data-browser/candidates/:identifier`
- `POST /internal/plugin-sidecar/v1/candidate-enrichment`（internal TN bearer）
- `POST /api/v1/plugin-sidecar/candidate-enrichment`（Entra access token + scope）

Internal Data Browser 是 diagnostic surface，不是 recruiter-ready Candidate 360。Token 只在頁面 memory；candidate endpoint 受 bearer 保護。

### 6.3 Entra validation

TN API 使用 tenant-specific OpenID metadata/JWKS，驗證：

- RS256 signature
- issuer
- tenant (`tid`)
- audience（API client-ID GUID）
- expiry／`nbf`
- `ver=2.0`
- delegated `scp` 包含 `TN.Sidecar.Write`

驗證只使用穩定 principal metadata，不以 email／display name 作 authorization。401/403 回應需保持 PII-safe。

---

## 7. Database Schema／Migrations

### Migration 001 — Phase 3 Foundation

- `source_instances`
- `candidates`（UUID PK、legacy TN code、candidate-code sequence）
- `candidate_external_refs`（unique scoped external identity）
- baseline work／education／documents metadata
- tags、owner mapping placeholders
- lifecycle events
- sync runs／cursor／errors／state

### Migration 002 — Enrichment／Provenance

- `candidate_enrichment_snapshots`
- immutable/versioned JSONB snapshot
- idempotency uniqueness and latest/history semantics

### Migration 003 — Candidate Intake Foundation

- 擴充 snapshot provenance：parser、ATS Save、source time、attachment/hash metadata。
- 新增：
  - `candidate_ai_profiles`
  - `candidate_ai_work_experiences`
  - `candidate_ai_educations`
  - `candidate_ai_terms`
  - `candidate_resume_evidence`
  - `candidate_processing_state`

### Identity 與資料線

- TN canonical identity：immutable candidate UUID。
- Recruiter operational identity：verified ATS Candidate ID with scope。
- `TN########`：legacy/debug alias，不得作跨系統 join key。
- ATS baseline、AI interpretation、evidence metadata、processing state 分離。
- Raw snapshots immutable；changed payload 建新 version，identical replay no-op；projection transactionally created。
- Name／email／phone 不得 auto-merge。
- Evidence只存 metadata/reference；沒有 original resume BLOB/BYTEA。

### Production verification

- Migrations 001/002/003 各一次。
- Migration 003 的六張表：12 FK、11 primary/unique、7 checks、17 indexes。
- Projection／evidence／processing orphan counts = 0。
- Scoped external identity duplicates = 0。
- Native PostgreSQL backup／restore drill與 migration 前 backup 均有紀錄；backup coverage 的長期自動化仍應由 operations 確認。

---

## 8. AI／Evidence／Processing 現況

### 8.1 Current live flow

目前 candidate intake 並不是「TN 收到後再呼叫 Gemini」。實際流程是：

1. Connector 捕捉 104／LinkedIn／PDF-DOCX-HTML evidence。
2. Connector 呼叫 `https://api.talentnexus.com.tw/.netlify/functions/resume-ai-parse`。
3. Netlify server-side Gemini 產生 `standard_resume_v1`。
4. Recruiter review 並填入 ATS；使用 original Save。
5. Connector 取得 exact Pinpin Candidate ID。
6. Side-car 將 already-parsed StandardResume 送到 TN。
7. TN targeted read-only refresh baseline，保存 immutable snapshot、AI projection、evidence metadata、processing state。

因此 migration 003 的 `processing_state=completed` 表示現有 intake projection 已完成，不代表 VPS deep-AI worker 已實作。

### 8.2 Netlify AI backend

- Functions：resume、job、company parse，另有 health／PDF workspace。
- Gemini key 僅 server-side env；不可放 Connector、frontend、Git 或 localStorage。
- 模型由 `GEMINI_MODEL` 設定；source default 目前仍見 `gemini-3.5-flash-lite`，實際 production env 本次未讀取／未驗證。
- 支援 mock mode 與 schema validation。
- Stateless、無 TN database。
- 現行 auth README 標示 TEST ONLY／INTERFACE ONLY；需視為 transitional security debt。

### 8.3 TN AI foundation

- TN API 已有 `AiProvider` abstraction、Gemini structured generation、embedding capability、config/redaction/error normalization tests。
- 真實 Gemini connectivity 曾在後續 phase 驗證，但此 handoff 沒有重新發送 candidate data 或呼叫 provider。
- 尚無 production queue／worker／retry orchestration／deterministic extraction pipeline／broad historical processing。
- 原始 evidence 是 ground truth；AI output 是 versioned interpretation，不可成為 candidate identity 或靜默覆寫 ATS。

---

## 9. Tests 與 Production Evidence

### 9.1 現有測試資產

- Connector `working/test`：29 test/spec files，涵蓋 104、LinkedIn public、AI identity、AI Note、PDF、HTML、LINE、ATS adapters、job/company、side-car、recovery、Options。
- Netlify backend：2 test files，涵蓋 backend/schema behavior。
- TN API：13 test files（tests tree total 14 files），涵蓋 migrations、repositories、Pinpin adapter/reconciliation、AI、enrichment、side-car、candidate intake/Data Browser。

本 handoff 是 read-only，不重新跑會產生 cache/build artifacts 的指令；以下結果取自最近 production report：

- Candidate Intake focused tests：8/8 PASS。
- TN API full automated tests：55/55 PASS。
- Migration tests：PASS。
- TypeScript/typecheck/production build：PASS。
- Lint：N/A，service 沒有 lint script/config。

### 9.2 最近期 production E2E

**Existing candidate 43198：PASS**

- exactly one scoped external ref → one TN candidate。
- snapshot count stable；replay repaired missing projections without Gemini／new snapshot／baseline change。
- immediate second replay complete no-op。
- Candidate UUID、TN code、external ref stable。

**Fresh Connector candidate 43219：PASS**

- Connector → original ATS Save → exact ATS ID → Entra TN intake。
- new candidate/ref/document/snapshot 各一。
- profile 1、AI work 5、AI education 2、terms 21、evidence 1、processing 1。
- 兩次 identical replay 均 unchanged；無 duplicate/orphan。
- 最終總量：194 candidates、194 external refs、536 work、137 education、245 documents、17 snapshots。

### 9.3 Regression security evidence

- TN public `/health` = 200。
- Unauthenticated candidate／side-car protected boundaries = 401。
- Chinese／English Pinpin webapp = 200。
- PostgreSQL、IIS、SQL Server running。
- Public 3333／5432／1433 closed。
- Pinpin writes by TN = 0。
- Annex／Annex1／BLOB reads = 0。

---

## 10. Security Invariants

以下是下一位 AI 不得自行放寬的永久邊界：

1. Pinpin／HiBole-2 對 TN 是 read-only；routine sync 不寫 Pinpin、不讀 resume BLOB。
2. TN candidate UUID immutable；跨系統 identity 使用 scoped ATS external tuple。
3. 不以 name、email、phone 自動 merge；source URL 只能用於 recovery evidence，不是最終 identity。
4. Evidence、AI interpretation、ATS presentation／baseline 是不同資料線。
5. AI 可提供 editable preview，但不得 auto-save ATS 或無提示覆蓋 recruiter data。
6. Gemini/API keys、TN token、PostgreSQL credential、Entra token 不得進 frontend、URL、localStorage、Git、report 或 log。
7. Connector 保持輕量；deep parsing／reprocessing 移到 TN VPS worker boundary。
8. PostgreSQL 5432 與 Fastify 3333 必須 localhost-only；任何 IIS／DNS／Entra／firewall／production migration 都需 explicit gate。
9. Original Connector／Pinpin core、existing Save、duplicate、104/LinkedIn/LINE/source metadata 路徑是 regression freeze zones。
10. 任何 background／scheduled sync 在正式核准前不得建立；現況是受控/manual sync model。

---

## 11. Known Issues／Technical Debt

### Critical governance

1. **TN API source 未納入 Git。** `services/tn-api` production code tracked count = 0；若工作機損毀，現有 root Git 無法重建 production。
2. **工作區 ownership 混亂。** Root、nested `working`、unpacked clones、Netlify publish worktree 同時存在 dirty changes。
3. **Release reproducibility 未證明。** `unpacked-ai-test` 與 source 目前一致，但正式 ZIP／SharePoint／GitHub 的唯一 authoritative release link 未在本 handoff 重驗。

### Runtime／packaging

4. TN deployment package 曾漏掉 `msnodesqlv8` native binary；必須顯式保留已驗證 native runtime。
5. Historical snapshots（如 43198）可能沒有 parser version 或 evidence SHA-256；欄位 optional，不可補造。
6. Owner／consultant、CVSource lookup、merge、archive distinct semantics、Pinpin authoritative preview selection 尚未完全驗證。
7. Incremental update detection 不是純 timestamp CDC；需要 multi-table signal + reconciliation。

### AI／product

8. Netlify AI backend auth 仍是 transitional TEST ONLY／shared-token style；長期應遷入正式 TN Entra/worker boundary，但不能一次大爆炸重寫。
9. VPS deep AI processing queue／worker 尚未實作。
10. Original binary evidence archive／object storage 尚未設計；目前只引用 metadata，binary 留在 Pinpin。
11. Internal Data Browser 是診斷工具，不是 recruiter UX，沒有 Candidate 360／search product capability。
12. Broad historical projection backfill、vector search、JD matching、ranking、recruiter agent 均 deferred。
13. Job／Company AI Fill 已在 Connector source，但 Job／Company TN database 明確不在目前 candidate roadmap scope。

### Documentation drift

- `CHANGELOG.md`、`services/tn-api/README.md`、`ai-page-netlify/README.md` 與部分早期 phase sections 保留當時的「未部署／未驗證」描述。
- 同一 report 可能先記錄 blocked，再於後段 append authoritative completion；閱讀時應以最新 completion section、production E2E report、current source 為準。
- 少數 docs 有 mojibake；不能因顯示亂碼就推定 code/data contract 失效。

---

## 12. Current Phase／Readiness

### 已完成並可視為 production baseline

- Phase 3 Backend Foundation。
- Phase 4 Pinpin read-only import／reconciliation／manual production sync foundation。
- Phase 6A AI provider foundation + enrichment/provenance contract。
- Phase 6B.1 side-car backend intake。
- Phase 6B.2A public HTTPS edge + Entra API token validation。
- Phase 6B.2B Connector Entra side-car rollout與 fresh E2E。
- Candidate Intake Foundation migration 003 + Data Browser + production E2E。

### 現在可規劃、但尚未實作

**Candidate Evidence & AI Processing Foundation**：

- controlled evidence references／hash contract；
- deterministic extraction boundary；
- VPS processing queue／worker；
- parser/model/version provenance；
- safe retry、replay、reprocessing；
- failure／dead-letter／operator review；
- 不讀 Pinpin BLOB 的 evidence acquisition策略；
- historical snapshot backfill 的 explicit gated design。

### 後續順序

1. Git/source ownership stabilization（不改 production semantics）。
2. Candidate Evidence & AI Processing Foundation。
3. Recruiter-facing Talent Search／Candidate 360。
4. 再評估 embeddings/vector、JD matching/ranking、recruiter agent。

### 明確 deferred

- Job／Company TN database。
- Native ATS replacement。
- automatic Pinpin write-back。
- original resume binary archive。
- scheduled sync（需新 gate）。
- broad historical AI backfill。
- Candidate-to-job matching、ranking、outcome intelligence。
- Phase 5/6 以外任何未經重新核准的 infrastructure mutation。

---

## 13. Recommended Next-Agent Startup Checklist

下一位 AI 開始前必須：

1. 先讀本檔、`AGENTS.md`、`docs/architecture/DECISIONS.md`、`docs/architecture/CANDIDATE_INTAKE_FOUNDATION.md`、`docs/reports/TN_CANDIDATE_INTAKE_PRODUCTION_E2E_REPORT.md`。
2. 重新執行 read-only `git status`（root、`working`、`_backend_publish_worktree`），列出 exact changed scope。
3. 不假設 root HEAD 包含 TN API；先處理 Git ownership proposal，未經同意不 commit／push。
4. 如果工作涉及 Connector，以 `working/` 為 source、`unpacked-ai-test/` 為實際載入驗證對象；改 source → focused tests → build/package → unpacked parity，不能只改 artifact。
5. 如果工作涉及 production，先確認 explicit phase gate、backup／rollback、secret boundary、localhost bindings 與 Pinpin no-write/no-BLOB invariants。
6. 使用 synthetic／explicitly authorized candidate 做 controlled E2E；不輸出 PII／resume content。
7. 不因舊 README 說「未部署」而重裝 PostgreSQL、重建 DB 或重做 Entra/IIS。
8. 不因目前 `processing_state` 存在就假設 deep AI worker 已經完成。

---

## 14. Authoritative References

按接手優先級：

1. `docs/reports/TN_CANDIDATE_INTAKE_PRODUCTION_E2E_REPORT.md`
2. `docs/architecture/DECISIONS.md`
3. `docs/architecture/CANDIDATE_INTAKE_FOUNDATION.md`
4. `docs/roadmap/TN_MASTER_ROADMAP.md`
5. `services/tn-api/src/` 與 `services/tn-api/migrations/001..003`
6. `working/manifest.json`、`working/js/versions/v1/sites/tnai.js`、`tn-sidecar.js`、`tn-sidecar-recovery.js`
7. `docs/TN_PHASE6B2B_CONNECTOR_ROLLOUT.md`
8. `docs/TN_ENTRA_API_AUTH.md`
9. `docs/TN_PUBLIC_DOMAIN_EDGE.md`
10. `docs/PINPIN_CONTRACT_MAPPING_VERIFICATION.md`
11. `docs/TN_PHASE4_PINPIN_SYNC_REPORT.md`（注意 append-only phase history）
12. `docs/PLUGIN_BASELINE_AUDIT_5000.0.114.md`（架構基線，不代表 5000.0.115 全部現況）

---

## 15. Final Handoff Status

**Repository understanding：COMPLETE**  
**Production candidate intake：PASS**  
**Identity contract：PASS WITH DOCUMENTED CAVEATS**  
**Pinpin read-only／no-BLOB boundary：PASS**  
**Connector Entra side-car fresh E2E：PASS**  
**Candidate Evidence & AI Processing Foundation：NOT YET IMPLEMENTED**  
**Talent Search／Candidate 360：NOT YET IMPLEMENTED**  
**Git/source governance：HIGH-PRIORITY FOLLOW-UP**

本文件只記錄狀態與下一步，不授權 deployment、migration、scheduled sync、Connector release、Pinpin mutation、Entra/IIS/DNS 變更或任何後續 phase 自動開始。
