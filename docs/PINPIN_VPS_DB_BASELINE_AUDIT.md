# Pinpin VPS / Database Read-Only Baseline Audit

> 階段：Phase 1B-1  
> 稽核日期：2026-08-11  
> 目標：Production VPS（Windows Server；直接 SSH 已驗證）  
> 模式：嚴格唯讀；僅環境、檔案中繼資料、SQL Server 系統目錄及彙總查詢  
> Production changes：none

## 1. 執行摘要

本次以已核准的非互動式 SSH 直連進行完成稽核。未修改 VPS 檔案、IIS、服務、排程、防火牆、資料庫、權限或帳號；未執行任何 write API、DML、DDL、匯出、備份或履歷下載。所有 SQL 僅讀取 `sys.*` 中繼資料或無個資的彙總計數。

Pinpin 為同機 IIS + SQL Server 架構。兩個 ATS 站台皆指向本機預設 SQL Server 執行個體中的正式資料庫 `HiBole-2`。候選人主實體可確認為 `dbo.ZPResumeInfo`，其 `ID int IDENTITY` 是唯一主鍵；工作、教育與附件以候選人 ID 相連，但資料庫未建立外鍵約束。原始履歷在資料庫附件 BLOB 中確有保留，且至少可確認 PDF、DOCX 與 HTML；IIS 應用程式亦有本機 `file` 目錄，主要存放 HTML 中介/預覽類檔案。

**總體 Pinpin → Talent Nexus 同步可行性：YELLOW。** 初始 100+ 候選人匯入可行；但主表沒有可靠的結構化 `updated_at`，子表也沒有一致的更新時間或資料庫外鍵。未來增量同步不得假設單一 watermark 即可完整捕捉更新，需做候選人週期性補掃、子表/附件對帳、刪除 tombstone 處理及 idempotency ledger。

## 2. 稽核範圍與安全確認

- 已閱讀 `docs/PLUGIN_BASELINE_AUDIT_5000.0.114.md`，用以對照外掛端的 Candidate ID、`addFileName`、`uuidname` 與 Pinpin API 流程。
- SSH 使用既有私鑰及 `BatchMode=yes` 直接連線；私鑰內容未讀取、未顯示、未複製、未寫入 repository。
- VPS 僅執行 Windows/CIM/IIS/檔案中繼資料與 SQL Server 唯讀查詢。
- SQL 未執行 `INSERT`、`UPDATE`、`DELETE`、`MERGE`、`ALTER`、`DROP`、`CREATE`、`TRUNCATE`、`GRANT` 或 `REVOKE`。
- 未輸出候選人姓名、電話、Email、履歷內容、檔名、帳密、token 或 connection string。

## 3. VPS 環境

| 項目 | 已驗證結果 |
|---|---|
| OS | Microsoft Windows Server 2019 Standard，64-bit，10.0.17763 |
| CPU | Intel Xeon Gold 6254，1 core / 1 logical processor（VPS 配額） |
| RAM | 16 GB；稽核時可用約 9.45 GB |
| 系統碟 | C: NTFS，約 49.7 GB，約 10.1 GB 可用 |
| 應用程式碟 | E: NTFS，150 GB，約 147.1 GB 可用 |
| Web service | IISADMIN、W3SVC 均 Running / Auto |
| DB service | MSSQLSERVER Running / Auto；SQL Server Reporting Services 亦在執行 |
| 監聽埠 | 80、5678、5679 均由 HTTP.sys/System 監聽；未將 SQL 1433 暴露於本次所列監聽結果 |

## 4. Pinpin 部署架構

### 已確認站台

| 站台角色 | IIS 狀態 | Binding | 實體根目錄 |
|---|---|---|---|
| 英文 ATS | Started | `ats-en.talentnexus.com.tw:5678` | `E:\V16` |
| 中文 ATS | Started | `ats.talentnexus.com.tw:5679` | 同機第二套 V16 部署目錄 |

中文及英文站台均為傳統 ASP.NET / IIS 部署。兩者根目錄均可識別 `bin`、`rest`、`webapp`、`WebService`、`content`、`file`、`logger` 等應用程式目錄，以及 `Web.config`。本報告不列出部署內的檔案名稱或內容。

### 可辨識的儲存與記錄位置

- 應用程式記錄位置：各站台的 `logger` 目錄（僅確認目錄存在，未閱讀 logs）。
- 檔案中介/HTML 預覽位置：各站台的 `file` 目錄。
- 原始附件主要存放：SQL Server 附件 BLOB 欄位；詳見第 12 節。

## 5. Pinpin 資料庫引擎與位置

