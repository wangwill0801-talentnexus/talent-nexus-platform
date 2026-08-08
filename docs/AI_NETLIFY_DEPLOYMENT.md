# Netlify AI Deployment

Package: `dist/ai-page-netlify/` (self-contained). See its README.md.

Endpoints:
- POST /.netlify/functions/resume-ai-parse  (Gemini parse + validate)
- GET  /.netlify/functions/health

Config (env): GEMINI_API_KEY, GEMINI_MODEL, AI_MOCK_MODE, ALLOWED_ORIGINS,
AI_AUTH_MODE, AI_TEST_TOKEN.

Local: `npm install` → `npm run start:mock` (AI_MOCK_MODE=true) →
http://localhost:8888/ai-review.html. Live Gemini: `netlify dev` with a real
key. Direct deploy: zip and drag to Netlify, or point Netlify at the folder.

VERIFICATION STATUS:
- Backend logic VERIFIED via node --test (9 tests) + ad-hoc handler run
  (health/mock-parse/empty-reject/CORS).
- `npm install` + `netlify dev` NOT executed here (netlify-cli download
  exceeded the local timeout). This is a REMAINING MANUAL TEST — the
  netlify.toml port config (port=8888, targetPort=8888) is structurally correct
  (proxy-to-target, no conflict) but not live-run.
