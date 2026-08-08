// ai-page-netlify/src/ai-review/app.js
import { emptyResume } from './resume-schema.js';
import { renderForm } from './form-renderer.js';
import { parseResume, health, DEFAULT_API } from './api-client.js';

const state = { resume: emptyResume(), apiBase: DEFAULT_API };

function $(id) { return document.getElementById(id); }

async function doParse() {
  const text = $('input-text').value.trim();
  const html = $('input-html').value.trim();
  $('status').textContent = 'Parsing…';
  $('status').style.color = '#b9b9b9';
  const { status, json } = await parseResume(state.apiBase, {
    source: $('source').value || 'unknown',
    resumeText: text,
    resumeHtml: html,
    currentPinpinFields: {}
  });
  if (json.ok) {
    state.resume = json.resume;
    $('status').textContent = `Complete · model=${json.model || '?'} · exp=${json.resume.experience.length} edu=${json.resume.education.length}`;
    $('status').style.color = '#2bd4a8';
    $('json').textContent = JSON.stringify(json.resume, null, 2);
  } else {
    $('status').textContent = `Error ${status}: ${(json.error && json.error.message) || 'unknown'}`;
    $('status').style.color = '#ff6b6b';
    $('json').textContent = JSON.stringify(json, null, 2);
  }
  draw();
}

function draw() {
  $('form').innerHTML = renderForm(state.resume);
  const bindRk = (inp) => {
    inp.addEventListener('input', () => {
      const parts = inp.dataset.rk.split('.');
      let o = state.resume; for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]] = o[parts[i]] || {};
      o[parts[parts.length - 1]] = inp.value === '' ? null : inp.value;
    });
  };
  $('form').querySelectorAll('[data-rk]').forEach(bindRk);
  // experience
  $('form').querySelectorAll('[data-xp]').forEach(inp => {
    const i = +inp.dataset.xp, f = inp.dataset.f;
    inp.addEventListener('input', () => { state.resume.experience[i] = state.resume.experience[i] || {}; state.resume.experience[i][f] = inp.type === 'checkbox' ? inp.checked : (inp.value === '' ? null : inp.value); });
  });
  // education
  $('form').querySelectorAll('[data-ed]').forEach(inp => {
    const i = +inp.dataset.ed, f = inp.dataset.f;
    inp.addEventListener('input', () => { state.resume.education[i] = state.resume.education[i] || {}; state.resume.education[i][f] = inp.value === '' ? null : inp.value; });
  });
  // lists (skills/languages/certifications)
  $('form').querySelectorAll('[data-list]').forEach(inp => {
    const k = inp.dataset.list;
    inp.addEventListener('input', () => { state.resume[k] = inp.value.split(',').map(s => s.trim()).filter(Boolean); });
  });
}

async function checkHealth() {
  const h = await health(state.apiBase);
  $('health').textContent = h.ok ? `health ok · geminiConfigured=${h.geminiConfigured} · mock=${h.mockMode} · auth=${h.auth}` : 'health unreachable';
}

window.addEventListener('DOMContentLoaded', () => {
  $('btn-parse').addEventListener('click', doParse);
  $('btn-reset').addEventListener('click', () => { state.resume = emptyResume(); $('json').textContent = ''; draw(); });
  $('btn-copy').addEventListener('click', () => {
    navigator.clipboard && navigator.clipboard.writeText($('json').textContent);
  });
  $('api-base').value = state.apiBase;
  $('api-base').addEventListener('change', e => { state.apiBase = e.target.value; });
  $('btn-health').addEventListener('click', checkHealth);
  // load sample
  $('btn-sample').addEventListener('click', () => {
    $('input-text').value = SAMPLE_TC;
    $('source').value = '104';
  });
  draw();
  checkHealth();
});

const SAMPLE_TC =
`ANON-TEST-001  男  38歲
現職：Example Corp | FAE Application Engineer
學歷：Example University | Information Management Bachelor
New Taipei City | 11~12年工作經驗 | 希望職稱：System Maintenance Engineer
經歷：
2019/03 - 至今  Example Corp  FAE Application Engineer  Led industrial-automation project rollouts and customer technical support.
2014/07 - 2019/02  Sample Systems Inc  Software Engineer  Backend service development and operations.
技能：JavaScript, Python, SQL
語言：Chinese, English`;
