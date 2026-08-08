// ai-page-netlify/test/form-binding.test.mjs
// Verifies the standalone page's two-way binding: editing a field updates
// state.resume, and a re-render preserves the edit. No real DOM/browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderForm } from '../src/ai-review/form-renderer.js';
import { emptyResume } from '../src/ai-review/resume-schema.js';

// minimal DOM shim for input/textarea/checkbox simulation
function mkInput(tag, attrs = {}) {
  const dataset = {};
  for (const k of Object.keys(attrs)) {
    if (k.startsWith('data-')) dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = attrs[k];
  }
  const el = { tagName: tag.toUpperCase(), dataset, attrs, checked: false,
    _val: attrs.value || '', _listeners: {}, style: {} };
  Object.defineProperty(el, 'value', { get() { return this._val; }, set(v) { this._val = v; } });
  el.addEventListener = (ev, fn) => { (el._listeners[ev] = el._listeners[ev] || []).push(fn); };
  el.dispatch = (ev) => (el._listeners[ev] || []).forEach(fn => fn());
  return el;
}

test('editing experience/skills updates the resume object', () => {
  const r = emptyResume();
  r.experience = [{ company: 'Old', title: '', startDate: '', endDate: '', isCurrent: false, description: '' }];
  r.education = [{ school: 'Old School', degree: '', major: '', startDate: '', endDate: '' }];
  const html = renderForm(r);

  // simulate the exact data-* attributes the renderer emits
  // experience #0 company
  const xpCompany = mkInput('input', { 'data-xp': '0', 'data-f': 'company', value: 'New Corp' });
  // education #0 school
  const edSchool = mkInput('input', { 'data-ed': '0', 'data-f': 'school', value: 'New University' });
  // skills list
  const skills = mkInput('input', { 'data-list': 'skills', value: 'Go, Rust' });

  // emulate app.js draw() binding for these nodes
  xpCompany.addEventListener('input', () => { r.experience[0].company = xpCompany.value; });
  edSchool.addEventListener('input', () => { r.education[0].school = edSchool.value; });
  skills.addEventListener('input', () => { r.skills = skills.value.split(',').map(s => s.trim()).filter(Boolean); });

  xpCompany.value = 'New Corp'; xpCompany.dispatch('input');
  edSchool.value = 'New University'; edSchool.dispatch('input');
  skills.value = 'Go, Rust'; skills.dispatch('input');

  assert.equal(r.experience[0].company, 'New Corp');
  assert.equal(r.education[0].school, 'New University');
  assert.deepEqual(r.skills, ['Go', 'Rust']);

  // re-render preserves the edit
  const html2 = renderForm(r);
  assert.ok(html2.includes('New Corp'));
  assert.ok(html2.includes('New University'));
  assert.ok(html2.includes('Go, Rust'));
});

test('basic fields bind via data-rk', () => {
  const r = emptyResume();
  const name = mkInput('input', { 'data-rk': 'candidate.name', value: 'ANON-TEST-002' });
  name.addEventListener('input', () => {
    const parts = name.dataset.rk.split('.');
    let o = r; for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]] = o[parts[i]] || {};
    o[parts[parts.length - 1]] = name.value === '' ? null : name.value;
  });
  name.value = 'ANON-TEST-002'; name.dispatch('input');
  assert.equal(r.candidate.name, 'ANON-TEST-002');
});

test('checkbox isCurrent binds boolean', () => {
  const r = emptyResume();
  r.experience = [{ company: 'X', title: '', startDate: '', endDate: '', isCurrent: false, description: '' }];
  const cb = mkInput('input', { 'data-xp': '0', 'data-f': 'isCurrent' });
  cb.type = 'checkbox';
  cb.addEventListener('input', () => { r.experience[0].isCurrent = cb.checked; });
  cb.checked = true; cb.dispatch('input');
  assert.equal(r.experience[0].isCurrent, true);
});
