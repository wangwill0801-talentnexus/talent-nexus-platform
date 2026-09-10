# 104 JD 關鍵字建議

104 搜尋結果頁（`/search/searchResult`）與搜尋列表頁（`/search/listSearch`）都會顯示 `Talent Nexus JD Match` 小面板入口。面板支援 AI Fill 風格的 `✨ 產生 104 關鍵字` 按鈕。按下後，Connector 只送出招募者手動貼上的 JD 到 TN API；TN 使用既有 Gemini query model 保留原本 3–5 組查詢，再增加 2–3 組「精準限定」查詢（合計 5–8 組），並附上簡短用途說明。

JD 可直接貼入文字，也可貼上公開的 `https://www.104.com.tw/job/<slug>` 職缺網址並按 `讀取 104 JD`。Connector 先以不帶 Cookie 的唯讀請求取得公開頁面，於瀏覽器端抽取可見 JD；若 104 對背景請求回傳阻擋或無法可靠讀取，會沿用 Job AI Fill 的可見頁面擷取流程，在同一分頁開啟職缺頁、擷取可見內容後返回搜尋頁，仍保留手動貼上 JD 的路徑。面板使用半透明 `backdrop-filter` 毛玻璃效果，樣式限制在 Shadow DOM 內。

每組結果包含精準、平衡、擴展或「精準限定」等搜尋角度、`query`、`rationale` 與 `focus`。104 的「精準限定」組合只使用 JD 明確出現的職稱／技術／產品／平台／方法／領域詞，至少兩個條件並以 `AND` 收斂，避免只用工程師、電子、科技等泛詞。結果只提供複製按鈕，必須由招募者自行貼回 104；本功能不自動送出搜尋、不翻頁、不下載履歷、不讀取聯絡資訊，也不寫入 104 或 TN 資料庫。

API contract: `search_keywords_v1`, source `104-vip-search`, `POST /api/v1/plugin-sidecar/search-keywords`。路由沿用既有 Entra/sidecar authentication 與 Gemini 設定，JD 在 TN 邊界再次遮罩 email、電話及敏感 session 欄位；輸出若少於 3 組、超過 5 組或格式不符則 fail closed。

Connector 的小面板採 Shadow DOM 隔離，紫藍漸層按鈕只作為 AI Fill 風格視覺提示，不會改變既有「開始分析」或 104 原生搜尋流程。分析理由預設使用繁體中文，可在面板上切換 English；切換後需重新分析才會更新結果語言。`search_triage_104` 關閉時，整個面板不注入；`search_keywords_104` 可單獨關閉關鍵字按鈕，維持既有 Connector 行為。

## LinkedIn Recruiter 關鍵字與少量欄位

在 `https://www.linkedin.com/talent/home` 與 `https://www.linkedin.com/talent/search`，Connector 另提供 `Talent Nexus JD Match` 小面板。招募者手動貼上 JD 後，可產生 3–5 組 LinkedIn Recruiter Boolean 關鍵字，並在結果出現時選擇 `填入少量欄位`。該動作最多只把明確 JD terms 帶入目前畫面可見的職稱、地點、技能輸入框；不按 Enter、不送出搜尋，仍由招募者自行選取 LinkedIn 下拉選項。

LinkedIn 版本使用獨立 source `linkedin-recruiter-search`，與 104 共用既有唯讀 API contract，但不讀取候選人卡片、不判斷排序、不開啟背景頁、不自動提交搜尋。回傳的 `fieldSuggestions` 僅包含 `jobTitles`（最多 3）、`locations`（最多 2）與 `skills`（最多 6）；不推導公司、學校、畢業年份、產業或隱藏資料。

Boolean 語法遵循 LinkedIn Recruiter：`AND`、`OR`、`NOT` 必須大寫，使用括號分組與直雙引號表示精確片語；不使用 `+`、`-`、`*` 萬用字元、方括號、大括號或尖括號。參考 [LinkedIn Recruiter Boolean filter rules](https://www.linkedin.com/help/linkedin/answer/a415295/use-boolean-to-filter-search-results-in-recruiter?lang=en) 與 [LinkedIn Boolean search syntax](https://www.linkedin.com/help/recruiter/answer/a524335)。

## 104 人選頁 JD 保留與單一人選深度分析

在 104 搜尋結果面板對某張履歷按 `開啟履歷（手動）` 時，Connector 會把目前 JD 放入 `chrome.storage.session` 的短期、候選人範圍暫存，並只在新分頁網址附加不可讀的隨機 `tncontext` token。JD 不會放進 URL，也不會送給 104。人選頁只接受來自支援的 104 搜尋頁、且 104 candidate ID 完全相同的 token；逾時（2 小時）或 ID 不一致即拒絕。

人選頁會顯示獨立的 `104 人選 JD 深度分析` 毛玻璃小面板。它可自動帶入保留 JD，也可由招募者手動貼上 JD；按 `開始深度分析` 後，僅取目前頁面由既有 `TN104.capture104Resume()` 產生的可見履歷內容，移除 script/style 與 email/電話，再送至 `POST /api/v1/plugin-sidecar/candidate-jd-analysis`。回傳包含 0–100 匹配度、繁體中文摘要、符合重點、待確認缺口與建議追問。

深度分析面板固定在右上方並使用可用高度內捲動；身分辨識面板維持右下方、提高堆疊層級並提供 × 關閉，兩者同時出現時可重疊而不遮住主要分析內容。換到另一位 104 人選時，身分辨識面板會重新顯示。

這條線是唯讀且不持久化：不讀下一位人選、不翻頁、不背景開頁、不下載履歷、不建立或更新 Candidate/Evidence/AI Profile、不寫入 104/TN。後端與 side-car 會再次驗證 104 URL、候選人 ID、長度與敏感欄位；所有 AI 輸出也會遮罩 email/電話。`candidate_analysis_104` 可用既有 `tn.featureFlags.v1` 關閉，關閉時既有 104 Connector 行為不變。

## 104 listSearch JD 暫存

`Talent Nexus JD Match` 在 `/search/listSearch` 與 `/search/searchResult` 共用同一個短期 JD 草稿。招募者在面板輸入或讀取 JD 後，Connector 會以目前瀏覽器分頁為範圍寫入 `chrome.storage.session`，有效期 2 小時；從 104 搜尋列表切換到搜尋結果時，面板會自動恢復該 JD。清空文字框會清除草稿，瀏覽器關閉或逾期後也會失效。

草稿只用於同一分頁的 UI 便利與後續明確的人選分析，不放進 URL、不傳給 104、不寫入 TN，也不包含 Cookie、Session、帳號或其他認證資訊。若無法恢復，仍可直接手動貼上 JD；既有搜尋、AI Fill、Evidence 與 ATS 流程不受影響。
