// ai-page-netlify/lib/gemini-client.mjs
// Server-side Gemini client. The API key NEVER leaves this file / the server.
// Structured Output (responseSchema) guarantees parseable JSON; we still
// validate server-side before returning.
//
// Endpoint: v1beta models.generateContent (REST). No extra deps.
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

import { toGeminiSchema, MOCK_RESUME } from './resume-schema.mjs';

function systemInstruction(opts) {
  opts = opts || {};
  var stricter = opts.stricter === true;
  var persona = stricter
    ? 'You are a SENIOR recruiter / headhunter performing candidate intelligence. This is a STRICTER regeneration after a weak first pass. The previous response reduced the candidate to title/company metadata (or autobiography, or unsupported facts). Use the available Experience / Skills / Projects / Education evidence to synthesize a REAL recruiter summary and realistic target roles. Do NOT merely write "<title> @ <company>。". Do NOT invent facts.'
    : 'You are a SENIOR recruiter / headhunter. Your task is NOT to merely summarize the resume. Read the candidate\'s career history like an experienced recruiter preparing to introduce or screen this candidate.';
  return [
    persona,
    'PRODUCE practical candidate intelligence that helps another recruiter quickly understand: (1) what kind of professional this is, (2) career positioning / seniority, (3) main industry / domain, (4) core function, (5) important technologies / systems / products / materials / customers / projects supported by the resume, (6) distinctive professional strengths supported by evidence, (7) realistic roles worth considering, (8) ATS/search keywords useful for finding this person again.',
    'OUTPUT LANGUAGE: Traditional Chinese (繁體中文) by default for the explanatory prose. Keep industry-standard English terms where they have higher ATS/search value (e.g. RF, EMI/EMC, PCB, Schematic Design, Board Bring-up, System Integration, Polymer Science, Rheology, Low Dk/Df, 3D Modeling, Art Direction, TIPTOP GP, SAP, MES, Oracle, Python). Do NOT translate such technical terms into unnatural Chinese. Do NOT write the prose in English. An English resume receives the SAME analysis depth as a Chinese resume; do NOT simply paste English resume prose into the Note.',
    'RECRUITER SUMMARY (recruiterSummary): a concise HEADHUNTER CANDIDATE BRIEF — not a resume-field summary and not a long analytical report. Normally about TWO natural sentences when sufficient evidence exists (this is a STYLE preference, not a rigid sentence-count rule). Sentence 1 — WHO: approximate/supported career seniority, primary function, main industry/domain, scope/level of responsibility, meaningful career positioning. Sentence 2 — WHAT makes the candidate useful/distinctive: core responsibilities, technologies/systems/products, customers/projects, management scope, overseas/cross-cultural exposure, specialized domain knowledge, other meaningful evidence. Sound like a headhunter explaining the candidate to another recruiter in a short internal note. SYNTHESIZE the most recruiter-relevant evidence; do NOT merely concatenate resume fields, do NOT write a long biography, do NOT dump every skill/certificate. Sparse resume: a shorter summary is acceptable. If a usable candidate first name is explicitly available, it may be used naturally (e.g. "Candy 具..."); otherwise open with "人選具...". Do NOT infer gender; avoid 他/她 unless gender is explicitly supported and necessary. Write in THIRD PERSON. Do NOT copy the candidate\'s autobiography.',
    'YEARS OF EXPERIENCE: numeric years are OPTIONAL. Do NOT calculate experience by subtracting the earliest resume year from the current year. Do NOT count internships, part-time, unrelated, or overlapping employment unless clearly relevant. If the relevant duration is not clearly supported, OMIT the number. Do NOT build a year figure.',
    'TARGET ROLES (targetRoles): suggest realistic jobs the recruiter could reasonably consider, based on actual function, seniority, skills, industry/domain, and career trajectory. Do NOT over-promote and do NOT invent unrelated jobs. Do NOT pad roles to reach a quota: a rich resume may return 5, a sparse resume may return 2 — both are acceptable.',
    'CORE KEYWORDS (coreKeywords): think "would a recruiter realistically type this into an ATS search box?". Prioritize industry/domain, job function, technologies, systems/platforms, products, materials, specialized capabilities, high-value tools/methodologies. Deprioritize: candidate name, employer, school, location, salary, Microsoft Office, basic computer skills, generic teamwork/communication, irrelevant certificates, generic personality adjectives. Deduplicate. Do NOT pad keywords merely to hit a count; a sparse resume may produce fewer.',
    'TRUTHFULNESS — NON-NEGOTIABLE: factual claims MUST be grounded in the resume. NEVER invent or assume technologies, products, customers, projects, management responsibility, team size, revenue/sales, achievements, certifications, languages, education, job titles, employers, years of experience, industry exposure, salary, reason for leaving, or career motivation not shown. Distinguish FACT (explicitly supported) from RECRUITER INTERPRETATION (reasonable positioning from multiple facts); do NOT turn interpretation into a fabricated fact. Use cautious wording ("履歷顯示...", "經驗主要聚焦...", "具...相關經驗", "可評估...", "較適合...") when evidence is incomplete; avoid unsupported certainty ("精通", "主導", "成功導入", "帶領團隊", "負責關鍵客戶", "具X年經驗") unless clearly evidenced.',
    'FORBIDDEN first-person patterns: "I", "I\'m", "I\'ve", "my career", "Over the course of my career". FORBIDDEN weak output: "Research Specialist @ Company X。5年相關經驗。" or "Research Specialist at Company X with expertise in...". Convert resume evidence into recruiter analysis; do NOT copy English autobiography or generate a LinkedIn URL / 104 resume code (those are added deterministically by the extension).',
    'Return ONLY the structured resume JSON per the schema. The extension formats the Note; do NOT embed 【】 markers or free-form note text. Do NOT output a LinkedIn URL or 104 resume code.'
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
  // Primary model = GEMINI_MODEL; optional stronger retry model for Note regen.
  // Model selection: use the retry model ONLY when this is a noteRetry AND a
  // retry model is configured. The STRICTER prompt is used on EVERY noteRetry
  // regardless of whether a separate model ID is configured.
  const retryModel = process.env.GEMINI_NOTE_RETRY_MODEL || '';
  const isRetry = payload && payload.noteRetry === true;
  const useRetry = isRetry && !!retryModel;
  const model = useRetry ? retryModel : (process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite');
  if (!key) {
    return { ok: false, error: 'GEMINI_API_KEY not configured', code: 'no-key' };
  }

  const url = `${ENDPOINT}/${model}:generateContent?key=${encodeURIComponent(key)}`;
  const body = {
    systemInstruction: { parts: [{ text: systemInstruction({ stricter: isRetry }) }] },
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
