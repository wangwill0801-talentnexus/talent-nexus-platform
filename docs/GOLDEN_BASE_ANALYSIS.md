# Golden Base Analysis — plugin-5english.crx

Extracted 2026-08-08. Source of truth = code inside the CRX.

## Identity
| Item | Value |
|---|---|
| name | PINPINSOFT (品聘插件) |
| version | 5000.0.108 |
| **manifest_version** | **3 (already MV3 — no migration performed)** |
| background | `background.js` (service worker) |
| options page | `options.html` |
| action | `action` (MV3 form) |

Distractor files present but **not referenced** by the manifest and therefore
inactive: `background1..4.js`, `manifest2.json`, `manifest3.json`,
`js/background copy.js`, `js/core/utils copy.js`, `js/options copy.js`,
`js/versions/v1/default/check_repeat.js` (0 bytes), `js/versions/v1/zhipin/page copy.js`.

## Active content scripts (manifest `content_scripts[0]`, `<all_urls>`)
```
js/lib/lodash|async|jquery|moment
js/core/utils.js
js/core/html2canvas.js
js/page.js                      <- schema-driven dynamic injector (456 B)
js/issue/content.js
angular + ui-bootstrap + ui-select + jstree
js/versions/v1/default/directive.js
js/versions/v1/default/page.js  <- 89 KB, EVERYTHING lives here
js/versions/v1/default/check_repeat.js  (empty)
```
Plus `js/release/ppPlugin_content.js` on `*://*/*`, and two zhipin-only scripts.

## Background / API router
`background.js` is the service worker. The API surface is defined in
`js/versions/v1/background/data.js` as a `type -> URL` map built from
`Config.api`, dispatched through `$.ajax` and returned via
`utils.message.sendToTab`.

### Pinpin API surface (verified in `data.js`)
| Message type | Path |
|---|---|
| `request.api.checkRepeat` (auto duplicate) | `/rest/file/htmlfileauto2` |
| `request.api.checkRepeat2` (precise) | `/rest/file/htmlfileauto3` |
| `request.api.checkRepeat3` (precise 2) | `/rest/file/htmlfileauto4` |
| `request.api.addResume.normal` (import) | `/rest/file/htmlfile` |
| `request.api.addResume.upload` | `/rest/file/upload` |
| `request.api.getRepeatInfo` | `/rest/candidate/listforcrx` |
| `request.api.getAddInfo` | `/rest/file/temp` |
| `request.api.saveOrReplace` (update) | `/rest/file/bind_candidatecrxnew` |
| `request.api.addSaveOrReplace` | `/rest/file/bind_candidatecrx` |
| `request.api.submit` | `/rest/resume/addbyplug` |
| `request.api.loadJobs` | `/rest/joborder/listbyaddtoproject` |
| `request.api.addToJob` | `/rest/joborder/crxaddtoproject` |
| `request.api.getRepeatTags` / `setRepeatTags` | `/rest/user/gettaglist` / `settaglist` |
| `request.api.UserContext` | `/rest/user/context` |

Default `Config.api` fallback: `https://kairuizhihe.ppinsoft.cn:13618`.

## Authentication / session recovery (`data.js`, function `o()`)
On a response of `login required`, and only for URLs containing `htmlfile`,
the worker reads the `loginparam` cookie from `Config.api`, POSTs it to
`/rest/user/loginsimulation`, then retries the original request. On second
failure it `confirm()`s and opens `{api}/webapp`.
**Unchanged by this patch.**

## Site matching
`js/versions/v1/default/page.js` line 1 defines a global
`matchUrl = [ "51job.com", "zhaopin.com", ..., "linkedin.com", "linkedin.cn", ... ]`
(43 entries). A `$(function(){ setTimeout(..., 2000) })` bootstrap iterates
`matchUrl` against `window.location.href` and calls `catchHtmlToCheckRepeat()`
on a hit.

## The two per-site chains (both must be patched to add a site)
1. **Automatic / precise duplicate check** —
   `matchUrl` -> 2 s timer -> `catchHtmlToCheckRepeat(t)` -> a long
   `else if (F.indexOf("<site>"))` chain -> `checkRepeat(html, clickType)` ->
   `utils.message.sendMsg({type:'request.api.checkRepeat|2|3'})`.
   `preciseCheck()` / `preciseCheck2()` in the toolbox re-enter the same
   function with `'click'` / `'click2'`.
2. **Manual import** — toolbar click -> `background/index.js`
   `chrome.browserAction.onClicked` -> `{type:'browserAction'}` ->
   `$("#kpBox").scope().browserAction("add_resume")` -> a *second*
   `else if (t.indexOf("<site>"))` chain inside `ce.browserAction` ->
   `utils.message.sendMsg({type:'request.api.addResume.normal', ...
   data:{data:JSON.stringify({html:[h], host:Config.api, _id:''})}})`.

## LinkedIn call chain (the golden path — untouched)
- duplicate: `catchHtmlToCheckRepeat` branch `-1 < F.indexOf("linkedin")` ->
  captures `head link` + `head style` + `$("body").prop("outerHTML")` at
  `width:1200px` -> `checkRepeat(...)`; also binds a delegated `body` click on
  ~12 LinkedIn result-card selectors -> `{type:'linkedin.checkRepeat'}`.
- background `index.js` answers `linkedin.checkRepeat` with a 2500 ms delay
  then `linkedin.checkRepeatReceived`.
- content handler for `linkedin.checkRepeatReceived` picks the first of
  `#main`, `.profile-layout-main`, `.scaffold-layout__main`,
  `#profile-container`, `[data-view-name="profile-main-level"] > div`, `body`
  and calls `checkRepeat(...)`.
- import: `ce.browserAction` branch `-1 < t.indexOf("linkedin")` — reads the
  `interop-iframe`, contact-info anchors, expands sections, then posts to
  `request.api.addResume.normal`.

## Duplicate result / import / update UI
`request.api.checkRepeat*` responses -> `$("#kpBox").scope().browserAction("check_repeat", response)`
-> `#checkRepeat` scope `getInitData()` -> `request.api.getRepeatInfo`
(`/rest/candidate/listforcrx`) renders matched candidates. Update/replace goes
through `request.api.saveOrReplace` / `request.api.addSaveOrReplace`.
`checkFlag` guards against the auto-check clobbering a manual action.
