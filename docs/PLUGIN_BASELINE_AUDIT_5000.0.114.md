# Talent Nexus Connector — Phase 1A Golden Baseline / Architecture / Pinpin Core Audit

> 稽核日期：2026-08-11  
> 稽核範圍：目前 checkout 及其巢狀 `working/` Git repository 的可讀取程式碼與 Git history。  
> 稽核方式：read-only。除本文件外，未修改 production source、manifest、測試、設定、相依套件、Git history 或部署。  
> 資料保護：本文件不記載任何候選人個資、cookie、token、session ID、Authorization 值或 API key。

## 1. Executive Summary

目前的 Connector 是以 Pinpin Chrome extension 為操作核心、疊加 Talent Nexus 模組的 MV3 extension。核心 Pinpin 流程仍為：來源網站擷取履歷 HTML／檔案 → Pinpin `/rest/file/...` 解析或暫存 → extension 的 `New Talent` Angular form → 原始 Pinpin `POST /rest/resume/addbyplug` 儲存。Talent Nexus 的 104、Public LinkedIn、PDF Workspace、ATS AI Fill 與 Gemini AI Fill 都是附加模組；它們有些直接重用原 Pinpin message type，有些另走 Talent Nexus HTTPS backend。

最重要結論如下：

- **Pinpin Candidate ID：條件式可取得。** 新建成功時，`request.api.submit` 的成功回應 `response.data` 被直接當作 candidate ID；重複候選人流程則以 `/rest/candidate/listforcrx` 回傳的 `item.id` 使用。此結論由 extension source 證實；Pinpin server 是否在所有錯誤／邊界回應中一致提供 ID，需 VPS／API 實測確認。
- **Candidate URL：由 extension 組合。** 程式在多處以 `Config.api + '/webapp/#/nav/candidate/detail?id=' + id` 組出詳細頁，並非由回應提供完整 URL。
- **New 與 Duplicate 都可看到 identity，但暴露時點不同。** New 在 `/rest/resume/addbyplug` 成功回應；Duplicate 先由重複檢查回傳 `idlist`，再查 `/rest/candidate/listforcrx` 取得 `item.id`。若重複檢查或後續查詢失敗，identity 不會被 extension 補猜。
- **重複提示偶發的最可能原因** 是 auto path 的 2 秒初始化、來源特定的 click／iframe／SPA 延遲、`checkFlag` 對 UI 回應的抑制，以及只有 `response.status` 為真時才顯示 UI；不同的 `htmlfileauto2/3/4` endpoint 也有不同觸發條件。詳見第 8–9 節。
- **原始履歷檔不一定可取得。** 104、LinkedIn 主要傳送組裝後 HTML；PDF Workspace 以本機抽取的文字產生 HTML 後傳送。只有既有 `request.api.addResume.upload` 分支會取得遠端 Blob 並以 multipart 上傳。Pinpin 是否保存原檔、附件 ID 或可供外部引用的 stable resume ID，**UNKNOWN / REQUIRES VERIFICATION**。
- 未來 Talent Nexus integration 必須是 **side-car / non-blocking**。最安全的候選事件點是 Pinpin 成功儲存或成功取得 duplicate candidate identity 之後；不得放在 duplicate check、HTML upload、Pinpin Save 的關鍵路徑前方或中間。

本次不設計資料庫、不實作 API、不改插件。

## 2. Current Version / Repository Baseline

| 項目 | 結果 |
|---|---|
| 外層 repository branch | `master` |
| 巢狀 extension repository | `working/`，branch `feature/ai-resume-review` |
| 目前 manifest | `working/manifest.json` |
| Manifest version | `3` |
| `version` | `5000.0.114` |
| `version_name` | `5000.0.114 ATS Job AI Fill POC` |
| 使用者指定 golden / production package | `talent-nexus-connector-5000.0.114-ats-ai-fill` |
| 已知基線 commit | `36a4a8f baseline stable plugin-5english 5000.0.108` |
| 工作區狀態 | 外層與 `working/` 均已有未提交／未追蹤使用者工作；本稽核未更動它們。 |

`5000.0.114` manifest 的 `homepage_url` 仍為 `http://www.ppinsoft.cn`。此為現況觀察，不代表其是否應保留或更改。

## 3. High-Level Architecture

```text
Recruitment website / PDF workspace / ATS page
        │
        ▼
MV3 Browser Extension
  ├─ content scripts: page detection, HTML/file capture, Pinpin toolbox UI
  ├─ website adapters: 104 / Public LinkedIn / PDF / legacy source branches
  ├─ TN AI modules: TNAI, ATS AI Fill, Job AI Fill
  └─ service worker: background.js message router + Pinpin HTTP requests
        │                                  │
        │                                  ├── Talent Nexus HTTPS backend
        │                                  │     `/.netlify/functions/resume-ai-parse`
        │                                  │             │
        │                                  │             └── Gemini (server-side key)
        ▼                                  ▼
Pinpin APIs
  HTML/file intake → duplicate check → New Talent Angular form → original Save
        │
        ▼
Pinpin candidate ID / constructed candidate detail URL / result UI
```

