# 104 Patch (POC)

## Files added
| File | Purpose |
|---|---|
| `js/versions/v1/sites/site104.js` | The whole 104 adapter. Exposes `window.TN104`. ~330 lines. |
| `test/site104.spec.js` | jsdom behaviour tests, synthetic anonymized DOM. Excluded from `dist/unpacked`. |

## Files modified
| File | Hunks | Lines added |
|---|---|---|
| `manifest.json` | 4 | scoped host, adapter injection, `version_name`, `update_url` removed |
| `js/versions/v1/default/page.js` | 3 | 3 (all additive, all one-liners) |

### manifest.json
1. `host_permissions` += `"https://vip.104.com.tw/*"` — narrowest scope, **not** `*.104.com.tw`.
2. `content_scripts[0].js`: `js/versions/v1/sites/site104.js` inserted **after
   `js/page.js` and before `js/versions/v1/default/page.js`**, so `window.TN104`
   exists when the legacy branches evaluate it.
3. `version_name: "5000.0.108 Golden Base + 104 POC"`. `version` unchanged.
4. `update_url` removed (required for an unpacked/dev build).

### js/versions/v1/default/page.js — the entire diff
1. **matchUrl** — `["51job.com",...` becomes `["vip.104.com.tw","51job.com",...`.
2. **Duplicate chain**, first statement of `catchHtmlToCheckRepeat(t)`:
   `/*TN104*/window.TN104&&window.TN104.isResumePage()?window.TN104.check(t):`
   inserted before the incumbent `-1<F.indexOf("zhipin")?`.
3. **Import chain**, first branch of `ce.browserAction`:
   `/*TN104*/(t=window.location.href,window.TN104&&window.TN104.isResumePage())?window.TN104.addResume():`
   inserted before the incumbent `-1<(t=window.location.href).indexOf("zhizhao.liepin")?`
   (the `t=` assignment is preserved inside the new condition so the rest of the
   chain still sees `t`).

Both new branches are **leading** branches. This is safe because the condition
requires `location.hostname === "vip.104.com.tw"`, which is mutually exclusive
with every incumbent host in both chains — the 104 branch can never shadow
LinkedIn, zhipin, liepin or any other site.

## Functions added (`window.TN104`)
| Function | Behaviour |
|---|---|
| `isResumePage()` | host + structural DOM, or route + >=2 zh-TW semantic labels |
| `capture104Resume()` | -> `{html, mode, chars, ok}` |
| `extractInternalRemarkText()` | recruiter remarks, **separate** from the payload |
| `check(clickType)` | capture -> existing global `checkRepeat(html, clickType)` |
| `addResume()` | capture -> existing `request.api.addResume.normal` message |
| `_internal` | `textOf`, `sanitizeClone`, `semanticScore`, selector lists (tests) |

## 104 detection
Host must be exactly `vip.104.com.tw`. Then **either**
- structural: `.resume-master-layout.search-resume-master`, `.vip-resume-card.resume-card`,
  `.standard-resume`, `.standard-resume-wrapper`; **or**
- path contains `searchresumemaster` **and** >= 2 of:
  工作經歷 / 教育背景 / 個人資料 / 求職條件 / 技能 / 語文能力 / 證照 / 自傳 /
  希望職稱 / 最高學歷 / 最近工作 / 居住地 / 學歷.

No `data-v-*` or other framework-generated attributes are used.

## 104 capture ladder
1. `.vip-resume-card.resume-card` + `.standard-resume-wrapper` (`mode=card+wrapper`)
2. `.standard-resume` (`mode=standard-resume`)
3. `article` inside the resume layout (`mode=layout-article`)
4. sanitized `body` (`mode=body-fallback`, last resort)

No screenshot/OCR path. Output shape:
```html
<!doctype html><html lang="zh-TW"><head><meta charset="UTF-8">
<title>104 Candidate Resume</title></head><body>
<section data-source="104-summary">...</section>
<section data-source="104-resume">...</section>
</body></html>
```

## Sanitization
Capture always runs on a **detached `cloneNode(true)`** — the live page is never
mutated (asserted by test). Removed: script/noscript/iframe/object/embed/style/link,
header/nav/footer/menu, dialog & modal roles, tooltips/popovers/dropdowns,
chat & chatbot, ads/analytics, recommended & similar candidates, floating and
fixed UI, sidebars, pagination, interview/message/invite dialogs, the
extension's own `#kpBox`, and every inline `on*` handler.

## Duplicate / import / update integration
- Duplicate: reuses the extension's own global `checkRepeat()`. No new engine.
  Auto = `t` undefined; precise = `'click'` / `'click2'` from the toolbox, both
  forwarded unchanged.
- Import: reuses `request.api.addResume.normal` with the identical payload
  shape (`{html:[h], host:Config.api, _id:''}`).
- Update / bind: **no change at all**. Once the duplicate result is rendered by
  the existing `#checkRepeat` UI, `saveOrReplace` / `addSaveOrReplace` are
  reached through the untouched existing code path.
- Pinpin authentication / `loginparam` / `loginsimulation`: untouched.

## Contact-info states
STATE A (visible) and STATE B (`mailto:undefined`, blank phone/email) are both
treated as normal. Detection and capture succeed in either — verified by test.
No unlocking, no credit-consuming action, no private API, no unmasking.

## Internal remarks
Extracted only via `extractInternalRemarkText()` and **stripped from the
sanitized payload** (`STRIP_SELECTORS.concat(REMARK_SELECTORS)` inside
`sanitizeClone`), so a recruiter's name in a remark can never be parsed as the
candidate's. Tests assert absence from both the `checkRepeat` HTML and the
import payload. The masked-contact duplicate experiment is **not** implemented.

## Logging
`[TN104]` logs mode, char count and booleans only. No resume HTML, no name,
phone, email, cookies, `loginparam` or tokens.

## Known limitations
- Inherits the legacy **2 s timer** bootstrap. 104 is a Vue SPA; client-side
  navigation between candidates after that timer will not re-trigger the auto
  duplicate check. Workaround today: use the toolbox precise-check button. A
  `MutationObserver` is the productionisation step.
- Selectors come from one manual DOM inspection; other 104 resume layouts may
  fall through to `layout-article` or `body-fallback`.
- 104 duplicate/parse quality on the Pinpin side is entirely unverified — see
  `TEST_MATRIX.md`.
- Remark selectors are heuristic (`[class*="remark"]`); a differently named 104
  remark container would not be stripped.