| 項目 | 已驗證結果 |
|---|---|
| Engine | Microsoft SQL Server |
| Instance | 本機預設執行個體 `MSSQLSERVER` / `localhost` |
| Version | 10.50.1600.1 RTM，Enterprise Edition (64-bit)（SQL Server 2008 R2 系列） |
| Production database | `HiBole-2` |
| Application provider evidence | `System.Data.SqlClient` 與 Entity Framework provider 已存在於兩套站台設定中；帳密及完整連線字串未讀取/未記錄 |

## 6. Candidate Master / Pinpin Candidate ID

### 主實體與鍵

| 項目 | 已驗證結果 |
|---|---|
| 候選人主表 | `dbo.ZPResumeInfo` |
| 主鍵 | `PK_ZPResumeInfo (ID)` |
| 型別 | `int IDENTITY`，主鍵且 unique |
| 外掛對應 | Phase 1A 外掛成功建立後將 `/rest/resume/addbyplug` 的 `response.data` 作為 Candidate ID；詳細頁亦使用 `detail?id={id}`。與資料庫主鍵設計相符。 |
| Tenant/company scope | 主表未發現明確 tenant ID 欄位或 database FK tenant scope；目前較像單一部署/單一資料庫範圍，需在整合帳號與權限設計中明確隔離。 |

### Candidate ID 評等

**USABLE WITH CAVEATS**

原因：`ZPResumeInfo.ID` 有真正的 identity primary key，工作/教育/附件表都以候選人 ID 欄位對應，且 Phase 1A 外掛端回傳/URL 規則一致。限制是：資料庫沒有確認到 child-table 外鍵；存在 `zpresumeinfoDel` tombstone 型表（含 `FID`、`DelDate`）；未找到可證實的 merge/canonical-ID schema 或 tenant uniqueness constraint。因此 TN 應使用複合外部鍵：

```text
source_system = pinpin
pinpin_deployment = zh | en (或經確認的 tenant/scope)
external_candidate_id = ZPResumeInfo.ID
```

不得僅把裸 `ID` 當成跨未來多部署的全球唯一鍵。

## 7. 候選人核心欄位：資料庫證據與限制

`ZPResumeInfo` 包含身分、聯絡、來源、狀態、摘要、LinkedIn、地址、使用者及分類相關欄位；已驗證的可辨識欄位包括 `ID`、`A0101...` 家族、`A0201...` 家族、`Active`、`Status`、`CreUser`、`ModifyUser`、`RDate`、`CVSource`、`CVStatus`、`School`、`Address`、`email1`、`linkedin`、`linkedinUrl`、`EnglishName`、`line`、`advantage`、`recommend`。

由於資料庫欄位多為既有代碼（例如 `A0101`、`A0204`），且未設定可用的 `MS_Description`，本次不以猜測方式宣稱每個代碼的語意。已知 UI / 外掛資料模型可作為後續受控 mapping 的候選來源，但正式同步前仍需以 **非寫入 API contract trace 或 synthetic candidate** 驗證下列語意：姓名、電話、Email、現任公司、現任職稱、現居地、來源、建立者/owner 及最後更新。

## 8. 工作、教育、技能 / Tags / 分類

| 類別 | 已驗證資料表 / 關聯 | 結論 |
|---|---|---|
| 工作經歷（中文） | `dbo.ZPResumeWork`；`ID int IDENTITY`；`ResumeID` 有非唯一索引；包含年/月、Company、Dept、Industry、IsCur 及描述/分類欄位 | 一對多，可匯入。 |
| 工作經歷（英文） | `dbo.ZPResumeWorkE`；同樣以 `ResumeID` 關聯 | 結構存在；本次彙總為 0 筆。 |
| 教育經歷（中文） | `dbo.ZPResumeEdu`；`ID int IDENTITY`；`ResumeID` 有非唯一索引；包含年/月、School、F1/F2、detail、IsCur 等 | 一對多，可匯入。 |
| 教育經歷（英文 / legacy） | `dbo.ZPResumeEducation`；以 `ResumeID` 關聯 | 結構存在；本次彙總為 0 筆。 |
| Tags / folder / classification | `ZPResumeInfoFolder`、`ZPResumeInfo_SC`、`ZPResumeInfoSCFolder`、`BM_ResumeAll`、來源/狀態相關表等可見 | 存在多表分類模型；需另做 metadata mapping，不能以 AI 值直寫。 |

未在上述關聯上發現資料庫 FK。未來讀取器必須容忍 orphan child rows，並以 application-defined `ResumeID` 約定處理。

## 9. Consultant / Owner Mapping

候選人主表含 `CreUser`（nvarchar）及 `ModifyUser`（int），工作/附件/備註等子表亦可見 `CreUser`、`LastUser` 或 `ModifyUser`。使用者表至少包含 `dbo.ZPUsersList (ID int IDENTITY)` 與 `dbo.BoleUsers (ID int IDENTITY)`；但此次未發現 FK，也不應推測 `CreUser` 的字串值必然對應哪一個 user table。