### 元件清單

| 類別 | 主要檔案／現況 |
|---|---|
| Service worker | `working/background.js`；MV3 `service_worker`。`background1..4.js` 不在 manifest 的 active background 欄位。 |
| 通用 message / storage | `working/js/core/utils.js`，`utils.message`、`utils.store`、`utils.storeAsync`。 |
| 動態來源腳本 | `working/js/page.js` 依 `chrome.storage.sync` 的 `schema` 動態注入；實際 schema 來源／內容 **UNKNOWN / REQUIRES VERIFICATION**。 |
| 主 content script bundle | manifest `content_scripts[0]`：jQuery、Angular、`js/versions/v1/default/page.js`、來源 adapter、TNAI、ATS/Job AI Fill。 |
| Pinpin Toolbox / New Talent UI | `working/versions/v1/default/toolbox.html` + `working/js/versions/v1/default/page.js`。 |
| 104 adapter | `working/js/versions/v1/sites/site104.js`。 |
| Public LinkedIn adapter | `working/js/versions/v1/sites/linkedin-public-pinpin.js`。 |
| PDF / documents | `working/js/versions/v1/sites/tnpdf.js`、`tnpdf-preview.js`、`pdf-import.mjs`、bundled PDF.js、Mammoth。 |
| AI source / notes | `working/js/versions/v1/sites/tnai.js`、`tnai-schema.js`。 |
| ATS resume AI Fill | `tnats-ai-fill.js`、`tnats-standard-resume.js`、`tnats-adapter-zh.js`、`tnats-adapter-en.js`、`tnats-main-bridge.js`。 |
| ATS job AI Fill | `tnjob-*.js`、`tn104-job.js`、`tnjob-main-bridge.js`。 |
| Options | `options.html`、`connector-options.js`；舊 `js/options.js` 亦存在，哪個 UI 為使用者實際入口需以 manifest/options HTML runtime 確認。 |
| Popup / side panel | 沒有 manifest `side_panel`。PDF tab 使用 action popup `pdf-import.html?popup=1`；一般 action click 送 `browserAction` message。 |
| 內部頁面 | `pdf-import.html`、`pdf-workspace.html`（backend public page）、`options.html`、`update.html`。 |

## 4. Pinpin Core vs Talent Nexus Modification Map

來源判定依 Git history、檔名、manifest 差異與程式註解。未能由 history 證明的原始權屬明列 UNKNOWN。

| 區域 | 檔案／主要函式 | Likely ownership | 風險 | 建議 freeze |
|---|---|---|---|---|
| Message router、Pinpin API mapping | `background.js` request map、`doSth()` | MIXED：舊 Pinpin router 上已加入 TNT paths | 極高 | 是 |
| Pinpin New Talent、submit、duplicate UI | `js/versions/v1/default/page.js`: `AddResumeCtrl`、`CheckRepeatCtrl` | PINPIN_CORE（Git baseline pattern 支持） | 極高 | 是 |
| Toolbox markup | `versions/v1/default/toolbox.html` | PINPIN_CORE / MIXED presentation | 高 | 是，僅以 additive mount 擴充 |
| Core utilities / message / sync storage | `js/core/utils.js` | PINPIN_CORE | 極高 | 是 |
| Source-specific legacy extractor branches | `default/page.js` 巨型 URL branch | PINPIN_CORE / MIXED | 高 | 是 |
| 104 safe capture | `sites/site104.js`; page.js 的 leading branch | TALENT_NEXUS | 高（接入 core chain） | 目前凍結；後續僅明確授權變更 |
| Public LinkedIn clean preview | `sites/linkedin-public-pinpin.js` | TALENT_NEXUS | 高（攔截 `utils.message.sendMsg`） | 是 |
| LinkedIn Recruiter / legacy LinkedIn | `default/page.js`、`tnai.js` capture | MIXED | 極高 | 是 |
| AI Note / AI Fill | `tnai.js`、`tnai-schema.js`、backend | TALENT_NEXUS | 中高 | 是，與 Pinpin `AddResumeCtrl` 邊界固定 |
| PDF Workspace / original-file handoff | `tnpdf.js`、`pdf-import.mjs` | TALENT_NEXUS | 高（重用 Pinpin HTML intake） | 是 |
| ATS candidate/job AI Fill | `tnats-*`、`tnjob-*` | TALENT_NEXUS | 中高 | 可作安全擴充區，但不可碰 Pinpin original Save |
| Branding / options | `connector-options.js`、CSS/UI | TALENT_NEXUS | 中 | 相對安全 |

## 5. Supported Website Matrix

