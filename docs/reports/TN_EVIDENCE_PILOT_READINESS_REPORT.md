# TN Evidence Pilot Readiness — Offline Read-Only Planner

Date: 2026-08-21 (Asia/Taipei)

## Result

`IMPLEMENTED — PLANNER DEPLOYED — PRODUCTION PILOT NOT RUN`

為了讓下一階段可以在沒有顧問操作瀏覽器的時段先完成準備，TN backend 新增一個只讀的 Historical Evidence Pilot planner。它不連接 Pinpin、不讀履歷內容或 BLOB、不呼叫 Gemini、不寫 TN/ATS，也不會自動重試或建立候選人。

## What the planner verifies

`HistoricalEvidencePilotService.dryRun()` 只使用 metadata：

- exact scoped identity: `pinpin / pinpin-prod / numeric ATS Candidate ID`；多重或非數字 identity 直接 fail closed；
- content-backed evidence：唯一一筆 `processing_eligible`、支援的 representation、SHA-256 `content_sha256` / `evidence_fingerprint` / `evidence_identity_key`；
- deterministic source reference：`source_reference`、`source_url` 或 `attachment_reference` 至少一項；
- extraction metadata：同一 evidence、extractor、representation、SHA 且 `available`、character count > 0；
- processing state：queued/processing/retry 會標為 `processing_pending`，failed/dead-letter 或 needs-review 不會進 cohort；
- snapshot schema metadata and sanitized processing status；
- duplicate groups for evidence identity, extraction identity, processing idempotency and snapshot idempotency。

Planner 不選姓名、Email、電話，也不讀 `payload`、`normalized_text`、附件內容或 token。cohort 以 ATS ID 數字排序，最多 10 人，確保重跑順序穩定。

## Commands

在本機 build 後可用：

```text
npm run build
npm run processing:evidence-pilot-dry-run
```

CLI 只輸出 observed/eligible/selected、ATS ID、原因統計、duplicate group 數與 `secondRunNoOp: not_run`。它不會對 production 執行任何寫入；執行 production dry-run 仍需沿用既有受控連線與安全 gate。

## Verification

- TypeScript build: PASS
- TN test suite: 98/98 PASS
- New focused fixtures: deterministic selection, pending/metadata-only fail-closed, ten-candidate cap
- New service is not wired to a write route and no migration was added
- No Pinpin writes, BLOB reads, Gemini calls or Connector release performed

## Production deployment verification (2026-08-21)

The read-only planner was deployed through the reviewed TN API release procedure.
The release archive SHA-256 was verified before replacement and the prior TN
runtime was retained under the deployment backup directory. Post-deployment:

- TN API health: PASS (`database=connected`)
- `TalentNexusApi` task: Running
- listener: `127.0.0.1:3333` only
- TypeScript build: PASS
- TN test suite: `98/98 PASS`
- release archive contained no secrets, environment files or private keys

The first deployed aggregate planner run returned only sanitized metadata:

- observed: `268`
- eligible: `7`
- selected: `7` (ATS IDs were recorded only in the operator output)
- duplicate groups: `0`
- processing pending/failed/needs-review: `0`
- `secondRunNoOp`: `not_run`

This identifies a bounded candidate cohort; it does not process the cohort,
invoke Gemini, or prove a replay no-op.

## Autonomous post-deploy preflight (2026-08-22)

在無需瀏覽器或顧問操作的情況下完成額外唯讀檢查：

- deployment backup directory: present
- deployed pilot CLI: present
- `/health`: PASS，database connected
- unauthenticated `/api/v1/candidates`: correctly rejected with `UNAUTHORIZED`
- planner repeated selection: stable across two runs
- Pinpin writes: 0
- BLOB reads: 0
- Gemini calls: 0

此 preflight 只確認 release、認證邊界與 cohort metadata readiness；沒有
把 planner 的重跑誤標示為 Evidence processing 的 second-run no-op。

## Interpretation

這個工具完成的是「可安全選 cohort 與檢查證據契約」的自動化準備，不等於 Historical Evidence Pilot 已在 production 完成。`secondRunNoOp` 仍標記為 `not_run`，因為真正的 processing/replay gate 必須在已批准的 5–10 筆 content-backed evidence 上執行，且要保留 source-to-profile review 的人工閘門。

## Next safe gate

Planner 已部署且目前找到 `7` 筆 content-backed eligible metadata cohort。下一步仍需另外核准「5–7 筆受控 Evidence processing」與第二輪 no-op 驗證；本次沒有執行 processing、Gemini、TN candidate write 或 full backfill。不要把 metadata-only legacy rows 升格，也不要啟動 20–50 或全量 backfill。

## Authorized 7-person Evidence Pilot (2026-08-22)

本次已取得明確授權，執行固定 7 人 cohort 的 production Evidence Pilot；只使用既有 TN evidence / processing records，Pinpin 維持 read-only，沒有瀏覽器互動、ATS Save、Pinpin write、BLOB read 或候選人資料匯出。cohort 由 planner 依既有 deterministic ATS ID 順序選出（43083、43222、43223、43245、43258、43262、43264）；未擴大範圍。

