// ai-page-netlify/src/ai-review/resume-schema.js
// Browser-side mirror of lib/resume-schema.mjs (field naming only — the page
// uses this for rendering and local comparison; the authoritative parse +
// validation happens server-side).
export const RESUME_FIELDS = {
  basic: [
    { key: 'candidate.name', label: 'Name', path: ['candidate', 'name'] },
    { key: 'candidate.phone', label: 'Phone', path: ['candidate', 'phone'] },
    { key: 'candidate.email', label: 'Email', path: ['candidate', 'email'] },
    { key: 'candidate.location', label: 'Location', path: ['candidate', 'location'] }
  ],
  current: [
    { key: 'currentEmployment.company', label: 'Company', path: ['currentEmployment', 'company'] },
    { key: 'currentEmployment.title', label: 'Title', path: ['currentEmployment', 'title'] }
  ]
};

export function emptyResume() {
  return {
    candidate: { name: null, phone: null, email: null, location: null },
    currentEmployment: { company: null, title: null },
    experience: [],
    education: [],
    skills: [],
    languages: [],
    certifications: [],
    jobPreferences: null,
    summary: null
  };
}

export function getPath(obj, path) {
  return path.reduce((o, k) => (o == null ? o : o[k]), obj);
}
export function setPath(obj, path, val) {
  let o = obj;
  for (let i = 0; i < path.length - 1; i++) o = o[path[i]] = o[path[i]] || {};
  o[path[path.length - 1]] = val;
}