| 來源 | Page detection / import | Duplicate path | Talent Nexus 特殊處理 | 狀態 |
|---|---|---|---|---|
| 104 candidate (`vip.104.com.tw`) | `TN104.isResumePage()` / `TN104.addResume()` | `TN104.check()` → legacy `checkRepeat()` | detached clone、opened-card identity guard、remark stripping | 有明確 adapter |
| LinkedIn Public (`/in/<slug>/`) | legacy LinkedIn import 由 Public adapter 攔截 payload | `linkedin.checkRepeat` snapshot → `checkRepeat*` payload replace | canonical URL、semantic resume HTML、hydration/scroll、fail-closed | 有明確 adapter |
| LinkedIn Recruiter (`/talent/profile/`) | legacy LinkedIn branch | legacy `linkedin.checkRepeat` delayed capture | TNAI source capture / cache routing | MIXED |
| PDF | action popup / PDF Workspace | 無來源頁 duplicate special-case；HTML intake 後走 Pinpin normal path | local PDF.js text extraction、HTML wrapper | TALENT_NEXUS |
| DOCX / HTML for ATS Fill | `tnats-ai-fill.js` | 不走 Pinpin duplicate UI；在 ATS 表單內填欄位 | Mammoth / HTML text extraction | TALENT_NEXUS |
| 51job、zhaopin、zhipin、liepin、58、lagou、maimai 等 | `default/page.js` match list / source branches | `checkRepeat()` 及來源特殊事件 | 多為 legacy | PINPIN_CORE / UNKNOWN |

完整 match list 約含 40+ 網域；本 audit 不對每個 legacy selector 做語意正確性驗證。

## 6. Candidate Extraction Architecture

### 104

`site104.js` 的 `capture104Resume()` 依序選用：opened candidate summary card + `.standard-resume-wrapper`、`.standard-resume`、layout `article`、sanitized body fallback。`findOpenCandidateCard()` 優先用 wrapper ID、active state、URL ID 比對，無法確認時省略 summary，避免誤用相鄰卡片。最後呼叫既有 `checkRepeat(html, clickType)` 或 `request.api.addResume.normal`。

### LinkedIn Public

`linkedin-public-pinpin.js` 由 `canonicalProfileUrl()`、`resolveRoot()`、`collectResumeSections()` 組成只含候選證據的 HTML。它攔截既有 `utils.message.sendMsg`：duplicate 時置換 `checkRepeat*` payload；import 時先 hydrate 可見履歷再置換 `request.api.addResume.normal` payload。候選變更、找不到 root、內容過短均 fail closed。

### LinkedIn Recruiter / legacy LinkedIn

legacy branch 在 `default/page.js` 蒐集頁面 head/style、main/profile root、contact modal 和已展開區段，透過 timer / click / `history.back()` 後發出 `request.api.addResume.normal` 或 `checkRepeat()`。TNAI 對 AI capture 另有 source-aware root resolver 與 per-`addFileName` session cache。精確 selector 與 Pinpin parser 吸收方式仍有耦合。

### 通用 legacy sources

`default/page.js` 以網址判斷並各自組 HTML（或少數來源以 image / downloadable file path）。輸出普遍為 `{html:[html], host: Config.api, _id:''}`，由 background router 發送。

## 7. Complete Candidate Import Flow

### 共通 Pinpin import backbone

```text
來源頁面 → content-script capture → request.api.addResume.normal
→ background.js /rest/file/htmlfile
→ request.api.addResume.normal response (temporary addFileName)
→ AddResumeCtrl /rest/file/temp
→ recruiter reviews New Talent
→ request.api.submit → /rest/resume/addbyplug
→ response.data candidate ID → constructed detail URL
```

| Stage | Source / function | Input → output | 條件／錯誤處理 |
|---|---|---|---|
| Page detection | `default/page.js`, `site104.js`, Public LinkedIn adapter | URL + visible DOM → source route | 各來源不同；104/LinkedIn Public 有 fail-closed guard。 |
| Capture | source branch / adapter | visible DOM or file → sanitized/assembled HTML | 多數 legacy branch 假設 DOM selector 可用。 |
| Intake | `background.js` request map / `doSth()` | `request.api.addResume.normal` → `POST /rest/file/htmlfile` | 401-like Pinpin `login required` 有 cookie simulation recovery。 |
| Temporary parse lookup | `AddResumeCtrl` | response `.data.substring(20)` → `addFileName`; then `/rest/file/temp` | 真正 response schema 未在 repository 固定型別定義。 |
| Original form save | `AddResumeCtrl.submit()` | `a.resume` + filename + source URL → `/rest/resume/addbyplug` | `submit()` 是 canonical save。 |
| Result | `request.api.submit` listener | success `response.data` → `resumeInfo.id`; error duplicate text → `candidateId` | 依 `response.status`／message。 |

### 104 差異

`TN104.addResume()` 使用同一 `request.api.addResume.normal` shape；`TN104.check()` 使用同一 `checkRepeat()`。104 HTML 的 candidate summary 若無法確認，會省略而非猜測。104 source resume code 僅在 AI note path 由 `tnai.js:extract104ResumeCode()` 自 captured HTML deterministic 取得；它不是 Pinpin candidate ID。

### LinkedIn Recruiter / Public 差異

