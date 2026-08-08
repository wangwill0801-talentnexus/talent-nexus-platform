// ai-page-netlify/netlify/functions/resume-ai-parse.mjs
import { handleCors } from '../../lib/cors.mjs';
import { verifyAuth, authStatus } from '../../lib/auth.mjs';
import { callGemini } from '../../lib/gemini-client.mjs';
import { validateResume } from '../../lib/validate-resume.mjs';

function rid() {
  return 'r-' + Date.now().toString(36) + '-' + Math.random().toString().slice(2, 8);
}
function json(status, body, origin) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json', ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}) },
    body: JSON.stringify(body)
  };
}

export const handler = async (event) => {
  const cors = handleCors(event);
  if (cors) return cors;
  const origin = event.headers.origin;

  const auth = verifyAuth(event);
  if (!auth.ok) {
    return json(401, { ok: false, requestId: rid(), error: { code: 'auth', message: 'unauthorized' } }, origin);
  }

  if (event.httpMethod !== 'POST') {
    return json(405, { ok: false, requestId: rid(), error: { code: 'method', message: 'POST required' } }, origin);
  }

  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch (e) { return json(400, { ok: false, requestId: rid(), error: { code: 'bad-json', message: 'invalid request body' } }, origin); }

  if (!payload.resumeText && !payload.resumeHtml) {
    return json(400, { ok: false, requestId: rid(), error: { code: 'empty', message: 'resumeText or resumeHtml required' } }, origin);
  }

  const started = Date.now();
  const g = await callGemini({
    source: payload.source,
    resumeText: payload.resumeText,
    resumeHtml: payload.resumeHtml,
    currentPinpinFields: payload.currentPinpinFields,
    noteRetry: payload.noteRetry === true
  });

  if (!g.ok) {
    return json(502, {
      ok: false,
      requestId: rid(),
      error: { code: g.code || 'gemini', message: g.error }
    }, origin);
  }

  const v = validateResume(g.resume);
  if (!v.ok) {
    return json(422, {
      ok: false,
      requestId: rid(),
      error: { code: 'validation', message: v.error }
    }, origin);
  }

  // Privacy: do NOT echo the raw resume text/html back. Only the structured
  // result, model, and a count-based summary.
  return json(200, {
    ok: true,
    requestId: rid(),
    model: g.model,
    auth: authStatus(),
    resume: v.resume,
    warnings: v.warnings,
    meta: {
      source: payload.source || null,
      durationMs: Date.now() - started,
      experienceCount: v.resume.experience.length,
      educationCount: v.resume.education.length
    }
  }, origin);

};
