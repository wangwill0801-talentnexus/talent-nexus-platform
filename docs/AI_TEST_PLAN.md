# AI Test Plan

## Automated (STATIC VERIFIED / TESTED WITH MOCK)
- Chrome: `test/tnai.spec.js` (20 assertions) — schema, mapper (persisted-only),
  per-candidate isolation, mock parse, bridge reachable via postMessage,
  canonical submit invoked once through bridge, double-submit guard.
- Netlify: `test/backend.test.mjs` + `test/form-binding.test.mjs` (9) —
  validation coerces empty→null, mock pipeline, auth token enforcement,
  experience/education/skills two-way binding.

## Manual (READY FOR MANUAL TEST, not live-run here)
- T1 LinkedIn import still opens Original New Talent (golden control).
- T2 104 import still works.
- T3 AI Review panel opens on New Talent.
- T4 AI Parse (mock) → form populated, editable.
- T5 Save to Pinpin (identity) → reaches existing addbyplug, once.
- T6 AI failure does not break Original.
- T7 Consecutive candidates do not share AI state.
- T8 `netlify dev` local run (port config) — see AI_NETLIFY_DEPLOYMENT.md.
- T9 Live Gemini parse (needs GEMINI_API_KEY + AI_TEST_TOKEN).

All manual items require an authenticated 104/Pinpin/LinkedIn/Gemini session
not available in this build environment.