兩者最終都落入 legacy `request.api.addResume.normal` / `checkRepeat()` backbone。Public LinkedIn 在 transport 前替換為 clean semantic HTML 並以 canonical `/in/<slug>/` URL 做 duplicate payload URL；Recruiter 保留 legacy capture 形態。Public adapter 的 `importPending` 與 source URL re-check 用於避免 async hydration 時候候選切換。

### Other sources

其餘 sources 終點一致，但 capture HTML、click callback、iframe 及 delay 不同；沒有足夠 source-level evidence 可把它們視為同一可靠度。

## 8. Pinpin Duplicate Check Deep Dive

### Verified endpoints and routes

| Message type | Path | 何時呼叫 | 送出內容 | 回應如何使用 |
|---|---|---|---|---|
| `request.api.checkRepeat` | `/rest/file/htmlfileauto2` | auto check；`checkRepeat(html, '')` | JSON wrapping `{html:[...], url}` | `response.status` 為真且 `checkFlag` 為假才開啟 `check_repeat` UI。 |
| `request.api.checkRepeat2` | `/rest/file/htmlfileauto3` | UI「Check again」；`checkRepeat(html, 'click')` | 同上 | `CheckRepeatCtrl` 重新顯示 normal duplicate mode。 |
| `request.api.checkRepeat3` | `/rest/file/htmlfileauto4` | UI「Similar」；`checkRepeat(html, 'click2')` | 同上 | 顯示 similar mode。 |
| `request.api.getRepeatInfo` | `/rest/candidate/listforcrx` | initial duplicate response `idlist !== '0'` | query `idlist` | `response.list` 成為 `repeatList`；每項使用 `item.id`。 |
| `request.api.saveOrReplace` | `/rest/file/bind_candidatecrxnew` | duplicate result Update / Save as attachment | `resumeMsg` + `candidate_id`, optional `is_replace` | 成功後以選定 `candidate_id` 組詳情 URL。 |
| `request.api.addSaveOrReplace` | `/rest/file/bind_candidatecrx` | New Talent submit 報 duplicate 後 Update / attachment | `candidate_id`, `uuidname`, optional `is_replace` | 成功後以 `candidateId` or newly saved `resumeInfo.id` 組 URL。 |

### Duplicate input

extension 對核心 `checkRepeat()` 統一提供 `html:[capturedHtml]` 與 `url`。因此 extension 明確傳遞的是 **HTML content + source URL**；姓名、電話、email、外部來源 ID 是否由 Pinpin server 從 HTML 解析，或是否另有 server-side identity rule，**UNKNOWN / REQUIRES VERIFICATION**。104 和 Public LinkedIn adapter 都會將其自己的 verified source HTML（Public LinkedIn 另以 canonical URL）塞進同一 payload。

### UI 顯示條件

`CheckRepeatCtrl.getInitData()` 僅在 duplicate response 送入 `browserAction('check_repeat', response)` 後執行。`idlist !== '0'` 才呼叫 `getRepeatInfo` 取得候選清單；`response.status` 不為真時不開啟 UI。故「未看到提示」可代表：未發 request、request 失敗、`status` false、idlist 0、或回應被 `checkFlag` 忽略，不能等同於「一定沒有重複」。

## 9. Why Duplicate Detection Appears Intermittently

以下依程式碼證據排序，並非對 live API 的推測性定論。

1. **高：auto check 的時序與 SPA navigation。** `default/page.js` 有約 2 秒 startup timer；多個來源只在某些 click handler 後以 1–6 秒 delay 再檢查。104 文件亦記載 Vue SPA 候選切換未必重新觸發 initial auto check。這是最直接的 intermittent evidence。
2. **高：`checkFlag` 抑制結果 UI。** `browserAction` 會把 `checkFlag=true`；auto/precise response listeners 都有 `checkFlag || ...` guard。若旗標未如預期清回 false，合法回應也不會顯示 duplicate UI。
3. **高：來源資料／選擇器可用性不同。** 每個網站擷取不同 DOM、iframe 或可見區段。104 在 ambiguous card 時故意移除 summary；Public LinkedIn 在無 verified snapshot 時故意 skip。這些安全行為會降低誤判，但也會導致部分候選沒有 duplicate request。
4. **中高：三個 endpoint 的語意不同。** auto、manual precise、similar 分別呼叫 `htmlfileauto2/3/4`；extension 並未在 client 端統一回應 schema 或 retry。其 backend criteria 是否一致，**UNKNOWN / REQUIRES VERIFICATION**。
5. **中：Pinpin authentication / network error UX 不完整。** background 對 `login required` 嘗試 `/rest/user/loginsimulation`，但一般 fetch failure 主要清 badge／console，不一定在來源頁展示可辨識失敗狀態。session、timeout、CORS、server 500 行為需實測。
6. **中：duplicate result 必須另查 list。** 初始回應只有 `idlist` 時，`/rest/candidate/listforcrx` 再失敗也會使列表不完整或不可見；此第二跳缺少顯式 user-facing recovery。

## 10. Pinpin Candidate ID / Candidate URL Flow

