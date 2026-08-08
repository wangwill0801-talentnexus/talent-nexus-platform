# DIAGNOSTIC BUILD — NOT FOR PRODUCTION

One live 104 trace. Do not keep this build installed afterwards.

Load: `chrome://extensions` → Developer mode → Load unpacked →
`dist\unpacked-diagnostic`

It identifies itself as **`[DIAGNOSTIC] PINPINSOFT`**, version name
`5000.0.108 DIAGNOSTIC BUILD - NOT FOR PRODUCTION`. If the card does not say
`[DIAGNOSTIC]`, you loaded the wrong folder.

Disable the normal PINPINSOFT extension first — two copies race on the same
page and the trace becomes unreadable.

## What was added

Tracing only. No business behaviour was changed: no sleeps, no payload edits,
no forced Save, no LinkedIn changes.

| File | Role |
|---|---|
| `js/versions/v1/sites/tntrace.js` | wraps `utils.message.sendMsg` / `register` |
| `js/versions/v1/sites/tntrace_sw.js` | wraps service-worker `fetch` |
| `manifest.json` | +1 content-script line |
| `background.js` | +1 `importScripts` line |

## Two consoles — you need BOTH

MV3 sends Pinpin traffic from the service worker, so the page's Network tab
will not show it.

1. **Page console** — F12 on the 104 tab → `[TNTRACE]`
2. **Service-worker console** — `chrome://extensions` → `[DIAGNOSTIC] PINPINSOFT`
   → click **"Service worker"** → `[TNTRACE-SW]`

Keep both open before you click anything.

## Steps

1. Open a 104 candidate resume you can already view.
2. Open both consoles.
3. Click the extension's import/add action.
4. Wait for the New Talent panel.
5. Click **Save**.
6. Copy both consoles out in full.

## What to look for

Two independent chains. Note the FIRST missing line in each.

**CHAIN B — metadata (drives the Status dropdown)**
```
[TNTRACE] add_resume gate entered
[TNTRACE] loadStatus sent
[TNTRACE-SW] loadStatus request started
[TNTRACE-SW] loadStatus HTTP status: 200
[TNTRACE] loadStatus response received
[TNTRACE] status option count: N        ← N=0 or -1 explains the empty dropdown
```

**CHAIN A — resume import (drives Save)**
```
[TNTRACE] addResume.normal sent
[TNTRACE-SW] htmlfile request started
[TNTRACE-SW] htmlfile HTTP status: 200
[TNTRACE-SW] htmlfile response data type: string
[TNTRACE-SW] htmlfile response data length: N
[TNTRACE] addResume.normal callback received
[TNTRACE] addFileName resolved: true    ← false here breaks Save
[TNTRACE] getAddInfo sent filenameAttached=true
[TNTRACE-SW] temp request started
[TNTRACE-SW] temp HTTP status: 200
[TNTRACE] getAddInfo callback received
[TNTRACE] getAddInfo usable data: true
[TNTRACE] Save click fired
[TNTRACE] addbyplug sent
[TNTRACE-SW] addbyplug HTTP status: N
```

The screenshot showed name/phone/email populated, so Chain A is expected to
reach `getAddInfo usable data: true`. If it does, Chain A is healthy and the
fault is isolated to Chain B — a different bug from the one I first guessed.

## Privacy

Logs carry only types, booleans, counts, lengths, HTTP status. Never resume
HTML, candidate name/phone/email, temp filename, host, cookies or tokens.
Enforced by AST scan in `test/tntrace.spec.js`. The console output is safe to
paste to me as-is.

## Removal

Remove `[DIAGNOSTIC] PINPINSOFT` from `chrome://extensions` and re-enable your
normal extension. The diagnostic build is a separate directory; the POC in
`dist/unpacked` is untouched.