### 首次執行發現與修復

首次受控執行在 43083 安全停止，錯誤為 `EVIDENCE_NOT_ELIGIBLE`。根因是舊版 `enqueueByIdentifier` 建立 `process_new_evidence` job 時沒有帶入對應的 `candidate_evidence_extractions.id`。另外，43222 顯示較新的 snapshot 沒有 evidence 時，舊選擇器會遮蔽仍可用的 content-backed evidence。兩項修復均為 TN 內部最小變更：

1. 排程 `process_new_evidence` 時以 candidate/evidence/hash/extractor/representation/status 精確解析 extraction identity。
2. retry 對舊 job 只在唯一匹配 extraction 存在時補回 `extraction_id`；ambiguity 或缺失仍 fail closed。
3. 非 `rebuild_projection` 僅從完整、可處理的 content-backed evidence 選取，避免無 evidence 的較新 snapshot 阻擋合法 evidence。

新增 focused regressions 後，TN suite 為 **101/101 PASS**，TypeScript build 為 PASS。最後部署 archive：

`tn-api-controlled-pinpin-blob-0604e0e-20260822011159.zip`

SHA-256：`24D8B5C649569593C116F49ABF26E5E96283D026941C78032FD4D50B8621D316`

部署備份：`E:\TalentNexus\backup-20260822011220`

API 與 processing worker 均已重新載入相同 release；未變更 Pinpin、IIS、SQL Server、Chrome Connector 或資料庫 schema。

### Pilot result

- selected: `7`
- first run: `created=0`, `unchanged=7`, `completed=7`
- second run（無任何 source 變更）: `unchanged=7`
- duplicate external refs/evidence/extractions/processing/snapshots: `0`
- orphan evidence/jobs: `0`
- 7 筆的 processing status: `completed`；output snapshot 存在
- 43083 的原始失敗 job 以同一 job identity 修復後完成，沒有新增候選或重複 evidence
- Gemini 呼叫次數：`not independently observable from metadata`；本報告不宣稱 0，也沒有重新觸發 Gemini 以外的額外 replay
- Pinpin writes: `0`
- Pinpin BLOB reads: `0`

### Post-pilot runtime regression

- public TN `/health`: HTTP 200
- unauthenticated `/api/v1/candidates`: HTTP 401
- Pinpin Chinese `/webapp/`: HTTP 200
- Pinpin English `/webapp/`: HTTP 200
- `TalentNexusApi`: Running；`TalentNexusProcessingWorker`: Running
- TN API listener: `127.0.0.1:3333` only
- PostgreSQL listener: `127.0.0.1:5432` only
- public SQL Server port 1433 listener: none observed

### Gate interpretation

固定 7 人 Evidence Pilot 已完成，且第二輪為完整 no-op；這證明目前 content-backed evidence → processing → snapshot 的受控 pipeline 可重跑且不產生 duplicate/orphan。這不是 Historical Backfill，也沒有啟動更大批次。下一個 gate 應是對 pilot 結果做 review，再另行批准 20–50 或全量處理；在該批准前不建立 scheduled bulk processing。

## Post-pilot next-gate dry-run (2026-08-22)

Pilot review 後再次執行唯讀 planner 與 full backfill dry-run：

- evidence planner: observed `268`、eligible `7`、selected `7`、duplicate groups `0`；processing pending/failed/needs-review `0`。
- full baseline dry-run: eligible `0`；原因為 `already_current=48`、`no_snapshot=194`、`no_evidence=11`、`ambiguous_evidence=7`、`soft_deleted=8`。
- 目前仍沒有足夠的 content-backed evidence 支持 20–50 批次；不會以 metadata-only rows 代替履歷內容。

因此下一個可執行階段是透過既有 Browser Evidence Bridge（或另行核准的安全 resolver）擴充 evidence coverage，再重新執行 planner。這一輪沒有新增 TN processing job、沒有呼叫 Gemini、沒有修改 Pinpin，也沒有建立排程。

## Connector readiness audit (2026-08-22)

唯讀檢查目前 `working` Connector source 與 `dist/chrome-extension/unpacked-ai-test`
後，確認兩者的 Evidence Refresh、背景 source-session bridge 與 manifest
檔案雜湊一致。Existing Candidate 路徑已具備：精確 numeric ATS ID 解析、
`candidate-evidence/request` metadata request、authenticated ATS
`/rest/file/preview/CVxxxx` capture、`candidate_evidence_intake_v1` submit、
candidate/session freeze 與 no-save 邊界。非 jsdom 可執行的 7 個 Connector
focused specs 全部 PASS，source syntax check PASS；完整 jsdom specs 本機未執行，
因目前 workspace 沒有安裝 `jsdom`，未自行新增依賴。