### New candidate

`AddResumeCtrl` 在 `request.api.submit` 回應：

- `response.status === true`：設定 `resumeInfo.id = response.data`。
- Toolbox template 使用 `{{Config.api}}/webapp/#/nav/candidate/detail?id={{resumeInfo.id}}`。
- 因此 source 證實 **new candidate ID 取自 `/rest/resume/addbyplug` 成功回應的 `data`**。

### Duplicate candidate

- `checkRepeat*` 初始 response 提供 `idlist`；當它不為 `'0'`，`CheckRepeatCtrl` 呼叫 `/rest/candidate/listforcrx`。
- `response.list` 的 `item.id` 顯示在模板 detail link，並傳入 `saveOrReplace(item.id, ...)`。
- 若 New Talent submit 回傳 duplicate error，程式以 error `message` text 判斷並設定 `candidateId = response.data`；後續 `addSaveOrReplace` 使用該 ID。

### URL and stability assessment

程式 URL 格式確實是：`{Config.api}/webapp/#/nav/candidate/detail?id={candidateId}`。該 ID 可作未來 Talent Nexus 外部參照的 **候選 integration key candidate**，但不宜在未做 VPS/API contract verification 前宣告為資料庫 primary key。理由：extension 假設 `response.data` / `item.id` 是 Pinpin candidate ID，未有 schema version、uniqueness 保證、soft-delete / merge 行為、tenant boundary 或 API contract 的 repository evidence。

建議未來模型使用 `source_system=pinpin` + `external_candidate_id` + `external_url`，並記錄取得時間與 API endpoint；不是現在實作。

## 11. Candidate Internal Data Models

| Representation | 位置 | 重要欄位／性質 |
|---|---|---|
| Source captured HTML | source adapters / `resumeMsg` | `html:[...]`, `url`；主要是 Pinpin parser input。 |
| Pinpin temporary filename | `AddResumeCtrl.addFileName` | `response.data.substring(20)`；供 `/rest/file/temp`、submit、bind 使用。語意／持久性 **UNKNOWN**。 |
| Pinpin New Talent model | `AddResumeCtrl.resume` | `chineseName`, `mobile`, `email`, `weixin`, `industry`, `function`, `joborder_id`, `folder_id`, `customFolder`, `status`, `tags`, filename, url 等。 |
| Duplicate result item | `CheckRepeatCtrl.repeatList[]` | `id`, `chineseName`, `mobile`, `company.name`, `title`, `owner`, `lastUpdate`, note/highlight metadata。 |
| Standard Resume JSON | `tnai-schema.js` | candidate identity/location/LinkedIn、currentEmployment、experience、education、skills、languages、projects、certifications、summary 與 recruiter fields。 |
| ATS Standard Resume | `tnats-standard-resume.js` | ATS-specific normalized fields；詳情請以 adapter source 為準。 |
| AI run state | `tnai.js` `stateByRun` | run ID、source、resume、error、`addFileName`、capture status；LinkedIn source cache 以 `addFileName` session key。 |

## 12. Candidate Field Matrix by Source

此矩陣表示 extension source 是否可見／傳遞該類資料，非 Pinpin server 最終解析保證。

| FIELD | 104 | LINKEDIN_RECRUITER | LINKEDIN_PUBLIC | OTHER | PINPIN_PAYLOAD | AI_FILL |
|---|---|---|---|---|---|---|
| Name | YES | PARTIAL | YES | PARTIAL | PARTIAL（HTML parser） | YES |
| Phone | PARTIAL（可遮罩） | PARTIAL | PARTIAL | PARTIAL | PARTIAL | YES only when evidence |
| Email | PARTIAL（可遮罩） | PARTIAL | PARTIAL | PARTIAL | PARTIAL | YES only when evidence |
| Current company/title | YES | PARTIAL | YES | PARTIAL | PARTIAL | YES |
| Location | YES | PARTIAL | YES | PARTIAL | PARTIAL | YES |
| Experience | YES | PARTIAL | YES | PARTIAL | HTML only | YES |
| Education | YES | PARTIAL | YES when loaded/visible | PARTIAL | HTML only | YES |
| Skills/languages | YES | PARTIAL | YES when visible | PARTIAL | HTML only | YES |
| Source URL | YES | PARTIAL | YES canonical | PARTIAL | YES (`url`) | PARTIAL |
| Source candidate ID | PARTIAL (104 resume code for Note) | UNKNOWN | LinkedIn slug/URL only | UNKNOWN | UNKNOWN | PARTIAL |
| Document/raw HTML | YES | YES | YES | PARTIAL | YES | YES |
| Pinpin candidate ID | after result | after result | after result | after result | N/A | N/A |
| Pinpin candidate URL | constructed after result | same | same | same | N/A | N/A |

## 13. Resume / Document Lifecycle

