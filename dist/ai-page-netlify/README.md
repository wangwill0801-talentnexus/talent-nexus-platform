# Talent Nexus — AI Resume Review (Netlify)

Standalone Netlify package: a stateless Gemini-backed resume parser + a browser
test page. **No database**, no GitHub, no CI/CD. Deployable directly to Netlify.

> Save-to-Pinpin happens in the Chrome extension (where the Pinpin session
> lives). This package only parses + previews + validates.

## 1. Purpose
- Parse 104 / LinkedIn resume text or HTML into a **Standard Resume JSON**.
- Test Gemini parsing, the schema, and the API **without** Pinpin.
- Share ONE data model with the Chrome extension (see `lib/resume-schema.mjs`).

## 2. Requirements
- Node 18+
- A Gemini API key (only for live calls) — **or** run in mock mode (no key).
- Netlify CLI (`npm i -g netlify-cli`) for local dev.

## 3. Install
```
npm install
```

## 4. Environment variables
Copy `.env.example` → `.env` and fill in:
```
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.5-flash-lite
AI_MOCK_MODE=false
ALLOWED_ORIGINS=
AI_AUTH_MODE=test
```
Never commit `.env`. The key lives **server-side only**.

## 5. Local test (mock, no key)
```
npm run start:mock
# open http://localhost:8888/ai-review.html
```
`AI_MOCK_MODE=true` returns an anonymized sample so you can exercise the full
UI → API → form path without consuming quota.

## 6. Netlify local dev (live Gemini)
```
netlify dev
```
Set GEMINI_API_KEY + AI_MOCK_MODE=false in your shell/`.env` first.

## 7. Direct Netlify deployment (no GitHub)
1. `zip -r talent-nexus-ai-page-netlify.zip . -x node_modules/\* .env`
2. Netlify dashboard → **Add new site → Deploy manually** → drag the zip.
   (Or drag the unzipped folder.)
3. Site settings → Environment → add the variables from `.env.example`.
4. Functions auto-deploy from `netlify/functions`.

## 8. API endpoint
`POST /.netlify/functions/resume-ai-parse`

Request:
```json
{ "source": "104", "resumeText": "...", "resumeHtml": "...", "currentPinpinFields": {} }
```

Response (success):
```json
{ "ok": true, "requestId": "...", "model": "gemini-3.5-flash-lite",
  "resume": { "candidate": {...}, "experience": [...], "education": [...], ... },
  "warnings": [], "meta": { "experienceCount": 2, "educationCount": 1 } }
```
Response (failure):
```json
{ "ok": false, "requestId": "...", "error": { "code": "...", "message": "..." } }
```

## 9. Health
`GET /.netlify/functions/health` →
`{ "ok": true, "service": "Talent Nexus Resume AI", "geminiConfigured": true, "auth": "TEST ONLY" }`

## 10. CORS
Test: reflects any origin (set `lib/cors.mjs` `TEST_OPEN_CORS=false` for prod
and populate `ALLOWED_ORIGINS` with exact origins).

## 11. Authentication status
`TEST ONLY` (default) / `INTERFACE ONLY`. No production M365/TNT identity in
this phase — see `docs/AI_SECURITY.md`. A real Connector token is a Codex task.

**Deploy-test auth (AI_TEST_TOKEN):** when `GEMINI_API_KEY` is set, the
`resume-ai-parse` function REQUIRES `Authorization: Bearer <AI_TEST_TOKEN>`.
This is TEST authentication only — a single shared secret, enough to avoid an
open Gemini proxy, not production-grade. The Health endpoint never reveals the
token. In pure-mock mode (`AI_MOCK_MODE=true`, no key) no token is required.

## 12. Mock mode
`AI_MOCK_MODE=true` → anonymized structured JSON, no Gemini call.

## 13. Security
- GEMINI_API_KEY is server-side only; never in the page, extension, or source.
- Logs carry request id / source / model / counts only — never resume content.
- Stateless; no resume data persisted.

## 14. Gemini config
`GEMINI_MODEL` is read from env (no hardcoding in frontend). Structured Output
via `responseSchema` in `lib/gemini-client.mjs`; validated in
`lib/validate-resume.mjs` before returning.

## 15. Known limitations
- Industry/Status/Folder are Pinpin taxonomies; the parser leaves them to the
  recruiter (not invented by AI).
- Experience/education rich editing is in the page; the Chrome Save path applies
  identity (Name/Phone/Email) to Pinpin New Talent in this build.
- Live Gemini + real 104/LinkedIn not exercised in the build environment.