因此目前不是缺少 backend route 或 Connector wiring；真正剩餘 gate 是由已登入
ATS 瀏覽器擴充新的 content-backed evidence cohort。正式 Connector package
仍不在本次 backend pilot gate 內，也未建立新的 release ZIP。

## Latest read-only coverage check (2026-08-22)

在 Job Context 搜尋品質部署後重新執行既有 planner；本次仍為 metadata-only、
read-only，沒有建立 processing job、呼叫 Gemini、讀取 Pinpin BLOB 或寫入資料：

- observed: `297`
- content-backed eligible: `17`
- deterministic selected cohort: `10`
- duplicate groups: `0`
- processing pending/failed/needs-review: `0`
- second-run no-op: `not_run`

資料已達到受控 10 人 Evidence processing pilot 的選 cohort 門檻，但該 pilot
仍需另外的明確批次寫入授權；授權前不會執行 queue、worker、Gemini 或全量
Historical Backfill。

## Authorized 10-candidate Evidence Pilot (2026-08-22)

本次取得明確 10 人批次授權後，沿用既有受控 runner 執行。只針對 planner
選出的 exact scoped Pinpin identities 建立既有 `process_new_evidence` job，
沒有讀取履歷內容、Pinpin BLOB 或輸出候選人 PII。

- selected: `10`
- first run: `created=9`, `unchanged=1`, `completed=10`
- second run（無 source 變更）: `unchanged=10`
- duplicate external refs/evidence/extractions/processing/snapshots: `0`
- orphan evidence/jobs: `0`
- Pinpin writes: `0`
- Pinpin BLOB reads: `0`
- Gemini call count: not independently observable from metadata

這證明 10 人 cohort 在現有 content-backed Evidence → processing → snapshot
管線中可完成且可重跑為 no-op；不代表已批准 20–50 或全量 Historical
Backfill。

## Authorized next-batch gate check (2026-08-22)

收到下一個受控批次授權後，先執行唯讀 planner，未直接建立 processing job。
最新結果為 observed `297`、content-backed eligible `17`、deterministic
selected `10`、duplicate groups `0`，且 pending/failed/needs-review 皆為 `0`。

因此目前尚未達到最小 20 人批次的資料門檻；本輪沒有新增 TN processing job、
沒有呼叫 Gemini、沒有 Pinpin writes，也沒有 Pinpin BLOB reads。必須先透過
既有 Browser Evidence Bridge（或另行核准的安全 resolver）擴充至少 3 筆
content-backed evidence，才能重新評估 20 人批次；20–50 批次與 full backfill
仍維持關閉。

## Authorized 20-candidate Evidence Pilot (2026-08-22)

新增批次 planner 上限的最小相容性修正後，重新執行測試與 production deploy。
部署 archive 為 `tn-api-controlled-pinpin-blob-0604e0e-20260822201525.zip`，
SHA-256 為 `287BC3459292397358FFBE8E2D0D545F8F933620951E8DA69D6814D27C1A0744`；
health 與 `TalentNexusApi` task 驗證通過。

- selected: `20`
- first run: `created=5`、`unchanged=15`、`completed=20`
- second run（無 source 變更）: `unchanged=20`
- duplicate external refs/evidence/extractions/processing/snapshots: `0`
- orphan evidence/jobs: `0`
- Pinpin writes: `0`
- Pinpin BLOB reads: `0`
- Gemini call count: not independently observable from metadata

20 人受控批次與第二輪 no-op 驗證 PASS；這仍不等於核准全量 Historical
Backfill 或建立 scheduled bulk worker。

## Pinpin metadata resolver runtime hotfix (2026-08-22)

Existing Candidate repair 觀察到 `Auth: authenticated` 但 `TN_HTTP_500`，同時
AI Fill panel 回報 `pinpin-metadata-unavailable`。只讀 runtime audit 確認
production `TalentNexusApi` 的 `msnodesqlv8` 套件目錄存在，但缺少其已驗證的
Node.js 24.18.0 native binary：`build/Release/sqlserver.node`。因此 Pinpin
Shared Memory/LPC metadata resolver 在第一次載入 native driver 時失敗；這
不是 Entra 認證失敗，也沒有讀取 Pinpin BLOB。

已完成最小 runtime-only 修復：從本機 Node.js 24.18.0、`msnodesqlv8` 5.2.3
已驗證 build 補入該 binary，production 檔案 SHA-256 為
`0BCCDA17898C67E86241FA6C9EA11BFB06A0B79B5AD6A917D1926BDF914E7693`；檔案 ACL
保留 `LOCAL SERVICE` read/execute。未修改 source、Pinpin、SQL Server、IIS、
TN schema 或 secrets。`TalentNexusApi` 已重啟並回報 Running；health=200，
3333/5432 仍只監聽 127.0.0.1，1433 無 listener。Administrator context
下的 read-only source adapter connect/read metadata smoke 已 PASS；尚待已登入
Connector 重新執行一次 Existing Candidate flow 以確認同一 runtime identity
下的 end-to-end metadata request。