| Source | Extension access | What is sent to Pinpin | Known stable ID |
|---|---|---|---|
| 104 / LinkedIn | visible DOM rendered to HTML | `POST /rest/file/htmlfile` with HTML array | source URL; 104 code is source metadata for AI Note, not Pinpin attachment ID |
| Public LinkedIn | semantic evidence HTML, after optional scrolling/hydration | same HTML intake | canonical LinkedIn URL |
| PDF Workspace | browser File/Blob; PDF.js extracts text locally; preview is Base64 to workspace UI | generated readable HTML via `/rest/file/htmlfile` | `addFileName` returned from intake; persistence semantics unknown |
| Remote upload branch | `request.api.addResume.upload` fetches Blob then multipart `file` | `/rest/file/upload` | response `uuidname` observed in source, stable semantics unknown |
| DOCX / HTML (ATS Fill) | Mammoth raw text / sanitized HTML | ATS field fill path, not original Pinpin resume intake | no Pinpin resume ID in this path |

Conclusion: repository proves the extension can hold source page HTML and, in selected branches, a file Blob. It does **not** prove that the original resume binary is retained by Pinpin, that a stable attachment ID is exposed, or that future TN can refer to it without a second copy. **UNKNOWN / REQUIRES VERIFICATION**: inspect `/rest/file/htmlfile`, `/rest/file/upload`, `/rest/file/temp` response contracts and Pinpin database/file storage.

## 14. AI Fill / Gemini Architecture

```text
Captured 104 / LinkedIn / PDF / DOCX / HTML evidence
        │
        ▼
Extension: `tnai.js` or `tnats-ai-fill.js`
        │ HTTPS POST (raw HTML/text + source metadata)
        ▼
Talent Nexus Netlify Function: `resume-ai-parse.mjs`
        │ validate / optional fact lock
        ▼
`gemini-client.mjs` → Gemini `generateContent`
        │ structured JSON
        ▼
`validate-resume.mjs` → Standard Resume JSON
        ▼
Extension UI → either New Talent identity/Note or ATS controlled form fields
```

- New Talent AI starts from `tnai.js`; it captures only after explicit AI action, records state by run ID, calls `/.netlify/functions/resume-ai-parse`, and writes identity/Note to the existing Angular model. It intentionally does **not** call original `submit()` automatically.
- ATS AI Fill starts from `tnats-ai-fill.js`; it reads PDF/DOCX/HTML locally and calls background `tnats.ai.parse` / `tnats.ai.transform`, which forwards to `https://api.talentnexus.com.tw/.netlify/functions/resume-ai-parse`. ATS bridge has an explicit `submitCalls: 0` design.
- Backend validates structured output and does not echo raw resume text/HTML in response. Gemini key is referenced only as server-side `process.env.GEMINI_API_KEY` in `gemini-client.mjs`; no key value is recorded here.
- Backend auth source currently declares `TEST ONLY` / `INTERFACE ONLY`; actual deployed environment variables and access control are **UNKNOWN / REQUIRES VERIFICATION**. The extension source request does not add an Authorization header in the inspected `tnai.js` flow, so production authentication posture must be reviewed before broad release.

Centralizing future AI behind a Talent Nexus backend is compatible with the existing boundary if the extension continues to treat the backend as an additive reader/assistant and leaves Pinpin canonical Save untouched.

## 15. Network / API Inventory

Authentication values are intentionally redacted.

| Purpose | Method | Host / path | Caller | Auth mechanism type | Request / response type |
|---|---|---|---|---|---|
| Pinpin duplicate auto | POST | `{Config.api}/rest/file/htmlfileauto2` | `checkRepeat()` → background router | Pinpin session; login recovery possible | JSON wrapper with HTML + URL → status/idlist-like response |
| Pinpin duplicate precise | POST | `{Config.api}/rest/file/htmlfileauto3` | `checkRepeat(...,'click')` | same | same family |
| Pinpin similar check | POST | `{Config.api}/rest/file/htmlfileauto4` | `checkRepeat(...,'click2')` | same | same family |
| Duplicate list | GET-like query through router | `{Config.api}/rest/candidate/listforcrx` | `CheckRepeatCtrl.getInitData()` | Pinpin session | `idlist` → `response.list` items |
| HTML resume intake | POST | `{Config.api}/rest/file/htmlfile` | source adapters / legacy import | Pinpin session | HTML payload → temp file response |
| Binary resume upload | POST multipart | `{Config.api}/rest/file/upload` | background `addResume.upload` | Pinpin session | FormData → upload response |
| Temp parse info | GET-like query | `{Config.api}/rest/file/temp` | `AddResumeCtrl` | Pinpin session | filename → parsed form data |
| Canonical candidate Save | POST form-urlencoded | `{Config.api}/rest/resume/addbyplug` | `AddResumeCtrl.submit()` | Pinpin session | form data → status + candidate ID |
| Update / attachment bind | POST | `{Config.api}/rest/file/bind_candidatecrxnew` | `CheckRepeatCtrl.saveOrReplace()` | Pinpin session | candidate ID + resumeMsg |
| New Talent bind | POST | `{Config.api}/rest/file/bind_candidatecrx` | `AddResumeCtrl.saveOrReplace()` | Pinpin session | candidate ID + uuidname |
| Session recovery | POST | `{Config.api}/rest/user/loginsimulation` | `background.js:doSth()` | `loginparam` cookie, redacted | retry flow |
| User context | GET | `{Config.api}/rest/user/context` | options / config check | Pinpin session | context / login validation |
| Taxonomy / folders / jobs / tags | GET/POST | `/rest/data/*`, `/rest/folder/*`, `/rest/joborder/*`, `/rest/user/*` | New Talent controllers | Pinpin session | JSON |
| TN resume AI | POST | `https://api.talentnexus.com.tw/.netlify/functions/resume-ai-parse` | `tnai.js`, `background.js` ATS path | backend test/interface mode; actual deploy unknown | JSON raw evidence → Standard Resume JSON |
| Gemini | POST | `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent` | backend `gemini-client.mjs` | server-side API key | structured JSON request/response |
| PDF HTML bridge | POST | `{ATS origin}/rest/file/htmlfile` | `tnpdfUploadHtml()` | browser ATS session (`credentials: include`) | JSON HTML intake |

