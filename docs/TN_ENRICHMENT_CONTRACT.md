# Talent Nexus Enrichment / Provenance Contract

> Candidate Intake Foundation update (2026-08-13): `candidate_enrichment_snapshots`
> remains the immutable raw `standard_resume_v1` record. A newly created
> snapshot now transactionally produces snapshot-scoped AI profile, work,
> education and term projections, thin resume evidence metadata, and the
> candidate's current processing-state pointer. Identical retries reuse the
> original snapshot and create no projection duplicates. ATS baseline tables
> remain a separate source-owned data line.

## 目的與邊界

本文件定義 Phase 6A.2 的加值履歷資料合約。它是既有 Pinpin baseline
同步資料之外的獨立、版本化證據層；不會覆寫 Pinpin 候選人、外部身分、工作、
學歷、附件、生命週期、備註、owner 或 TN code。

目前資料分層如下：

1. **Pinpin baseline**：已驗證來源同步的現況資料。
2. **Enrichment evidence**：含來源與模型脈絡的不可變 snapshot。
3. **Canonical Profile**：未實作；未來才可由受控產品流程從多份 evidence
   產生可審核的整合觀點。

本 Phase 不做候選人合併、身分解析、搜尋、向量、embedding、公開 API、排程或
Plugin Side-car。

## Standard Resume V1

程式定義：`services/tn-api/src/domain/standard-resume.ts`。

根欄位固定為 `schemaVersion: "standard_resume_v1"`，並保留未知的結構化欄位，
以支援未來相容性。已知欄位群組：

- 基本資料：candidate name、englishName、phone、email、location、
  expectedLocation、linkedin。
- 現職：current employment company/title。
- 工作經歷：company、title、start、end、current、department、location、
  description。
- 學歷：school、degree、major、start、end。
- 能力：skills、languages、languageDetails、certifications、
  projectExperience。
- 敘事／招募意見：jobPreferences、summary、targetRoles、
  recruiterSummary、coreKeywords、legacySearchNote。

所有未知、缺漏或沒有證據的資料可為 null 或省略。服務不會翻譯、補造、正規化
taxonomy，亦不會從姓名、電話或 email 推論任何身分。

## Provenance 與快照

資料表為 `candidate_enrichment_snapshots`。每筆資料必須有 TN 候選人 UUID、
schema version、source kind，以及可選的 source system/reference/URL、
captured time、Plugin version、AI provider/model 與 correlation ID。

`payload` 以 JSONB 保存原始驗證後 Structured Resume；`payload_fingerprint`
記錄穩定 SHA-256 指紋。相同候選人、schema、payload 與穩定 provenance 的重播
使用唯一 idempotency key，回傳既有 snapshot，而不另建歷史資料。

有效內容或 stable provenance 改變時建立新 snapshot，並以 `supersedes_id` 指向
當時最新 snapshot。`getLatestCandidateEnrichment` 以 `created_at DESC, id DESC`
取得最新版本；歷史資料保留。

審計輸出只含 UUID、schema、source kind、結果、correlation ID 與指紋前綴，
不得記錄 JSON payload、候選人 PII 或模型輸入。

## 身分與來源限制

- `104` durable identity：**UNVERIFIED**；本 Phase 不提升為 TN external ref。
- LinkedIn external identity promotion：**NOT IMPLEMENTED**。
- Candidate identity merge/resolution：**NOT IMPLEMENTED**。
- Pinpin external ref、TN candidate code 與 baseline child rows：不可由 enrichment
  服務變更。

## 明確未實作項目

- Canonical Profile：**NOT IMPLEMENTED**。
- Plugin Side-car：**NOT IMPLEMENTED**。
- Gemini enrichment 呼叫：**NOT IMPLEMENTED**。
- Candidate Search、embeddings、pgvector/vector index：**NOT IMPLEMENTED**。
- 公開 HTTP enrichment endpoint：**NOT IMPLEMENTED**。

Gemini provider 基礎仍維持 optional、server-side only，且與本 enrichment snapshot
服務隔離；Phase 6A.2 不會讀取 AI secret 或送出任何候選人資料給模型。

## 受控驗證

`npm run enrichment:verify-synthetic` 只對既有 synthetic fixture 的 TN 對應候選人
進行 TN-only 測試：建立一次 synthetic snapshot、精確重播一次、再以改變 payload
建立新版，並檢查 latest/history 與 baseline counts 不變。它不連線 Pinpin、不讀取
Annex/Annex1/BLOB，也不使用 Gemini。
