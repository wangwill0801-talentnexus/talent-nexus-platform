# AI Security

- GEMINI_API_KEY server-side only. Never in extension, content script, HTML,
  manifest, localStorage, source zip, or .env.example.
- Logs: request id, source, model, duration, counts only. Never resume text,
  name, phone, email, PII. Backend response omits raw resume.
- CORS: TEST_ONLY reflects origin (lib/cors.mjs TEST_OPEN_CORS). Production:
  set ALLOWED_ORIGINS + flip TEST_OPEN_CORS=false.
- Auth: TEST ONLY (default) / INTERFACE ONLY. When GEMINI_API_KEY is set,
  resume-ai-parse requires `Authorization: Bearer <AI_TEST_TOKEN>` — a single
  test secret, enough to avoid an open Gemini proxy, NOT production auth.
  Health never reveals the token. M365/TNT production auth is a Codex task.
- No PII fixtures: all samples use ANON-TEST-001 / Example Corp / Example
  University / example.invalid.
- Stateless; no resume data persisted.
