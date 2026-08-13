# Talent Nexus Plugin Side-car Backend Intake

> Candidate Intake Foundation update (2026-08-13): the existing
> `plugin_sidecar_intake_v1` route is the single logical candidate intake.
> Its contract is backward compatible and accepts optional parser, ATS Save,
> source timestamp and attachment/hash metadata. After exact scoped ATS
> identity resolution, one transaction stores the immutable raw snapshot,
> normalized AI projection, evidence metadata and processing state. No second
> Gemini call is made and no legacy ATS write or resume BLOB read is introduced.

> Phase 6B.2B update (2026-08-12): the public Entra-protected route now uses
> a targeted, read-only Pinpin baseline refresh before the existing enrichment
> intake. Connector OAuth/PKCE and post-original-Save dispatch are documented
> in `docs/TN_PHASE6B2B_CONNECTOR_ROLLOUT.md`. The internal route's existing
> TN-bearer contract is unchanged.

## Phase 6B.1 狀態與邊界

本階段只實作 TN 後端、localhost-only 的接收端：

```text
Plugin
  -> Pinpin Save 成功
  -> 取得 Pinpin Candidate ID
  -> TN Side-car intake
  -> 精確 external reference
  -> versioned enrichment snapshot
```

**Backend intake = IMPLEMENTED**。

- Plugin sender：**NOT IMPLEMENTED**
- Public HTTPS：**NOT IMPLEMENTED**
- `tn-api.talentnexus.com.tw`：**NOT CONFIGURED**
- IIS reverse proxy：**NOT CONFIGURED**
- Browser authentication：**NOT IMPLEMENTED；公開前必須另行設計與批准**
- Gemini processing：**NOT USED**
- Candidate Search：**NOT IMPLEMENTED**

TN API 維持 `127.0.0.1:3333`；本階段沒有 DNS、SSL、IIS、Firewall 或 Plugin 修改。

## Intake Contract

Schema：`services/tn-api/src/domain/plugin-sidecar-intake.ts`。

`PluginSidecarIntakeV1` 的根欄位為：

- `contractVersion: "plugin_sidecar_intake_v1"`
- `candidateRef`: `sourceSystem`、`sourceInstance`、`externalCandidateId`
- `source`: source kind/system/reference/URL/capture time
- `plugin.version`、`ai.provider`、`ai.model`、`correlationId`
- `resume`: 既有 `StandardResumeV1`

目前只接受 Pinpin 精確身分：`pinpin` + `pinpin-prod` + 文字化
`ZPResumeInfo.ID`。不接受姓名、電話、email、LinkedIn URL 或 104 code 作為身分；
不做 fuzzy match、candidate auto-create、external-ref auto-create 或 merge。

## Endpoint 與 Authentication

`POST /internal/plugin-sidecar/v1/candidate-enrichment`

此 endpoint 重用既有 TN API bearer-token 驗證。這是現階段的 localhost internal
control，而不是 Plugin 的瀏覽器認證設計；Plugin 沒有也不應取得此 token。未來若要
透過公開 HTTPS 讓 Plugin 發送，必須先完成並批准 Phase 6B.2 的 browser/edge
authentication design。

## Result / Error Contract

成功只回傳 PII-safe metadata：`status`、TN candidate UUID、snapshot UUID、schema
version、correlation ID。新 snapshot 為 HTTP 201，exact replay 為 HTTP 200。

- 400 `SIDECAR_INVALID_PAYLOAD`
- 404 `SIDECAR_CANDIDATE_NOT_FOUND`
- 409 `SIDECAR_IDENTITY_CONFLICT`
- 500 `SIDECAR_INTERNAL_ERROR`

錯誤不回傳資料庫細節、stack trace、姓名、聯絡資料或履歷 payload。

## Persistence / Safety

Route 使用 `PluginSidecarIntakeService` 解析既有
`candidate_external_refs` + `source_instances`，然後重用
`CandidateEnrichmentService`。因此 exact replay 仍由既有 payload fingerprint 與
stable provenance 決定；`correlationId` 改變本身不會建立新 snapshot。

唯一允許寫入的表是 `candidate_enrichment_snapshots`。本流程不修改 TN baseline、
candidate identity/code、external refs、work、education、documents、lifecycle、notes
或 owner；也不連線／寫入 Pinpin，不讀取 Annex、Annex1 或任何 BLOB，不呼叫 Gemini。

Operational logs 僅允許 request ID、route、side-car error code、candidate/snapshot UUID、
schema、結果與有限 fingerprint metadata；不得記錄 request payload 或 PII。

## 可讀的受控驗證執行方式

受控驗證程式為已納入專案的
`services/tn-api/src/services/plugin-sidecar-controlled-verify.ts`。它編譯為
`dist/services/plugin-sidecar-controlled-verify.js`，自行讀取既有受保護的 TN
runtime configuration，且只輸出 sanitized aggregate result。

在 VPS 上應透過既有 SSH 直接執行 Node 檔案；不得使用 PowerShell
`-EncodedCommand`、Base64-encoded command 或將任何 secret 放到命令列：

```powershell
ssh -i "C:\Users\William Wang\.ssh\id_ed25519" Administrator@103.144.32.63 "\"C:\Program Files\nodejs\node.exe\" \"E:\TalentNexus\tn-api\dist\services\plugin-sidecar-controlled-verify.js\""
```

此 verifier 只對現有 synthetic mapping `43184` 送出 synthetic evidence 至
`127.0.0.1:3333`，並檢查 idempotency、latest/history 與 baseline counts；不連線
Pinpin、不讀取 BLOB，且不輸出 PII。

首次執行應產生 A/B 兩個 synthetic snapshot；後續可安全重跑，兩筆已存在 evidence
均回覆 `unchanged`，不會重複新增資料。
