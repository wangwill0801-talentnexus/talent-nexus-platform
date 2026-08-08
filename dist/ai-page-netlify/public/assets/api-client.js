// ai-page-netlify/src/ai-review/api-client.js
// Talks to the Netlify function. Base URL is configurable (local vs deployed).
export const DEFAULT_API = (typeof window !== 'undefined' && window.TNAI_API_BASE_URL) || 'http://localhost:8888';

export async function parseResume(apiBase, payload) {
  const url = String(apiBase).replace(/\/$/, '') + '/.netlify/functions/resume-ai-parse';
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    credentials: 'omit'
  });
  let json;
  try { json = await res.json(); } catch (e) { json = { ok: false, error: { message: 'non-JSON response' } }; }
  return { status: res.status, json };
}

export async function health(apiBase) {
  const url = String(apiBase).replace(/\/$/, '') + '/.netlify/functions/health';
  const res = await fetch(url, { method: 'GET' });
  return res.json().catch(() => ({}));
}