**結論：owner/consultant 可望建立 mapping，但屬 YELLOW。** 必須先以安全的 API / synthetic record trace 核對 candidate `CreUser`、`A0188` 等欄位和使用者主鍵的實際關係，再做 TN owner mapping。

## 10. 時間戳與增量同步可行性

| 範圍 | 已驗證結果 | 同步含意 |
|---|---|---|
| Candidate master | `RDate` 為 `nvarchar`；未發現一致的 `created_at` / `updated_at datetime` | 不可作為可靠主 watermark。 |
| 工作 / 教育 | 結構沒有一致 datetime update 欄位 | 無法只靠 child timestamp 偵測異動。 |
| 附件 | `ZPResumeInfo_Annex_Other` 有 `CreDate datetime`、`CreUser` | 新附件可部分增量掃描；修改/刪除仍需對帳。 |
| 備註 / 修訂 | `ZPResumeInfo_R_N` 有 `ResumeID`、`LastDate`、`CreDate`、`LastUser`；`ZPResumeInfo_Note` 有 `LastDate` | 可作為輔助 change signal，不可假設涵蓋所有候選人/child 變更。 |
| 刪除 | `zpresumeinfoDel` 含 `FID`、`A0188`、`DelDate` | 具 tombstone 證據，需納入同步。 |

**Incremental sync：YELLOW。** 建議首次全量建立 TN ledger；後續以 candidate ID 範圍/週期性補掃 + 附件 `CreDate` + 變更/刪除表訊號 + 每次 child hash 對帳，而非單一 `updated_at`。

## 11. Delete / Archive / Merge

- `ZPResumeInfo` 有 `Active`、`Status`、`IsValid`、`CVStatus` 等狀態欄位，表示資料可能有停用/狀態模型。
- `zpresumeinfoDel` 的 `FID` 與 `DelDate` 提供刪除/tombstone 證據。
- 本次未找到可證實候選人合併（merge）、canonical master ID 或 ID reuse 的獨立資料表/constraint。

**規則：** TN 同步必須把 Pinpin delete/status 改變視為可撤銷或需人工審核事件；不能因查不到主表就立刻不可逆刪除 TN 資料。候選人 merge 行為仍為 UNKNOWN，下一階段需用 synthetic record / 管理者文件確認。

## 12. 履歷 / 附件模型與原始檔保留

### Database storage

| 表 | 已驗證欄位 | 結論 |
|---|---|---|
| `ZPResumeInfo_Annex` | `ZPResumeInfo_ID`（亦為 PK）、`Annex image`、EncodingType、AnnexType | 每位候選人的主要附件/內容 BLOB 模型。 |
| `ZPResumeInfo_Annex_Other` | `ID identity`、`ZPResumeInfo_ID`（有索引）、FileName、FileType、`Annex image`、`Annex1 image`、CreDate、Filesize、filePath、fileway | 多附件/版本模型；可保留多筆。 |
| `ZPResumeInfo_AnnexFile` | `ID identity`、`ZPResumeInfo_ID`、FileName、FileType、`Annex image` | 額外附件模型；目前彙總 0 筆。 |
| `ZPResumeInfo_Annex_TempFile` | `ZPResumeInfo_ID`、TempFile | 暫存檔名/鍵的 schema 證據；目前彙總 0 筆。 |

無個資的彙總結果顯示 `ZPResumeInfo_Annex_Other` 共 479 筆，其中 PDF 116 筆、DOCX 8 筆、HTML/HTM 341 筆、圖片 14 筆；這些類別的 BLOB 欄位均有資料。故 **Pinpin 原始履歷保留：YES（至少 PDF、DOCX、HTML 已驗證）**。本次未確認 DOC 類型，因此不宣稱 DOC 已保留。

### Filesystem storage

兩個 IIS 部署均有 `file` 目錄；未讀取任一檔案內容。僅以副檔名彙總確認其主要為 HTML/HTM，另有少量 TXT/圖片與極少量 XLSX。這與 extension 的 HTML intake / temporary preview 流程一致，但不能取代附件 BLOB 的原始履歷保留。

### 多版本與未來唯讀取用

- `ZPResumeInfo_Annex_Other.ID` 是獨立 identity，且對 `ZPResumeInfo_ID` 非唯一，**一位候選人可有多筆附件/履歷版本：YES**。
- future read-only resume-file access：**可行但須另行核准和最小權限設計**。可選擇 BLOB metadata + streaming read-only adapter；不可直接開放共享磁碟或把候選人檔案複製到 SharePoint。

## 13. `addFileName` / `uuidname`

Phase 1A 已確認外掛在 HTML intake 後，使用 `response.data.substring(20)` 衍生 `addFileName`，並在上傳/綁定流程使用 `uuidname`。本次資料庫發現：

