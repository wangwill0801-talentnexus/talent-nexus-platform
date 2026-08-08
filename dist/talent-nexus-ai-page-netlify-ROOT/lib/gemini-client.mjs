// ai-page-netlify/lib/gemini-client.mjs
// Server-side Gemini client. The API key NEVER leaves this file / the server.
// Structured Output (responseSchema) guarantees parseable JSON; we still
// validate server-side before returning.
//
// Endpoint: v1beta models.generateContent (REST). No extra deps.
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

import { toGeminiSchema, MOCK_RESUME } from './resume-schema.mjs';

function systemInstruction() {
  return [
    'You are a resume parser for Taiwanese recruitment (Traditional Chinese resumes).',
    'Extract structured candidate data from the provided resume text/HTML.',
    'CRITICAL — no hallucination: if a field is not present, return null (string fields) or [] (arrays).',
    'Do NOT infer or fabricate: phone, email, age, gender, salary, exact dates, degree, company, title, or location.',
    'Use the resume content itself. Do not use any pre-existing Pinpin values as truth.',
    'Preserve original Traditional Chinese text for names, companies and titles.',
    'isCurrent=true only when the experience entry is clearly the current/ongoing job.'
  ].join(' ');
}

function userPrompt(payload) {
  const parts = [];
  parts.push('Source platform: ' + (payload.source || 'unknown'));
  if (payload.resumeText) parts.push('RESUME TEXT:\n' + payload.resumeText);
  if (payload.resumeHtml) parts.push('RESUME HTML (may contain markup):\n' + payload.resumeHtml);
  parts.push('Return ONLY the structured resume JSON per the schema.');
  return parts.join('\n\n');
}

export async function callGemini(payload) {
  // Mock mode — no key, no network. Useful for offline / quota-free testing.
  if (process.env.AI_MOCK_MODE === 'true') {
    return { ok: true, model: 'mock', resume: JSON.parse(JSON.stringify(MOCK_RESUME)), warnings: [] };
  }

  const key = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
  if (!key) {
    return { ok: false, error: 'GEMINI_API_KEY not configured', code: 'no-key' };
  }

  const url = `${ENDPOINT}/${model}:generateContent?key=${encodeURIComponent(key)}`;
  const body = {
    systemInstruction: { parts: [{ text: systemInstruction() }] },
    contents: [{ role: 'user', parts: [{ text: userPrompt(payload) }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: toGeminiSchema(),
      temperature: 0.2
    }
  };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Number(process.env.GEMINI_TIMEOUT_MS || 30000));
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: (data.error && data.error.message) || ('Gemini HTTP ' + res.status), code: 'gemini-error' };
    }
    const cand = data.candidates && data.candidates[0];
    if (!cand) return { ok: false, error: 'Gemini returned no candidates', code: 'no-candidate' };
    if (cand.finishReason && cand.finishReason !== 'STOP' && cand.finishReason !== 'MAX_TOKENS') {
      return { ok: false, error: 'Gemini finishReason: ' + cand.finishReason, code: 'finish-' + cand.finishReason };
    }
    const text = (cand.content && cand.content.parts && cand.content.parts[0] && cand.content.parts[0].text) || '';
    let parsed;
    try { parsed = JSON.parse(text); }
    catch (e) { return { ok: false, error: 'Gemini output was not valid JSON', code: 'bad-json' }; }
    return { ok: true, model, resume: parsed, warnings: [] };
  } catch (e) {
    return { ok: false, error: 'Gemini request failed: ' + (e && e.message || e), code: 'request-failed' };
  } finally {
    clearTimeout(timer);
  }
}