## 16. Git History / Major Change Areas

Selective history identifies these major eras:

| Commit / era | Evidence |
|---|---|
| `36a4a8f` | baseline stable `plugin-5english` version `5000.0.108` |
| `4fcc6d2`, `8a3ce84` | 104 POC and wrong-card identity correction |
| `ad5b921` through `0f5710d` | AI Resume Review, New Talent integration, removal of auto-save |
| `66d6e7b`, `4cd37cb`, `60e72c5`, `ecf8de4` | AI Note schema/format/source metadata changes |
| `6ecb95e` through `c008c80` | LinkedIn B2 cache, diagnostics, profile root and Public SDUI capture repairs |
| later uncommitted working files | ATS candidate AI Fill, ATS job AI Fill, PDF Workspace, LINE, public LinkedIn adapter additions are present but not fully represented by current committed history |

Repeatedly modified / higher regression areas: `background.js`, `tnai.js`, legacy `default/page.js`, LinkedIn capture / cache paths, source-to-New-Talent handoff, and manifest content script ordering.

## 17. Proposed Pinpin Core Freeze Zones

### PINPIN CORE — DO NOT MODIFY WITHOUT EXPLICIT APPROVAL

| File / function | Purpose | Why frozen / regression impact |
|---|---|---|
| `js/core/utils.js` (`utils.message`, `utils.store`) | all message dispatch + `chrome.storage.sync` persistence | Changes can break every source and login/config flow. |
| `background.js` request map and `doSth()` | Pinpin HTTP routing / badge / login retry | Controls duplicate, intake, save, update, attachment and auth recovery. |
| `default/page.js` `AddResumeCtrl.submit()` | canonical candidate creation | Directly creates candidate via `/rest/resume/addbyplug`. |
| `default/page.js` `CheckRepeatCtrl` | duplicate UI/list/update | Owns idlist → candidate ID linkage. |
| `default/page.js` `checkRepeat()` | endpoint selection and shared payload | All auto/precise/similar duplicate checking routes through it. |
| `versions/v1/default/toolbox.html` Angular bindings | New Talent and duplicate controls | Field binding / link behavior is coupled to controllers. |
| Cookie / login simulation in `background.js` | Pinpin authenticated recovery | Incorrect change can create login loops or break authenticated actions. |

### SAFE EXTENSION ZONES (lower risk, still test against frozen paths)

- New independent content scripts mounted by strict host/route guards.
- New background message handlers that do not alter existing `request.api.*` behavior.
- Standalone Talent Nexus backend endpoints that do not participate in Pinpin save decisions.
- Additive UI outside `#kpBox`, or after a successful Pinpin result, with explicit failure isolation.
- Analytics/audit events containing only approved minimised identifiers and never blocking Pinpin continuation.

## 18. Safe Future Talent Nexus Integration Points

| Proposed point | File / event | Data available | Pinpin ID / URL? | New + Duplicate? | Risk |
|---|---|---|---|---|---|
| New candidate success | `default/page.js` `request.api.submit` listener after `response.status` | selected form identity, source URL, `response.data` ID | Yes / constructed URL | New only | Medium; currently core file, requires narrow additive hook |
| Duplicate resolved list | `CheckRepeatCtrl` after `request.api.getRepeatInfo` | `item.id`, limited candidate result data | Yes / constructed URL | Duplicate only | Medium |
| Duplicate update/bind success | `request.api.saveOrReplace` / `request.api.addSaveOrReplace` listeners | candidate ID chosen by recruiter | Yes / constructed URL | Duplicate/update flows | Medium |
| **Recommended future abstraction** | new background observer/message emitted only after either success outcome | minimised event `{eventType, pinpinCandidateId, sourceUrl, timestamp}` | Yes | Yes, if both existing listeners emit it | Lowest once isolated; must be best-effort |

