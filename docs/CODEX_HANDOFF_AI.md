# Codex Handoff — AI Resume Review

Generated: 2026-08-08

## Current working baseline
- Golden base: `plugin-5english.crx` v5000.0.108 (MV3), byte-for-byte in `original/`.
- 104 + LinkedIn → Pinpin already working (prior phases). Wrong-candidate
  identity bug FIXED (site104 `findOpenCandidateCard`).
- Branch: `feature/ai-resume-review` (local only, NO remote, NO GitHub, NO CI/CD).

## Extension version
- `manifest.json` version 5000.0.108, `version_name` "... Golden Base + 104 POC".
- Additive AI files: `tnai-schema.js`, `tnai.js` (isolated), `tnai-bridge.js`
  (main world). Manifest gained a MAIN-world content_scripts entry +
  `web_accessible_resources` for the bridge. page.js / LinkedIn / 104 capture
  UNCHANGED this phase.

## Files added
- working/js/versions/v1/sites/tnai-schema.js
- working/js/versions/v1/sites/tnai.js
- working/js/versions/v1/sites/tnai-bridge.js
- working/test/tnai.spec.js (+ existing site104 / identity / tracer specs)
- dist/ai-page-netlify/** (complete Netlify package)
- docs/AI_*.md

## Chrome package location
- dist/chrome-extension/unpacked-ai-test/   (build step below)
- dist/talent-nexus-connector-ai-test.zip

## Netlify package location
- dist/ai-page-netlify/
- dist/talent-nexus-ai-page-netlify.zip

## API contracts
- POST /.netlify/functions/resume-ai-parse
  body: { source, resumeText, resumeHtml, currentPinpinFields }
  ok:   { ok, requestId, model, resume: <StandardResume>, warnings, meta }
  err:  { ok:false, requestId, error:{code,message} }
- GET  /.netlify/functions/health  -> { ok, service, geminiConfigured, model, mockMode, auth }

## Environment variables
GEMINI_API_KEY, GEMINI_MODEL (=gemini-3.5-flash-lite, configurable),
AI_MOCK_MODE, ALLOWED_ORIGINS, AI_AUTH_MODE (test|interface), AI_TEST_TOKEN.

## Auth state
TEST ONLY (default) / INTERFACE ONLY. AI_TEST_TOKEN required when a real
GEMINI_API_KEY is set (Bearer auth on resume-ai-parse). No production identity.

## Backend URL configuration
Single point in Chrome: TNAI.setApiBaseUrl / localStorage `tnai_api_base_url`.
Page: `src/ai-review/api-client.js` DEFAULT_API (overridable in UI).

## Gemini model config
Server-side env GEMINI_MODEL; not hardcoded in frontend. Structured Output via
responseSchema in lib/gemini-client.mjs; validated in lib/validate-resume.mjs.

## Tests passed
- Chrome tnai.spec.js: 20 assertions (bridge round-trip, mapper, isolation,
  mock parse, double-submit guard).
- Netlify: 9 (validation, auth, form-binding). Backend handler exercised
  ad-hoc (health/mock/empty/CORS).

## Live tests executed
NONE in this environment (no authenticated 104/Pinpin/LinkedIn/Gemini session,
and netlify-cli local run exceeded the sandbox timeout).

## Remaining manual tests
- LinkedIn + 104 regression (T1/T2), AI panel (T3), mock parse+edit (T4),
  identity save-once (T5), AI-failure isolation (T6), per-candidate isolation
  (T7), `netlify dev` (T8), live Gemini (T9). See AI_TEST_PLAN.md.

## Known limitations
- AI PERSISTS only identity (Name/Phone/Email) on Save. experience/education/
  skills/summary are review-only in the Chrome path because the canonical
  submit stores the full resume server-side via addFileName (mechanism A),
  not from the AI form. Not called "Refill All" for those fields.
- Netlify `npm install` + `netlify dev` not live-verified here.
- Real Gemini not exercised (needs key + token).

## Items Codex should NOT rewrite
- LinkedIn capture, 104 capture, 104 identity selection, Pinpin auth/session,
  existing request layer, existing New Talent, existing Save (a.submit).
- The single canonical Save pipeline. Add a second addbyplug client ONLY if a
  new product requirement explicitly demands server-side resume merge.
- Golden base `plugin-5english.crx` (immutable).

## Future (Codex scope)
- GitHub repo + branch policy + CI/CD.
- Netlify Git deployment.
- Production auth (Talent Nexus / M365 short-lived Connector token).
- Optional: server-side resume-merge so AI experience/education persist.
