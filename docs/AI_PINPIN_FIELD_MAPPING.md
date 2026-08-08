# AI → Pinpin Field Mapping (source-verified)

## The canonical Save pipeline (read from page.js AddResumeCtrl)

`a.submit(true)` serializes `angular.copy(a.resume)` and sends it as
`request.api.submit` → `POST /rest/resume/addbyplug`. The background
service worker forwards to `Config.api + /rest/resume/addbyplug`.

`a.resume` is set by the legacy `getAddInfo` / `addResume.upload` callbacks:

```
a.resume = { chineseName, mobile, email,
             industry: { id:[...], text:[...] } }
```

The full parsed resume (experience / education / skills / summary) is NOT in
`a.resume`. It is stored by Pinpin server-side, keyed by the captured file via
`addFileName` (the temp file from `/rest/file/htmlfile` + `/rest/file/temp`).
That is mechanism A.

## Per-field status (this build)

| AI Review field             | Persisted? | Mechanism |
|-----------------------------|-----------|-----------|
| candidate.name              | PERSISTED | → chineseName in a.resume → addbyplug |
| candidate.phone             | PERSISTED | → mobile |
| candidate.email             | PERSISTED | → email |
| currentEmployment.*         | DISPLAY ONLY | not carried by a.resume |
| experience[]                | DISPLAY ONLY | stored server-side via addFileName |
| education[]                 | DISPLAY ONLY | same |
| skills/languages/certs      | DISPLAY ONLY | same |
| summary                     | DISPLAY ONLY | same |
| industry/status/folder/job/tags | PRESERVED (not overwritten) | recruiter metadata |

## Why experience/education are NOT persisted here

The canonical submit does not transmit them from the AI form. Persisting them
would require a second Pinpin resume-merge API (out of scope, would be a new
unauthorized client) or rewriting capture. Neither is done. The build is
honest: persistence is claimed only for identity, which is exactly what the
canonical submit carries. We do NOT call it "AI Refill All" for exp/edu.

## The bridge (proving canonical-save access)

`tnai.js` is an ISOLATED-world content script and cannot see the page's Angular
scope. `tnai-bridge.js` runs in the MAIN world (`content_scripts[].world=MAIN`)
and exposes `window.__TNAI_BRIDGE`:
- `findScope()` — live AddResumeCtrl via `angular.element(el).data('$scope')`
- `applyIdentity({chineseName,mobile,email})` — `$apply`s into live `a.resume`
- `submitSave()` — calls the SAME `a.submit(true)`
- driven over `window.postMessage`

The unit test loads both worlds and asserts `a.submit(true)` fires exactly once
and identity lands in `a.resume`. Double-submit is guarded by `disAddBtn`.