Recommended design principle: invoke future TN notification **after** Pinpin's success UI state has been set, make it fire-and-forget/best-effort, time-bound it, and never await it before opening result link, clearing badge, duplicate display, or Save completion. Failure must be recorded only in TN-owned diagnostics and never change Pinpin result handling.

## 19. Known Risks

1. `default/page.js` is a large minified/legacy mixed control plane; small changes can alter multiple source paths.
2. Duplicate determination relies on server-side parsing of heterogeneous HTML and multiple endpoint families; no contract/schema is bundled.
3. Content script order in manifest is significant: Angular/legacy page code, source adapters, TNAI, and check-repeat share globals.
4. Public LinkedIn adapter wraps global `utils.message.sendMsg`; wrapper ordering conflicts could affect legacy messages.
5. LinkedIn / SPA capture has hydration and timer dependencies; candidate navigation during capture is a known class of risk.
6. `Config.api` is both Pinpin API host and current language/ATS selection source; treating it as a generic TN backend setting would be unsafe.
7. Backend `auth.mjs` and `cors.mjs` are labelled test/interface mode, not confirmed production-grade auth. Deployed environment needs separate verification.
8. `addFileName = response.data.substring(20)` is a positional protocol assumption, not a typed contract.

## 20. Unknowns Requiring VPS / Pinpin Database Inspection

- Exact response schemas and semantics of `htmlfileauto2`, `htmlfileauto3`, `htmlfileauto4`, `listforcrx`, `htmlfile`, `temp`, `upload`, `addbyplug`, and bind endpoints.
- Whether duplicate matching prioritizes name, mobile, email, external source ID, URL, HTML content, or a server-generated fingerprint.
- Meaning and lifetime of `idlist`, `addFileName`, `uuidname`, and `response.data.substring(20)`.
- Whether `response.data` on `addbyplug` always is the final immutable candidate ID, including duplicate/error/merge cases.
- Pinpin candidate merge, deletion, tenancy, permission and ID reuse behavior.
- Pinpin original resume binary / attachment persistence, storage location, attachment ID and supported retrieval API.
- Actual production auth/CORS/model environment variables and whether the extension's no-Authorization browser request is accepted intentionally.
- Actual source of dynamic `schema` and remote dynamic scripts from `Config.server`.

## 21. Recommended Next Phase

1. Conduct a **read-only authenticated network trace** on 104, LinkedIn Recruiter, LinkedIn Public, and one legacy source. Redact all personal data and credentials; capture endpoint status, response field names and event timing only.
2. Produce an explicit Pinpin API contract sheet for candidate identity, duplicate, attachment and temp-file identifiers.
3. Define a small TN side-car event contract only after the contract sheet confirms final candidate IDs for both new and duplicate flows.
4. Implement a separate background-owned, non-blocking notifier behind a feature flag. Do not modify source capture, `checkRepeat()`, `AddResumeCtrl.submit()` mechanics, or existing Pinpin payloads.
5. Add synthetic tests that prove TN notification failures cannot affect Pinpin duplicate, import, save or candidate-link behavior.

## 22. Appendix: Key Files and Important Functions

| File | Important identifiers |
|---|---|
| `working/manifest.json` | MV3 declaration, content script ordering, permissions, host permissions |
| `working/background.js` | request map, `doSth()`, `tnatsAiParse()`, `tnatsBridge()`, PDF bridge, login simulation |
| `working/js/core/utils.js` | `utils.message`, `utils.store`, `utils.storeAsync` |
| `working/js/versions/v1/default/page.js` | `ToolboxCtrl.browserAction`, `checkRepeat`, `CheckRepeatCtrl`, `AddResumeCtrl` |
| `working/versions/v1/default/toolbox.html` | New Talent and duplicate candidate Angular templates, candidate detail links |
| `working/js/versions/v1/sites/site104.js` | `isResumePage`, `capture104Resume`, `findOpenCandidateCard`, `check`, `addResume` |
| `working/js/versions/v1/sites/linkedin-public-pinpin.js` | `canonicalProfileUrl`, `capture`, `hydrateCapture`, `installTransportAdapter` |
| `working/js/versions/v1/sites/tnai.js` | `parseResume`, capture routing, `applyToPinpin`, Note source metadata merge |
| `working/js/versions/v1/sites/tnai-schema.js` | Standard Resume JSON schema |
| `working/js/versions/v1/sites/tnpdf.js` | PDF validation, text-to-HTML, Pinpin handoff |
| `working/js/versions/v1/sites/tnats-ai-fill.js` | ATS PDF/DOCX/HTML extraction and fill UI |
| `ai-page-netlify/netlify/functions/resume-ai-parse.mjs` | Netlify AI request validation and structured response |
| `ai-page-netlify/lib/gemini-client.mjs` | server-side Gemini call / structured output |
| `ai-page-netlify/lib/validate-resume.mjs` | response normalization and field validation |

---

### Audit completion statement

This Phase 1A audit stops here. No database, notifier, API, manifest, Pinpin logic, AI Fill implementation, source extractor, authentication or deployment change has been made.
