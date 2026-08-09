# Connector v1 Architecture (Release Candidate)

Golden Base = Pinpin 104 Chrome extension (the shipped product). The Talent
Nexus AI Connector is an **additive augmentation layer** that rides on top of
it. Nothing in the Golden Base capture/Save path is replaced.

## A. Golden Base boundary
- `versions/v1/default/tmpl/add_resume.html` — native New Talent overlay (NOT edited).
- `versions/v1/default/page.js`, `directive.js`, `background*.js` — Pinpin runtime (NOT edited).
- `js/options.js` — Pinpin Options (server-address Save; NOT edited).

## B. Pinpin native vs Talent Nexus augmentation
- **Native (untouched):** 104 capture, LinkedIn capture, Angular `AddResumeCtrl`,
  `draggable` directive, `ng-click="close()"`, Original Save, duplicate controls,
  dropdown options, candidate data.
- **Talent Nexus (additive):** `js/versions/v1/sites/tnai.js` content-script augmentation,
  `connector-options.js` (Options behavior), injected glass CSS, AI Fill button,
  Interface Language localization.

## C. 104 capture architecture
`TN104.capture104Resume` reads the live `#addResume` DOM (same isolated world as
page.js) → builds payload → Netlify `resume-ai-parse` → fills Name/Phone/Email +
Note into the ORIGINAL fields. No second save client.

## D. LinkedIn capture architecture
`captureLinkedInResume` (frozen) — root resolver + scoring + sanitization.
Public/Recruiter profiles. NOT modified in this phase.

## E. AI Fill flow
New Talent page detected → `applyNewTalentTheme` (glass shell on `#addResume` parent)
+ `applyNewTalentBranding` (native `.can-drag` → "Talent Nexus Connector" + subtitle)
+ `mountLauncher` (✨ AI Fill integrated above Save) + `mountShellResize` (JS resize grip).
Click AI Fill → capture → parse → fill → recruiter reviews → **manual** Pinpin Save.

## F. submitCalls = 0 / Original Save boundary
AI Fill NEVER calls `scope.submit`. All writes go to the same Angular `a.resume`
the recruiter would Save manually. `submitCalls` counter stays 0.

## G. Note v2 freeze
`assessNoteQuality` = hard-safety guards only (empty / first-person / weak-fallback
/ english-clause / malformed). One retry max. Quotas/richness removed. FROZEN.

## H. One-retry contract
Primary Gemini call → if quality gate FAIL → exactly ONE retry (replaces only
recruiterSummary/targetRoles/coreKeywords). Identity + primary resume immutable.

## I. Deterministic 104/LinkedIn metadata
`--- TNT 人才備註 ---` marker; `【104履歷代碼】<verified code>`;
`【LinkedIn】<verified canonical URL>`. Extension-derived, never invented by model.

## J. New Talent UI augmentation
- Real shell = `#addResume`'s **parent** (Pinpin `draggable` moves `t.parent()`).
- `.tn-shell` glass class + default width 560px on the parent; `#addResume` fills 100%.
- Native `.can-drag` restyled in place (navy glass, "Talent Nexus Connector", X kept).
- `.tn-resize` JS grip → live width+height resize (CSS resize proved unreliable).
- Fields capped at native proportions (max-width 360px); Note textarea wider.
- WeChat row hidden UI-only if present (model/payload untouched).
- Old blue diagnostic overlay removed (no-op `updateB2DiagBadge`).

## K. Options / zh-TW / en / Custom
`connector-options.js` (external, MV3-safe) writes the **authoritative**
`chrome.storage.sync` key `config`:
- `config.api` = ATS base; `config.interfaceLanguage` = zh-TW | en | custom.
- zh-TW → `http://ats.talentnexus.com.tw:5679/` ; en → `http://ats-en.talentnexus.com.tw:5678/`.
- Unknown custom `config.api` → Custom state, preserved on load, never overwritten by opening Options.
- TN-owned UI strings localized via `TN_UI` dict (zh-TW/en); native Pinpin NOT translated.

## L. Backend / Netlify separation
Gemini key stays server-side (Netlify function). `tnai.js` only knows `AI_API_BASE_URL`.
NO Netlify redeploy in this UI phase.

## M. Active test suites
tnai.spec, tnai-launcher.spec, tnai-104-input.spec, site104.spec,
site104.identity.spec, tnai-linkedin-text.spec, tnai-ainote-v2.spec,
tntrace.spec, tntrace.diff.spec, connector-options.spec.

## N. Build outputs
`dist/chrome-extension/unpacked-ai-test/` (load unpacked) and
`dist/chrome-extension/talent-nexus-connector-ai-test.zip`. working==dist parity.

## O. Known limitations
- AI Note v2 may occasionally produce a shallow recruiterSummary (title/company
  metadata); targetRoles sometimes absent. ACCEPTED non-blocking.
- Connector i18n localizes TN-owned UI only; native Pinpin language follows the
  selected ATS endpoint (requires ATS reload to fully apply).

## P. What Codex must NOT rewrite during initial audit
104 capture, LinkedIn capture, AI Note v2, Gemini prompt/model, retry, source
metadata, identity fill, Note merge, backend, Netlify, Pinpin Original Save,
duplicate logic, draggable directive, native `.can-drag`/X, add_resume.html.
