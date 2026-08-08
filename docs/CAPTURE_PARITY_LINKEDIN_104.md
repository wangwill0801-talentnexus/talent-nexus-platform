# Capture parity: LinkedIn (golden) vs 104

## LinkedIn — the proven parser input

Source: `page.js`, branch `-1<t.indexOf("linkedin")?`.

Root priority: `#main` -> `.profile-layout-main` -> `.scaffold-layout__main`
-> `main` -> `body`. Captured with **`.prop("outerHTML")`** — the real DOM,
classes and nesting intact.

Final shape:

```
'<html style="width: 1200px;">' + head + '<body>' + main + contactModal + '</body></html>'
```

where `head` = `<head>` + all `<link>` + all `<style>` from the page, plus one
injected style block.

Key observations:

1. **No screenshot.** `captureVisibleTab` exists in `background.js` but serves
   `img.send`, unrelated to the parser. `html2canvas` is shipped but not used
   in this path. **Classification: E — unrelated feature.** So 104 must stay
   DOM/HTML based.
2. **Original classes and nesting preserved.** No flattening, no rebuild.
3. **Stylesheets included.** The parser sees the page roughly as rendered.
4. Sections expanded before capture (Experience/Education/Projects), each
   expansion navigating and capturing, then `history.back()`. The 2000-4500ms
   timers exist for **this**, not for the API chain.
5. Contact modal is opened, phone/email wrapped in sentinel markers
   (`手机…手机`, `邮箱…邮箱`), the modal's `outerHTML` appended to the payload.
6. Single root; fragments concatenated only when rebuilding `<main>` from
   `.artdeco-card` sections.

## 104 — current implementation

| Aspect | LinkedIn | 104 (now) | Parity |
|---|---|---|---|
| Capture method | `outerHTML` | `outerHTML` | yes |
| Classes/nesting | preserved | preserved | yes |
| Root selection | first match is correct (single profile) | **must disambiguate a list** | differs by necessity |
| `<head>`/styles | included | **not included** | **gap** |
| Contact markers | `手机…手机` / `邮箱…邮箱` | none | **gap** |
| Section expansion | clicks to expand | none yet | **gap** |
| Screenshot | no | no | yes |
| Synthetic wrapper | minimal `<html>` | minimal `<html>` | yes |

## Remaining gaps (deliberately not yet patched)

1. **No `<head>`/styles.** LinkedIn ships them; we don't. May explain "partial
   and messy". Cheap to add, but changes payload shape — wants one clean live
   trace first.
2. **No contact sentinel markers.** LinkedIn helps the parser find phone/email
   explicitly. We rely on them appearing in the DOM.
3. **No section expansion.** If 104 collapses long work history behind
   "show more", we capture only what is expanded. Needs live confirmation.

These are the top candidates if field quality is still poor after the identity
fix. I have not implemented them because each changes the payload, and changing
several things at once would make the next live result uninterpretable.