- `ZPResumeInfo_Annex_TempFile.TempFile` 是暫存檔名/鍵的 schema 證據，但正式庫目前為 0 筆。
- 主附件與多附件最終落點為 `ZPResumeInfo_Annex*` 的 BLOB/metadata，且 `Annex_Other` 有 FileName / FileType / CreDate / Filesize。
- 應用程式 `file` 目錄主要是 HTML 類中介檔，與 extension HTML capture 的暫存型態相符。

**結論：** `addFileName` 與 `uuidname` 應視為 Pinpin 流程內部的暫存/綁定識別，不可作為 TN 長期 identity。TN 長期附件鍵應以 `source_system + deployment_scope + candidate_id + attachment_row_id`（待 API trace 確認）建立。

## 14. 初始匯入與 Hybrid Identity 設計

### 彙總規模（僅資料庫 metadata row count）

| 表 | 約略列數 |
|---|---:|
| `ZPResumeInfo` | 172 |
| `ZPResumeWork` | 491 |
| `ZPResumeEdu` | 133 |
| `ZPResumeInfo_Annex` | 438 |
| `ZPResumeInfo_Annex_Other` | 479 |
| `ZPResumeInfo_R_N` | 185 |
| `zpresumeinfoDel` | 9 |

**Initial 100+ candidate import：GREEN（資料量與 schema 均足夠）。** 前提是採 read-only、分頁、最小欄位、附件 metadata first、可續跑 ledger，且第一版不要批量複製履歷 BLOB。

### Plugin + DB hybrid identity

```text
Plugin-created candidate
  Plugin successful response / duplicate resolution
  -> Pinpin Candidate ID (ZPResumeInfo.ID)
  -> TN side-car ledger (non-blocking)

Non-plugin candidate
  Pinpin read-only DB adapter
  -> same source_system + deployment_scope + external_candidate_id
  -> TN side-car ledger
```

**Hybrid identity：YELLOW。** ID 主鍵與外掛結果一致，idempotency 設計可行；但需先把 deployment/tenant scope 放入唯一鍵，並處理 tombstone、child orphan、merge unknown 與延遲寫入。兩條路徑遇到同一 candidate ID 時必須 upsert 同一 TN external record，而不是新增第二人。

## 15. SharePoint 建議

**LATER。** Pinpin 已保留原始附件 BLOB，現在沒有必要為「原始檔保全」立即引入 SharePoint。先完成 read-only side-car ledger、metadata sync、權限界線與資料生命週期政策；若之後需要顧問共用、合規保留、版本協作或 M365 DLP，再由已核准的 copy/export policy 導入 SharePoint。

## 16. Pinpin 升級 / 耦合風險

1. SQL Server 2008 R2 系列已過生命週期，安全與支援風險高；任何新整合都應低耦合、唯讀、可撤回。
2. 候選人主表使用大量代碼欄位，且未有欄位描述；直接 DB mapping 容易誤解語意。
3. 工作、教育、附件與使用者關係未建立資料庫 FK，資料完整性可能由應用程式層維持。
4. 主表無可靠 `updated_at`，單向增量 scan 可能遺漏更新。
5. 附件同時有 BLOB 與本機 HTML 類暫存，錯把暫存檔當原始檔會造成資料品質或合規風險。
6. 外掛的 `addFileName.substring(20)` 是 positional protocol 假設；不得成為 TN integration contract。
7. 中文/英文站台可能是不同部署 scope；未確認前不可將裸 Candidate ID 視為全域唯一。

## 17. 未知事項與下一步界線

仍未確認且不應由本次稽核猜測：

- 代碼欄位與 UI/API 語意的完整對照（姓名、手機、Email、公司、職稱、地點、source、owner）。
- 候選人 merge/recreate/ID reuse 的實際業務規則。
- `addFileName` / `uuidname` 在 API controller 的精確生命週期。
- 多部署的 tenant/company scope 與 cross-site ID uniqueness。
- 哪些候選人改動會寫入 `ZPResumeInfo_R_N` 或其他 change log。
- resume BLOB 的受控 read-only API/streaming contract。

**建議下一階段：Phase 1B-2 — Read-only Pinpin Contract & Mapping Validation。** 僅以 synthetic/已授權測試候選人執行非寫入 API contract trace，建立欄位語意、owner、attachment metadata、delete/merge 與 change-event 對照；接著才設計一個 feature-flagged、non-blocking、read-only TN sync adapter。不得在本階段實作同步、SharePoint 複製或任何寫入。

---

### Audit completion statement

Phase 1B-1 在此停止。此 report 是唯一修改的 repository 檔案；production VPS、Pinpin、IIS、SQL Server、服務、排程、檔案、帳號與權限均未改動。
