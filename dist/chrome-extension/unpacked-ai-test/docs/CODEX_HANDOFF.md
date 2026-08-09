# Codex Handoff — Connector v1 Release Candidate

Prepared by Hermes Agent (overnight UI/i18n pass). William will visually test
before any v1 freeze.

## What is DONE (release candidate)
- New Talent glass UI: real outer shell widened to 560px, navy `.can-drag` title
  bar restyled in place (X + drag preserved), subtitle below, frosted glass,
  JS bottom-right resize grip, native field widths capped (Note wider), WeChat
  hidden UI-only, old blue diagnostic overlay removed.
- Interface Language (ONE setting): zh-TW / en / Custom. Writes the authoritative
  `chrome.storage.sync` `config` → drives both ATS base URL AND Talent Nexus
  injected UI strings (centralized `TN_UI` dict + `connector-options.js`).
  Custom ATS URL preserved; no `/webapp/`; MV3-safe (external JS, no inline).
- AI Fill unchanged in behavior; integrated into form above Save; submitCalls=0.
- All 10 active suites green (466 assertions).

## What William must still do
- Visual/live Chrome test (104 + LinkedIn + Options) tomorrow morning.
- Approve UI before any v1 freeze declaration.

## Do NOT touch during initial audit (functional freeze)
104 capture · LinkedIn capture · AI Note v2 · Gemini prompt/model · retry ·
source metadata · identity fill · Note merge · backend/Netlify · Pinpin Original
Save · duplicate logic · draggable directive · native `.can-drag`/X · add_resume.html.

## Where things live
- Augmentation: `js/versions/v1/sites/tnai.js` (content script).
- Options behavior: `connector-options.js` (external).
- Options markup: `options.html` (additive Talent Nexus card).
- Theme CSS: `applyNewTalentTheme` inside tnai.js (injected `<style>`).
- Resize: `mountShellResize` (JS grip on `#addResume` parent).
- i18n: `TN_UI` dict + `tnGetLanguage` (reads `config.interfaceLanguage`).

## Test command
```
cd working
NODE_PATH='C:\tn104env\node_modules' node test/connector-options.spec.js
NODE_PATH='C:\tn104env\node_modules' node test/tnai.spec.js
# ... etc (see docs/CONNECTOR_V1_ARCHITECTURE.md §M)
```

## Build
```
# copy working → dist/chrome-extension/unpacked-ai-test, then zip
# (see _build.py pattern used during RC prep)
```
NO Netlify redeploy.
