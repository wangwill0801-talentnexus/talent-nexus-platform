// ai-page-netlify/lib/validate-resume.mjs
// Server-side validation of the Standard Resume JSON returned by Gemini.
// Strict-ish but tolerant: we accept what Gemini gives, coerce arrays, and
// reject only structurally impossible input. We never fail on "missing"
// fields (null is fine — see no-hallucination rule in the master prompt).
import { STANDARD_RESUME_JSON_SCHEMA } from './resume-schema.mjs';

function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }
function asStr(v) {
  if (v === null || v === undefined) return null;
  var s = String(v).trim();
  return s.length ? s : null;   // empty -> null (no-hallucination rule)
}
function asArr(v) { return Array.isArray(v) ? v : []; }

export function validateResume(r) {
  const warnings = [];
  if (!isObj(r) || !isObj(r.candidate)) {
    return { ok: false, error: 'resume.candidate must be an object', warnings };
  }
  const out = {
    candidate: {
      name: asStr(r.candidate.name),
      phone: asStr(r.candidate.phone),
      email: asStr(r.candidate.email),
      location: asStr(r.candidate.location)
    },
    currentEmployment: isObj(r.currentEmployment)
      ? { company: asStr(r.currentEmployment.company), title: asStr(r.currentEmployment.title) }
      : null,
    experience: asArr(r.experience).map(e => isObj(e) ? {
      company: asStr(e.company),
      title: asStr(e.title),
      startDate: asStr(e.startDate),
      endDate: asStr(e.endDate),
      isCurrent: e.isCurrent === true,
      description: asStr(e.description)
    } : null).filter(Boolean),
    education: asArr(r.education).map(e => isObj(e) ? {
      school: asStr(e.school),
      degree: asStr(e.degree),
      major: asStr(e.major),
      startDate: asStr(e.startDate),
      endDate: asStr(e.endDate)
    } : null).filter(Boolean),
    skills: asArr(r.skills).map(asStr).filter(Boolean),
    languages: asArr(r.languages).map(asStr).filter(Boolean),
    certifications: asArr(r.certifications).map(asStr).filter(Boolean),
    jobPreferences: asStr(r.jobPreferences),
    summary: asStr(r.summary)
  };
  // no identity fields present -> warn (not error; null is acceptable)
  if (!out.candidate.name && !out.candidate.phone && !out.candidate.email) {
    warnings.push('no identity fields present (name/phone/email all empty)');
  }
  return { ok: true, resume: out, warnings };
}

// Reference only — the JSON-Schema shape used by external validators.
export const JSON_SCHEMA = STANDARD_RESUME_JSON_SCHEMA;
