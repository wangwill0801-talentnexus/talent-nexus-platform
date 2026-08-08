// ai-page-netlify/src/ai-review/form-renderer.js
// Renders the Standard Resume JSON into editable form fields. Edits flow back
// into `state.resume` (see app.js wiring) so JSON output and re-render keep
// the recruiter's changes.
import { RESUME_FIELDS, getPath } from './resume-schema.js';

function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

export function renderForm(resume) {
  const buf = [];
  const section = (title, fields) => {
    buf.push(`<fieldset style="border:1px solid #2bd4a8;border-radius:8px;margin:8px 0;padding:8px;"><legend style="color:#2bd4a8;padding:0 6px;">${esc(title)}</legend>`);
    for (const f of fields) {
      buf.push(`<label style="display:block;margin:4px 0;">${esc(f.label)}<input data-rk="${esc(f.key)}" value="${esc(getPath(resume, f.path) || '')}" style="width:100%;box-sizing:border-box;padding:4px;"></label>`);
    }
    buf.push('</fieldset>');
  };
  section('Basic Information', RESUME_FIELDS.basic);
  section('Current Employment', RESUME_FIELDS.current);

  buf.push(`<fieldset style="border:1px solid #2bd4a8;border-radius:8px;margin:8px 0;padding:8px;"><legend style="color:#2bd4a8;padding:0 6px;">Summary</legend>`);
  buf.push(`<textarea data-rk="summary" style="width:100%;box-sizing:border-box;height:60px;">${esc(resume.summary || '')}</textarea></fieldset>`);

  buf.push(`<fieldset style="border:1px solid #2bd4a8;border-radius:8px;margin:8px 0;padding:8px;"><legend style="color:#2bd4a8;padding:0 6px;">Experience (${resume.experience.length})</legend>`);
  resume.experience.forEach((e, i) => {
    buf.push(`<div style="border-top:1px dashed #2bd4a8;margin-top:6px;padding-top:6px;">#${i + 1} ` +
      `<input data-xp="${i}" data-f="company" value="${esc(e.company || '')}" placeholder="Company" style="width:48%"> ` +
      `<input data-xp="${i}" data-f="title" value="${esc(e.title || '')}" placeholder="Title" style="width:48%"><br>` +
      `<input data-xp="${i}" data-f="startDate" value="${esc(e.startDate || '')}" placeholder="Start" style="width:22%"> ` +
      `<input data-xp="${i}" data-f="endDate" value="${esc(e.endDate || '')}" placeholder="End" style="width:22%"> ` +
      `<label><input type="checkbox" data-xp="${i}" data-f="isCurrent" ${e.isCurrent ? 'checked' : ''}> current</label><br>` +
      `<textarea data-xp="${i}" data-f="description" placeholder="Description" style="width:100%;height:40px;">${esc(e.description || '')}</textarea></div>`);
  });
  buf.push('</fieldset>');

  buf.push(`<fieldset style="border:1px solid #2bd4a8;border-radius:8px;margin:8px 0;padding:8px;"><legend style="color:#2bd4a8;padding:0 6px;">Education (${resume.education.length})</legend>`);
  resume.education.forEach((e, i) => {
    buf.push(`<div style="border-top:1px dashed #2bd4a8;margin-top:6px;padding-top:6px;">#${i + 1} ` +
      `<input data-ed="${i}" data-f="school" value="${esc(e.school || '')}" placeholder="School" style="width:32%"> ` +
      `<input data-ed="${i}" data-f="major" value="${esc(e.major || '')}" placeholder="Major" style="width:32%"> ` +
      `<input data-ed="${i}" data-f="degree" value="${esc(e.degree || '')}" placeholder="Degree" style="width:32%"><br>` +
      `<input data-ed="${i}" data-f="startDate" value="${esc(e.startDate || '')}" placeholder="Start" style="width:48%"> ` +
      `<input data-ed="${i}" data-f="endDate" value="${esc(e.endDate || '')}" placeholder="End" style="width:48%"></div>`);
  });
  buf.push('</fieldset>');

  buf.push(`<fieldset style="border:1px solid #2bd4a8;border-radius:8px;margin:8px 0;padding:8px;"><legend style="color:#2bd4a8;padding:0 6px;">Lists (comma-separated)</legend>`);
  buf.push(`<label style="display:block;margin:4px 0;">Skills<input data-list="skills" value="${esc((resume.skills || []).join(', '))}" style="width:100%;box-sizing:border-box;padding:4px;"></label>`);
  buf.push(`<label style="display:block;margin:4px 0;">Languages<input data-list="languages" value="${esc((resume.languages || []).join(', '))}" style="width:100%;box-sizing:border-box;padding:4px;"></label>`);
  buf.push(`<label style="display:block;margin:4px 0;">Certifications<input data-list="certifications" value="${esc((resume.certifications || []).join(', '))}" style="width:100%;box-sizing:border-box;padding:4px;"></label>`);
  buf.push('</fieldset>');

  return buf.join('');
}
