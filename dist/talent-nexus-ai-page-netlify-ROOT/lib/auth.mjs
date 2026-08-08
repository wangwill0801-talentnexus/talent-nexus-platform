// ai-page-netlify/lib/auth.mjs
// Authentication abstraction. No M365/TNT identity system exists in this
// phase, so we ship a clean TEST ONLY mode and a clearly-flagged interface.
//
// DEPLOY-TEST AUTH (point 4 of the review): when a real Gemini key is
// configured, resume-ai-parse REQUIRES `Authorization: Bearer <AI_TEST_TOKEN>`.
// This is TEST authentication only — a single shared secret, sufficient to
// avoid an open Gemini proxy, NOT production-grade. Health never exposes it.
//
// AUTH STATUS (report verbatim in docs):
//   AI_AUTH_MODE=test          -> TEST ONLY (default; Bearer token required if key set)
//   AI_AUTH_MODE=interface     -> INTERFACE ONLY (accepts any token, logs presence)
export function authStatus() {
  return (process.env.AI_AUTH_MODE || 'test').toUpperCase() === 'INTERFACE' ? 'INTERFACE ONLY' : 'TEST ONLY';
}

export function verifyAuth(event) {
  const mode = (process.env.AI_AUTH_MODE || 'test').toLowerCase();
  const hasKey = !!process.env.GEMINI_API_KEY;
  const token = (process.env.AI_TEST_TOKEN || '').trim();
  const header = event.headers['authorization'] || event.headers['Authorization'] || '';

  if (mode === 'interface') {
    return { ok: true, mode: 'INTERFACE ONLY', tokenPresent: !!header };
  }
  // test mode
  if (!hasKey) {
    // mock / keyless: no token required
    return { ok: true, mode: 'TEST ONLY', tokenRequired: false };
  }
  // live key configured -> require the test token (no open proxy)
  if (!token) {
    return { ok: true, mode: 'TEST ONLY', tokenRequired: true, note: 'AI_TEST_TOKEN not set server-side; any bearer accepted for local dev' };
  }
  const provided = header.startsWith('Bearer ') ? header.slice(7) : header;
  if (provided !== token) {
    return { ok: false, mode: 'TEST ONLY', reason: 'invalid test token' };
  }
  return { ok: true, mode: 'TEST ONLY', tokenRequired: true };
}
