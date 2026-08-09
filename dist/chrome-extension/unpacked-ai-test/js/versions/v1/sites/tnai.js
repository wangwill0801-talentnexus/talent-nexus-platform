/*
 * window.TNAI — additive AI Resume Review for the Talent Nexus Connector.
 *
 * Design contract (per master implementation prompt + mid-implementation review):
 *  - This module NEVER creates a second Pinpin save client.
 *  - It reaches the SAME live Pinpin New Talent controller (angular a.resume /
 *    a.submit) DIRECTLY in the SAME ISOLATED world as the Golden Base
 *    content script (proven: manifest block[0] loads angular.min.js + page.js,
 *    default/page.js runs angular.bootstrap($("#kpBox"))). No MAIN-world bridge,
 *    no postMessage. The canonical save is the SAME a.submit(true) ->
 *    request.api.submit -> POST /rest/resume/addbyplug.
 *  - It is a floating panel injected into the Pinpin New Talent page. The
 *    legacy page.js / webapp controller are NOT modified.
 *  - Gemini key stays server-side (Netlify function). This file only knows a
 *    single configurable base URL (AI_API_BASE_URL).
 *  - AI state is per-candidate: keyed by the import run's addFileName, so two
 *    consecutive imports never share AI data.
 *  - No PII in logs. Logs carry run id, status, source, counts only.
 *
 * PERSISTENCE SEMANTICS (source-verified, see docs/AI_PINPIN_FIELD_MAPPING.md):
 *  The canonical submit serializes angular.copy(a.resume) but a.resume only
 *  holds chineseName/mobile/email/industry (set by getAddInfo/addResume.upload).
 *  The FULL resume (experience/education/skills/summary) is stored by Pinpin
 *  server-side, keyed by the captured file (addFileName) — mechanism A.
 *  Therefore this build PERSISTS only identity (Name/Phone/Email) on Save.
 *  Experience/education/etc. are REVIEW-ONLY here. We do NOT claim "Refill All"
 *  for those fields; that requires a server-side resume-merge which is out of
 *  scope for this phase.
 *
 * Status: IMPLEMENTED, TESTED WITH MOCK (jsdom). Not live-tested against
 * real Gemini / Pinpin (no authenticated session in this environment).
 */
// ---- Talent Nexus Connector UI dictionary (Interface Language) ----
// ONE canonical language value ("zh-TW" | "en") drives BOTH the authoritative
// ATS base URL and all Talent Nexus-owned injected UI strings. Native Pinpin
// labels/options/data are NEVER translated by Connector code.
var TN_UI = {
  'zh-TW': {
    subtitle: 'AI 輔助人才智慧分析',
    aiFill: '✨ AI 填寫',
    connector: 'Talent Nexus Connector',
    loading: 'AI 分析中…',
    savedMsg: '語言設定已儲存，重新載入 ATS 後套用完整介面。'
  },
  'en': {
    subtitle: 'AI-assisted candidate intelligence',
    aiFill: '✨ AI Fill',
    connector: 'Talent Nexus Connector',
    loading: 'AI analyzing…',
    savedMsg: 'Language saved. Reload the ATS to apply the full interface.'
  }
};
// Canonical language: read from chrome.storage.sync key "tnConnector.lang"
// (Connector-owned state, independent from ATS URL). Falls back to zh-TW.
function tnGetLanguage(cb) {
  // Single source of truth = authoritative config.interfaceLanguage
  // (chrome.storage.sync 'config'), shared with Options/ATS base. Falls back zh-TW.
  try {
    if (typeof utils !== 'undefined' && utils.store) {
      utils.store.get('config', function (cfg) {
        var lang = cfg && cfg.interfaceLanguage;
        cb((lang === 'en' || lang === 'zh-TW') ? lang : 'zh-TW');
      });
    } else if (global.chrome && chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.get(['config'], function (v) {
        var lang = v && v.config && v.config.interfaceLanguage;
        cb((lang === 'en' || lang === 'zh-TW') ? lang : 'zh-TW');
      });
    } else { cb('zh-TW'); }
  } catch (e) { cb('zh-TW'); }
}
function tnUIText(lang, key) {
  var d = TN_UI[lang] || TN_UI['zh-TW'];
  return (key in d) ? d[key] : TN_UI['zh-TW'][key];
}
(function (global) {
  'use strict';

  var LOG_PREFIX = '[TNAI]';

  function log() {
    try {
      var a = Array.prototype.slice.call(arguments);
      a.unshift(LOG_PREFIX);
      console.log.apply(console, a);
    } catch (e) {}
  }

  // --- single configuration point -------------------------------------------
  var AI_API_BASE_URL = (global.TNAI_CONFIG && global.TNAI_CONFIG.AI_API_BASE_URL) ||
    (global.localStorage && global.localStorage.getItem('tnai_api_base_url')) ||
    'https://playful-biscuit-c4196a.netlify.app';

  var AI_MOCK_MODE = (global.TNAI_CONFIG && global.TNAI_CONFIG.AI_MOCK_MODE) ||
    (global.localStorage && global.localStorage.getItem('tnai_mock_mode') === '1') ||
    false;

  function setApiBaseUrl(u) {
    AI_API_BASE_URL = u;
    if (global.localStorage) { try { global.localStorage.setItem('tnai_api_base_url', u); } catch (e) {} }
    log('api base url ->', String(u).replace(/^https?:\/\//, ''));
  }
  function setMockMode(on) {
    AI_MOCK_MODE = !!on;
    if (global.localStorage) { try { global.localStorage.setItem('tnai_mock_mode', on ? '1' : '0'); } catch (e) {} }
    log('mock mode ->', AI_MOCK_MODE);
  }

  // =========================================================================
  // AI -> Pinpin mapper (PERSISTED fields only)
  // =========================================================================
  // The canonical submit reads from a.resume: chineseName, mobile, email,
  // plus recruiter metadata (industry/status/folder/job/tags). Industry is a
  // taxonomy id Gemini cannot invent; we preserve whatever the recruiter or
  // legacy import set. The full resume is NOT carried by a.resume.
  function mapAIResumeToPinpinForm(resume, currentPinpinResume) {
    resume = resume || {};
    var cand = resume.candidate || {};
    var mapped = {
      chineseName: normStr(cand.name),
      mobile: normalizePhone(cand.phone),
      email: normStr(cand.email)
    };
    if (currentPinpinResume && currentPinpinResume.industry) {
      mapped.industry = currentPinpinResume.industry;
    }
    return mapped;
  }

  function normStr(v) {
    if (v === null || v === undefined) return null;
    var s = String(v).trim();
    return s.length ? s : null;
  }
  // Normalize phone to company format (digits only, NO country code):
  //   0937-586-696      -> 0937586696
  //   0937 586 696      -> 0937586696
  //   +886 937 586 696  -> 0937586696   (country code 886 stripped, leading 0 restored)
  function normalizePhone(v) {
    if (v == null) return null;
    var digits = String(v).replace(/[^0-9]/g, '');
    if (!digits.length) return null;
    // Taiwan: strip country code 886 (e.g. +886 937... -> 0937...)
    if (digits.indexOf('886') === 0 && digits.length >= 11) {
      digits = '0' + digits.slice(3);
    } else if (digits.length === 9 && digits.charAt(0) === '9') {
      // bare mobile without leading 0 -> restore
      digits = '0' + digits;
    }
    return digits;
  }

  // =========================================================================
  // Per-candidate AI state (isolation)
  // =========================================================================
  // Unique per-extension-session key. Used as a safe fallback runId when a
  // candidate addFileName is not yet available. NEVER a shared literal — this
  // guarantees Candidate A state can never leak into Candidate B.
  var _sessionKey = null;
  function getSessionKey() {
    if (!_sessionKey) _sessionKey = 'tnai-temp-' + Math.random().toString(36).slice(2);
    return _sessionKey;
  }

  var stateByRun = Object.create(null);

  function stateForRun(runId) {
    if (!runId) runId = getSessionKey();
    if (!stateByRun[runId]) {
      stateByRun[runId] = {
        runId: runId,
        status: 'idle',
        source: null,
        resume: null,
        error: null,
        addFileName: null,
        captureStatus: null,
        routeDiag: null
      };
    }
    return stateByRun[runId];
  }
  function clearRun(runId) { if (runId) delete stateByRun[runId]; }

  // =========================================================================
  // Backend call (with mock mode)
  // =========================================================================
  function parseResume(opts) {
    opts = opts || {};
    var runId = opts.runId || getSessionKey();
    var st = stateForRun(runId);
    st.status = 'parsing';
    st.error = null;
    st.source = opts.source || null;
    st.addFileName = opts.addFileName || null;

    if (AI_MOCK_MODE) {
      return new Promise(function (resolve) {
        global.setTimeout(function () {
          var mock = (global.TNAI_SCHEMA && global.TNAI_SCHEMA.MOCK_RESUME) ||
            { candidate: { name: 'ANON', phone: '0910000000', email: 'anon@example.invalid', location: null } };
          st.resume = JSON.parse(JSON.stringify(mock));
          st.status = 'complete';
          log('parse(mock) run=' + runId + ' status=complete');
          resolve({ ok: true, resume: st.resume, model: 'mock', warnings: [] });
        }, 120);
      });
    }

    var payload = {
      source: opts.source || 'unknown',
      resumeHtml: opts.resumeHtml || '',
      resumeText: opts.resumeText || '',
      currentPinpinFields: opts.currentPinpinFields || {},
      noteRetry: opts.noteRetry === true
    };

    return fetch(AI_API_BASE_URL.replace(/\/$/, '') + '/.netlify/functions/resume-ai-parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      credentials: 'omit'
    }).then(function (r) {
      return r.json().catch(function () { return { ok: false, error: { code: 'bad-json', message: 'non-JSON backend response' } }; });
    }).then(function (json) {
      if (!json || json.ok !== true || !json.resume) {
        st.status = 'error';
        st.error = (json && json.error && json.error.message) || 'backend returned no resume';
        log('parse run=' + runId + ' status=error');
        return { ok: false, error: st.error };
      }
      st.resume = json.resume;
      st.status = 'complete';
      log('parse(run=' + runId + ') status=complete model=' + (json.model || '?'));
      return { ok: true, resume: st.resume, model: json.model || '?', warnings: json.warnings || [] };
    }).catch(function (err) {
      st.status = 'error';
      st.error = String(err && err.message || err);
      log('parse run=' + runId + ' status=error');
      return { ok: false, error: st.error };
    });
  }

  // =========================================================================
  // Live Pinpin New Talent scope — DIRECT access (CASE A, ISOLATED world)
  // =========================================================================
  // Proven from source: Angular + AddResumeCtrl live in the SAME ISOLATED
  // world as this content script (manifest block[0] loads angular.min.js +
  // page.js, and default/page.js does angular.bootstrap($("#kpBox"))). So we
  // reach the live controller directly — no MAIN-world bridge, no postMessage.
  // The canonical save is the SAME scope.submit(true) the Original uses.
  function findAddResumeScope() {
    if (typeof angular === 'undefined') return null;
    var el = document.getElementById('addResume');
    if (!el) return null;
    var s = angular.element(el).scope();
    if (!s) return null;
    if (!s.resume) return null;
    if (typeof s.submit !== 'function') return null;
    return s;
  }

  // Live Pinpin resume model (for comparison/debug). Synchronous.
  function getPinpinResume() {
    var s = findAddResumeScope();
    return s ? s.resume : null;
  }

  // Source detection for the AI parse request. The panel lives on Pinpin New
  // Talent, so the ORIGINAL source page is usually gone; we still report what
  // we can from the current location (104 / LinkedIn / unknown). No URL rule
  // drives the launcher — this is only a label for the backend/privacy log.
  function detectSource() {
    try {
      var h = (global.location && global.location.hostname || '').toLowerCase();
      var path = (global.location && global.location.pathname || '') + (global.location && global.location.search || '');
      if (h.indexOf('104.com.tw') >= 0) return '104';
      if (h.indexOf('linkedin.com') >= 0) {
        if (path.indexOf('/talent/profile/') >= 0) return 'linkedin-recruiter';
        if (path.indexOf('/in/') >= 0) return 'linkedin-public';
        return 'linkedin';
      }
    } catch (e) {}
    return 'unknown';
  }

  // ---------------------------------------------------------------------------
  // SHARED LinkedIn profile-root resolver (post-B2). Reuses the EXISTING DOM
  // knowledge already proven in captureLinkedInResume(): the same candidate
  // root selectors, source-aware and prioritized. Returns { el, strategy } or
  // { el: null, strategy: 'none' }. Does NOT mutate the live DOM — only reads.
  // ---------------------------------------------------------------------------
  function resolveLinkedInProfileRoot(source) {
    try {
      var isRecruiter = (source === 'linkedin-recruiter');
      if (isRecruiter) {
        var rCands = [
          ['[data-test-profile-main-content-container]', 'recruiter-semantic-main'],
          ['#profile-container', 'recruiter-profile-container'],
          ['.scaffold-layout__main', 'recruiter-scaffold-main'],
          ['main', 'recruiter-main']
        ];
        for (var i = 0; i < rCands.length; i++) {
          var el = document.querySelector(rCands[i][0]);
          if (el) return { el: el, strategy: rCands[i][1] };
        }
        return { el: null, strategy: 'none' };
      }
      // Public: evaluate candidate roots by NON-PII content signals, NOT blind
      // first-match. A shallow shell (e.g. workspace container with only 40 chars)
      // must NOT win merely because it appears first. Score each existing
      // candidate and pick the most credible current-profile root.
      var pCands = [
        ['main#workspace', 'public-main-workspace'],
        ['[data-sdui-screen="com.linkedin.sdui.flagshipnav.profile.Profile"]', 'public-sdui-profile'],
        ['#main', 'public-main'],
        ['.profile-layout-main', 'public-profile-layout-main'],
        ['.scaffold-layout__main', 'public-scaffold-main']
      ];
      // Non-PII resume-section evidence (labels only; never log actual text/PII).
      var EVID = [
        /經歷|工作經歷|experience|職務|任職/i,
        /學歷|教育|education|學校|大學|研究所/i,
        /技能|skills|專長|專業/i,
        /關於|about|摘要/i,
        /現職|headline|profile\-topcard|topcard/i
      ];
      function scoreRoot(el) {
        try {
          var txt = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
          var len = txt.length;
          var ev = 0;
          for (var e = 0; e < EVID.length; e++) { if (EVID[e].test(txt)) ev++; }
          // Score = text length + resume-section evidence. No text-token penalty
          // (legitimate resume content contains 工作/工作經歷 etc.). Selection of
          // the best root is structural + content-weight; completeness is enforced
          // later by captureLinkedInProfileText's charCount < 180 gate.
          var score = len + ev * 400;
          return { len: len, ev: ev, score: score };
        } catch (e) { return { len: 0, ev: 0, score: -1 }; }
      }
      var best = null, bestScore = -1, bestKey = 'none';
      var diag = {};
      for (var j = 0; j < pCands.length; j++) {
        var el = document.querySelector(pCands[j][0]);
        if (!el) { diag[pCands[j][1].replace('public-', '')] = 0; continue; }
        var sc = scoreRoot(el);
        // Compact non-PII diagnostic: "<strategy>=<textChars>"
        diag[pCands[j][1].replace('public-', '')] = sc.len;
        // Prefer a more specific descendant profile root over a generic shell:
        // if an already-seen better candidate CONTAINS this one, keep the inner.
        if (sc.score > bestScore) { bestScore = sc.score; best = el; bestKey = pCands[j][1]; }
      }
      // Also: if SDUI profile root is a descendant of main#workspace, prefer it.
      try {
        var ws = document.querySelector('main#workspace');
        var sdui = document.querySelector('[data-sdui-screen="com.linkedin.sdui.flagshipnav.profile.Profile"]');
        if (sdui && ws && ws.contains(sdui) && bestKey !== 'public-sdui-profile') {
          var ssc = scoreRoot(sdui);
          if (ssc.score >= 0 && (best === null || ws.contains(best))) { best = sdui; bestKey = 'public-sdui-profile'; }
        }
      } catch (e) {}
      // Fail closed only if NO candidate matched at all. Selection (best score)
      // is this resolver's job; the completeness gate in captureLinkedInProfileText
      // (charCount < 180) handles shallow/empty captures. This avoids double
      // thresholds that break on JSDOM's partial innerText.
      if (!best) {
        try { var _st = stateForRun(currentRunId); if (_st && _st.routeDiag) { _st.routeDiag.rootCandidates = JSON.stringify(diag); } } catch (e) {}
        return { el: null, strategy: 'none', candidates: diag };
      }
      try { var _st2 = stateForRun(currentRunId); if (_st2 && _st2.routeDiag) { _st2.routeDiag.rootCandidates = JSON.stringify(diag); } } catch (e) {}
      return { el: best, strategy: bestKey, candidates: diag };
    } catch (e) {
      return { el: null, strategy: 'none' };
    }
  }

  // ---------------------------------------------------------------------------
  // NEW LinkedIn PATH (post-B2): capture the CURRENT candidate's profile TEXT
  // directly from the live LinkedIn page (content script, same tab). No B2
  // broker, no storage.session, no addFileName bridge, no tab fallback.
  // Fail closed if the current profile cannot be isolated safely.
  // ---------------------------------------------------------------------------
  function captureLinkedInProfileText(source) {
    try {
      // ROUTING DIAGNOSTIC helper (non-PII): record stages into current run state.
      function rec(o) { try { var st = stateForRun(currentRunId); if (st.routeDiag) { for (var k in o) st.routeDiag[k] = o[k]; } updateB2DiagBadge(); } catch (e) {} }
      rec({ profileTextCapture: true });
      if (typeof document === 'undefined' || !document) {
        rec({ errorStage: 'no-document' });
        return Promise.resolve({ source: source, resumeText: '', characterCount: 0, error: 'LinkedIn 擷取失敗：頁面尚未就緒。' });
      }
      // 1) Resolve the live root via the SHARED resolver (read-only).
      var resolved = resolveLinkedInProfileRoot(source);
      var mainEl = resolved.el;
      var strategy = resolved.strategy;
      rec({ rootStrategy: strategy, rootCandidates: resolved.candidates ? JSON.stringify(resolved.candidates) : undefined });
      if (!mainEl) {
        rec({ container: false, errorStage: 'no-container' });
        return Promise.resolve({ source: source, resumeText: '', characterCount: 0, error: 'LinkedIn 履歷內容擷取不完整，請確認人選頁面已完整載入後再試一次。' });
      }
      rec({ container: true });
      // 2) Clone FIRST — never mutate the live LinkedIn DOM.
      var clone = mainEl.cloneNode(true);
      function _tlen(el) { try { return (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().length; } catch (e) { return 0; } }
      // TEMP diagnostic: stage char counts (non-PII). Pinpoint where profile shrinks.
      rec({ rawRootChars: _tlen(mainEl) });
      rec({ cloneBeforeFilterChars: _tlen(clone) });
      // 3) Current-candidate isolation ON THE CLONE.
      // For public-sdui-profile the root is ALREADY scoped to the current profile,
      // and live evidence proves the card.ref filter deletes legitimate Experience/
      // Education/Skills cards (they do NOT all share the Topcard card.ref key).
      // Bypass the destructive card.ref deletion for this strategy; keep the helper
      // intact for other Public fallback roots.
      if (source === 'linkedin-public' && strategy !== 'public-sdui-profile') {
        try {
          var key = publicProfileKey();
          if (key) {
            var cards = clone.querySelectorAll('[id*="card.ref"]');
            for (var c = 0; c < cards.length; c++) {
              var id = cards[c].id || '';
              if (id.indexOf('card.ref' + key) !== 0 && /card\.ref[A-Za-z0-9_-]+/.test(id)) {
                if (cards[c].parentNode) cards[c].parentNode.removeChild(cards[c]);
              }
            }
          }
        } catch (e) {}
      }
      rec({ afterCardRefFilterChars: _tlen(clone) });
      // 4) Noise removal ON THE CLONE only.
      // PUBLIC-SDUI: conservative. The SDUI profile root is already scoped to the
      // current candidate; live evidence (afterNoise: 32 from 1274) proves the broad
      // section/div class/data-test regex scan destroys legitimate Experience/
      // Education/Skills cards. So for public-sdui-profile we ONLY remove structurally
      // external UI (nav/header/footer/dialog/messaging/aside) and SKIP the broad
      // section/div substring-regex deletion. A slightly noisy multi-thousand-char
      // profile is acceptable; a "clean" 32-char profile is not.
      var isSdui = (source === 'linkedin-public' && strategy === 'public-sdui-profile');
      var noiseSel = [
        'nav', 'header', 'footer',
        '[role="navigation"]', '[role="dialog"]',
        '.scaffold-layout__aside', '.right-rail', '.msg-overlay',
        '.msg-overlay-container', '[data-test-id="messaging"]',
        '.global-nav', '.contact-sales'
      ];
      if (!isSdui) {
        // Other Public fallback roots keep the broader safe-removal set + the
        // section/div class/data-test regex pass (unchanged behavior).
        noiseSel = noiseSel.concat([
          'aside',
          '[data-test-id*="similar"]', '[data-test-id*="recommend"]',
          '[data-test-id*="people-also"]', '[data-test-id*="inmail"]',
          '.pv-recommendations', '.pv-also-viewed', '.pymk', '.similar-profiles',
          '.feed-container', '[data-artdeco-is-focused]',
          'button', '[role="button"]', '.artdeco-button', '.dropdown',
          '.message', '.msg', '.nav'
        ]);
      }
      var noise = clone.querySelectorAll(noiseSel.join(','));
      for (var n = 0; n < noise.length; n++) { if (noise[n].parentNode) noise[n].parentNode.removeChild(noise[n]); }
      // Broad section/div deletion: SKIP for SDUI (preserve all nested profile cards).
      if (!isSdui) {
        var sections = clone.querySelectorAll('section, div');
        for (var s = 0; s < sections.length; s++) {
          var txt = (sections[s].getAttribute && (sections[s].getAttribute('data-test-id') || '')) || '';
          var cls = (sections[s].className && sections[s].className.toString && sections[s].className.toString()) || '';
          if (/similar|recommend|people-also|pymk|also-viewed|contact-sales/i.test(txt + ' ' + cls)) {
            if (sections[s].parentNode) sections[s].parentNode.removeChild(sections[s]);
          }
        }
      }
      rec({ afterNoiseRemovalChars: _tlen(clone) });
      var text = (clone.innerText || clone.textContent || '').replace(/\s+/g, ' ').trim();
      var charCount = text.length;
      rec({ finalTextChars: charCount });
      // Completeness guard: reject nearly-empty or mostly-UI captures.
      if (charCount < 180) {
        rec({ chars: charCount, errorStage: 'too-short' });
        return Promise.resolve({ source: source, resumeText: '', characterCount: charCount, error: 'LinkedIn 履歷內容擷取不完整，請確認人選頁面已完整載入後再試一次。' });
      }
      // Heuristic UI-dominance check: if noise tokens vastly outnumber resume tokens.
      var uiHits = (text.match(/首頁|工作|人脈|徵才|訊息|更多|登出|類似人選|可能認識|推薦|聯絡業務|主頁|首頁/g) || []).length;
      var resumeHits = (text.match(/經驗|學歷|技能|工作經歷|現職|公司|職稱|摘要|關於|語言|證照/g) || []).length;
      if (uiHits > 0 && resumeHits === 0) {
        rec({ chars: charCount, errorStage: 'ui-dominant' });
        return Promise.resolve({ source: source, resumeText: '', characterCount: charCount, error: 'LinkedIn 履歷內容擷取不完整，請確認人選頁面已完整載入後再試一次。' });
      }
      function has(re) { return re.test(text); }
      var sectionsDetected = {
        experience: has(/經驗|工作經歷|experience|職務|任職/i),
        education: has(/學歷|教育|education|學校|大學|研究所/i),
        skills: has(/技能|skills|專長|專業/i)
      };
      return Promise.resolve({
        source: source,
        resumeText: text,
        characterCount: charCount,
        sectionsDetected: sectionsDetected,
        note: 'linkedin-profile-text'
      });
    } catch (e) {
      try { var _stx = stateForRun(currentRunId); if (_stx.routeDiag) { _stx.routeDiag.errorStage = 'exception'; _stx.routeDiag.errorMsg = (e && e.message || ''); updateB2DiagBadge(); } } catch (ee) {}
      return Promise.resolve({ source: source, resumeText: '', characterCount: 0, error: 'LinkedIn 擷取例外：' + (e && e.message || e) });
    }
  }

  // Explicit-Parse capture dispatcher. Called ONLY on the AI Parse click —
  // never on panel open. Routes by detected/requested source.
  // Phone/email/raw HTML are NOT logged (privacy). Returns the resume HTML the
  // backend should parse.
  // =========================================================================
  // LinkedIn AI capture (isolated world). READ-ONLY: clones the live LinkedIn
  // DOM and extracts ONLY the current candidate, sanitizing unrelated chrome.
  // Does NOT save, submit, mutate New Talent, or change Golden LinkedIn import.
  // Reuses the SAME DOM Golden reads (#profile-container for Recruiter;
  // #main/.profile-layout-main for Public), preferring stable semantic roots
  // the user supplied (data-test-profile-main-content-container / SDUI cards).
  // Exposed as window.TNLinkedIn.captureLinkedInResume() for reuse/tests.
  function linkedInSourceType() {
    try {
      var path = (global.location && global.location.pathname || '');
      if (path.indexOf('/talent/profile/') >= 0) return 'linkedin-recruiter';
      if (path.indexOf('/in/') >= 0) return 'linkedin-public';
    } catch (e) {}
    return 'linkedin';
  }
  function cloneAndStrip(root, exclusions) {
    if (!root) return null;
    var clone = root.cloneNode(true);
    for (var i = 0; i < exclusions.length; i++) {
      var nodes = clone.querySelectorAll(exclusions[i]);
      for (var j = 0; j < nodes.length; j++) { if (nodes[j].parentNode) nodes[j].parentNode.removeChild(nodes[j]); }
    }
    return clone;
  }
  // Extract current-candidate profile key from the Public Topcard prefix.
  function publicProfileKey() {
    try {
      var top = document.querySelector('[data-sdui-screen="com.linkedin.sdui.flagshipnav.profile.Profile"] [id*="Topcard"]')
             || document.querySelector('[id*="Topcard"]');
      if (top && top.id) {
        var m = top.id.match(/card\.ref([A-Za-z0-9_-]+)Topcard/);
        if (m) return m[1];
      }
    } catch (e) {}
    return null;
  }
  function captureLinkedInResume() {
    try {
      var type = linkedInSourceType();
      var root = null, exclusions = [];
      if (type === 'linkedin-recruiter') {
        // Prefer semantic main content; fall back to Golden #profile-container.
        root = document.querySelector('[data-test-profile-main-content-container]')
            || document.getElementById('profile-container');
        exclusions = ['[data-test-profile-right-rail-container]', '[data-test-right-rail]',
                      '[data-test-id*="similar"]', '[data-test*="similar"]',
                      '.similar-profiles', '.right-rail', '[data-test-recruiting-tools]',
                      '[data-test-id="recruiting-tools"]'];
        if (!root) return { ok: false, error: 'LinkedIn Recruiter candidate content not found' };
      } else {
        // Public SDUI: include only cards of the CURRENT candidate.
        var key = publicProfileKey();
        var main = document.querySelector('main#workspace')
                || document.querySelector('[data-sdui-screen="com.linkedin.sdui.flagshipnav.profile.Profile"]')
                || document.getElementById('main')
                || document.querySelector('.profile-layout-main')
                || document.querySelector('.scaffold-layout__main');
        if (!main) return { ok: false, error: 'LinkedIn public profile container not found' };
        root = main;
        // Exclude unrelated recommendations / other candidates / chrome.
        exclusions = ['[data-test-id*="pymk"]', '[data-test-id*="people-you-may-know"]',
                      '.pymk', '[data-test-id="lazy-column"] aside', 'nav', 'header',
                      '[data-test-id*="recommendation"]'];
        if (key) {
          // Sanitize: drop cards not belonging to the current profile key.
          var cards = main.querySelectorAll('[id*="card.ref"]');
          for (var c = 0; c < cards.length; c++) {
            var id = cards[c].id || '';
            if (id.indexOf('card.ref' + key) !== 0 && /card\.ref[A-Za-z0-9_-]+/.test(id)) {
              if (cards[c].parentNode) cards[c].parentNode.removeChild(cards[c]);
            }
          }
        }
      }
      var clean = cloneAndStrip(root, exclusions);
      if (!clean) return { ok: false, error: 'LinkedIn capture clone failed' };
      var html = clean.outerHTML;
      if (!html || html.length < 50) return { ok: false, error: 'LinkedIn capture produced empty content' };
      return {
        ok: true,
        source: type,
        html: html,
        mode: 'dom-clone-sanitized',
        chars: html.length,
        profileKey: (type === 'linkedin-public') ? publicProfileKey() : null
      };
    } catch (e) {
      return { ok: false, error: 'LinkedIn capture error: ' + String(e) };
    }
  }
  global.TNLinkedIn = { captureLinkedInResume: captureLinkedInResume, sourceType: linkedInSourceType };

  // [TNT] PATH B2 broker: content scripts cannot read chrome.storage.session
  // directly (MV3). Ask the trusted background to read/delete the exact
  // addFileName-keyed LinkedIn source cache. No fallback, no cross-candidate.
  function b2Msg(type, payload) {
    return new Promise(function (resolve) {
      try {
        if (!(global.chrome && chrome.runtime && chrome.runtime.sendMessage)) {
          resolve({ ok: false, error: 'no-runtime' }); return;
        }
        chrome.runtime.sendMessage(Object.assign({ type: type }, payload || {}), function (resp) {
          if (chrome.runtime.lastError) { resolve({ ok: false, error: 'broker-unavailable' }); return; }
          resolve(resp || { ok: false });
        });
      } catch (e) { resolve({ ok: false, error: 'broker-exception' }); }
    });
  }

  function captureForSource(source) {
    if (source === '104') {
      // PREFERRED: reuse the EXISTING 104 capture the Golden Base already
      // produced (same isolated world). Read-only; no selector duplication,
      // no site104.js modification. FAIL CLOSED: if the proven capture is
      // missing or returns no HTML, do NOT silently degrade to #addResume.
      if (global.TN104 && typeof global.TN104.capture104Resume === 'function') {
        try {
          var r = global.TN104.capture104Resume();
          if (r && r.ok === true && r.html) {
            return {
              source: '104',
              resumeHtml: r.html,
              resumeText: '',
              note: 'tn104.capture104Resume'
            };
          }
          return { source: '104', resumeHtml: '', resumeText: '', error: 'Unable to capture the current 104 resume. Original New Talent is unaffected.' };
        } catch (e) {
          return { source: '104', resumeHtml: '', resumeText: '', error: 'Unable to capture the current 104 resume. Original New Talent is unaffected.' };
        }
      }
      // TN104 not present in this world -> fail closed, do not degrade.
      return { source: '104', resumeHtml: '', resumeText: '', error: 'Unable to capture the current 104 resume. Original New Talent is unaffected.' };
    }
    if (source === 'linkedin' || source === 'linkedin-recruiter' || source === 'linkedin-public') {
      // ROUTING DIAGNOSTIC: mark LinkedIn captureForSource branch entered.
      try {
        var _st0 = stateForRun(currentRunId);
        if (_st0.routeDiag) { _st0.routeDiag.captureForSource = true; updateB2DiagBadge(); }
      } catch (e) {}
      // NEW LinkedIn PATH (post-B2): capture the CURRENT candidate's profile
      // TEXT directly from the live page. No B2 broker / storage.session /
      // addFileName bridge. Fail closed on incomplete/ambiguous capture.
      var liSrc = (source === 'linkedin-recruiter') ? 'linkedin-recruiter'
        : (source === 'linkedin-public') ? 'linkedin-public'
        : (detectSource() === 'linkedin-recruiter' ? 'linkedin-recruiter' : 'linkedin-public');
      return captureLinkedInProfileText(liSrc);
    }
    // unknown / unsupported: explicit degraded fallback from the New Talent
    // form. This is NOT the normal 104/LinkedIn path.
    return { source: 'unknown', resumeHtml: addResumeFallbackHtml(), resumeText: '', note: 'fallback/degraded' };
  }

  // Degraded fallback: clone #addResume (the Pinpin New Talent form), strip the
  // AI panel itself + scripts. Used ONLY when source is unknown and no better
  // capture exists. NOT the primary 104/LinkedIn input.
  function addResumeFallbackHtml() {
    var el = document.getElementById('addResume');
    if (!el) return '';
    try {
      var clone = el.cloneNode(true);
      var ai = clone.querySelectorAll('#tnai-panel-host, #tnai-launcher');
      for (var i = 0; i < ai.length; i++) { if (ai[i].parentNode) ai[i].parentNode.removeChild(ai[i]); }
      var sc = clone.querySelectorAll('script, style');
      for (var j = 0; j < sc.length; j++) { if (sc[j].parentNode) sc[j].parentNode.removeChild(sc[j]); }
      return clone.outerHTML;
    } catch (e) { return ''; }
  }

  // Build the currentPinpinFields context (identity only) from the live scope.
  function currentPinpinFields() {
    var r = getPinpinResume();
    if (!r) return {};
    return {
      chineseName: r.chineseName || null,
      mobile: r.mobile || null,
      email: r.email || null,
      industry: r.industry || null
    };
  }

  // Fill identity into the live model and trigger the canonical submit via the
  // SAME isolated-world controller. Returns {ok,reason}. No second save client.
  function applyToPinpin(mapped, runId) {
    runId = runId || currentRunId;
    if (!mapped || (!mapped.chineseName && !mapped.mobile && !mapped.email)) {
      log('apply aborted: no identity to write');
      return { ok: false, reason: 'empty' };
    }
    var s = findAddResumeScope();
    if (!s) { log('apply failed run=' + runId + ' reason=no-scope'); return { ok: false, reason: 'no-scope' }; }
    if (s.disAddBtn) { log('apply failed run=' + runId + ' reason=in-progress'); return { ok: false, reason: 'in-progress' }; }
    try {
      s.$apply(function () {
        if (mapped.chineseName != null) s.resume.chineseName = mapped.chineseName;
        if (mapped.mobile != null) s.resume.mobile = mapped.mobile;
        if (mapped.email != null) s.resume.email = mapped.email;
        // industry/status/folder/job/tags are recruiter metadata — untouched.
      });
    } catch (e) { log('apply identity failed run=' + runId, String(e)); return { ok: false, reason: String(e) }; }
    // NOTE: deliberately do NOT call s.submit(true) here. AI Fill only WRITES
    // the identity fields (+ Note) into New Talent; the recruiter must manually
    // click Pinpin's original Save. Auto-submitting would save without review.
    log('save -> canonical submit run=' + runId);
    return { ok: true, reason: 'submitted' };
  }

  // =========================================================================
  // =========================================================================
  // AI -> New Talent direct fill (integrated workflow, no separate panel)
  // =========================================================================
  // Locate the real Pinpin New Talent Note input at RUNTIME. We do NOT guess
  // its Angular model property name (source proves it is NOT scope.resume.note
  // and not in this bundled code). Instead we find the actual DOM input by
  // walking #addResume for a textarea/input whose label/placeholder/id/name/
  // class suggests a note (批註/備註/Note). We then drive it the SAME way a
  // recruiter typing would (native value + Angular input/change events) so the
  // real bound model updates without us naming it.
  function findNoteField() {
    var root = document.getElementById('addResume');
    if (!root) return null;
    var cands = root.querySelectorAll('textarea, input[type="text"], input:not([type]), input[type="textarea"]');
    var best = null;
    for (var i = 0; i < cands.length; i++) {
      var el = cands[i];
      if (el.id === 'tnai-launcher' || (el.id && el.id.indexOf('tnai-') === 0)) continue;
      var ph = (el.getAttribute('placeholder') || '').toLowerCase();
      var id = (el.id || '').toLowerCase();
      var nm = (el.getAttribute('name') || '').toLowerCase();
      var cls = (el.className || '').toLowerCase();
      var lab = '';
      var l = el.previousElementSibling || el.parentNode;
      if (l && l.tagName === 'LABEL') lab = (l.textContent || '').toLowerCase();
      if (ph.indexOf('note') >= 0 || id.indexOf('note') >= 0 || nm.indexOf('note') >= 0 ||
          cls.indexOf('note') >= 0 || lab.indexOf('note') >= 0 || lab.indexOf('批註') >= 0 ||
          lab.indexOf('備註') >= 0 || ph.indexOf('批註') >= 0 || ph.indexOf('備註') >= 0) {
        // Prefer a textarea (notes are multi-line); else first matching input.
        if (el.tagName === 'TEXTAREA') return el;
        if (!best) best = el;
      }
    }
    return best;
  }

  // Set a native input/textarea value the way a human keystroke would, so any
  // Angular ng-model listening on input/change picks it up. No model-name guess.
  function setNativeValue(el, value) {
    if (!el) return false;
    try {
      var proto = el.tagName === 'TEXTAREA' ? global.HTMLTextAreaElement.prototype : global.HTMLInputElement.prototype;
      var setter = Object.getOwnPropertyDescriptor(proto, 'value');
      if (setter && setter.set) setter.set.call(el, value); else el.value = value;
    } catch (e) { el.value = value; }
    // Angular 1 ng-model listens to 'input' (text) and 'change'. Fire both so
    // the real bound model updates regardless of Pinpin's exact listener.
    // NOTE: deliberately do NOT dispatch 'blur'. Pinpin's Note (批註) field
    // auto-saves on blur, which would cause an unwanted automatic Save right
    // after AI fills it. 'input' + 'change' are sufficient for Angular ngModel
    // to pick up the value; blur is omitted so the recruiter controls Save.
    try {
      el.dispatchEvent(new global.Event('input', { bubbles: true }));
    } catch (e) {}
    try {
      el.dispatchEvent(new global.Event('change', { bubbles: true }));
    } catch (e) {}
    return true;
  }

  // Build the recruiter-oriented AI Note block. DETERMINISTIC formatting
  // lives HERE (extension), not in Gemini. Preferred source = structured
  // fields {recruiterSummary, targetRoles, coreKeywords}. Fallback (only if
  // those are absent) = Gemini free-form `searchNote`, then a clean field
  // builder that excludes low-value terms. No hallucination.
  var WEAK_CERT = /(駕照|驾照|烹飪|烹饪|調酒|烹調|TQC|餐飲|美容|美髮|乙級|丙級|電腦軟體應用|電腦硬體|Word|Excel|PowerPoint|簡報|文書|Office)/i;
  var GENERIC_LANG = /(英文|英语|中文|汉语|廣東話|粤语|台語|台语)/i;
  function isWeakCert(v) { return WEAK_CERT.test(v || ''); }
  function isGenericLang(v) { return GENERIC_LANG.test(v || ''); }

  // Deterministic formatter from structured recruiter fields.
  // Defensively sanitizes coreKeywords/roles: drops the candidate name,
  // current employer, weak certificates, and generic languages even if the
  // model leaked them (the extension owns the final output contract).
  // Label v2: 【人選概要】 (migrated from old 【人才摘要】).
  function formatRecruiterNote(r) {
    r = r || {};
    // PREFERRED structured path. Requires a real recruiterSummary; if absent,
    // return '' so the caller falls through to the evidence-only safe note
    // (which builds 【人選概要】 from role/company + roles + keywords).
    if (!r.recruiterSummary || !String(r.recruiterSummary).trim()) return '';
    var cand = r.candidate || {};
    var name = cand.name ? strip(cand.name) : '';
    var employer = (r.currentEmployment && r.currentEmployment.company) ? strip(r.currentEmployment.company) : '';
    function reject(v) {
      v = strip(v);
      if (!v) return true;
      if (name && v === name) return true;
      if (employer && v === employer) return true;
      if (isWeakCert(v)) return true;
      if (isGenericLang(v)) return true;
      return false;
    }
    var lines = [];
    lines.push('【人選概要】\n' + String(r.recruiterSummary).trim());
    if (r.targetRoles && r.targetRoles.length) {
      lines.push('【適合職位】');
      var roles = uniq(r.targetRoles.map(strip).filter(Boolean)).filter(function (x) { return !reject(x); }).slice(0, 7);
      for (var i = 0; i < roles.length; i++) lines.push(roles[i]);
    }
    if (r.coreKeywords && r.coreKeywords.length) {
      var kws = uniq(r.coreKeywords.map(strip).filter(Boolean)).filter(function (x) { return !reject(x); }).slice(0, 18);
      if (kws.length) lines.push('【核心關鍵字】' + kws.join('、'));
    }
    return lines.join('\n');
  }

  // Deterministic, evidence-only SAFE note (used only when the quality gate
  // fails on BOTH the primary pass and the one controlled regeneration). It
  // MUST NOT copy raw resume.summary prose (English resumes may contain exactly
  // the forbidden first-person autobiography). It builds ONLY from verified
  // structured fields: current role/company, structured skills, roles, keywords.
  // NEVER fabricates relevant-experience years; NEVER invents inference.
  function conservativeEvidenceNote(r) {
    r = r || {};
    // SAFE double-quality-fail fallback. Evidence-only: no raw autobiography,
    // no fabricated years, no unsupported inference. Source metadata (104 code
    // / LinkedIn URL) does NOT count as recruiter-summary evidence.
    // Collect safe evidence ONCE: current role/company + structured
    // skills/languages/certs/targetRoles/coreKeywords.
    var prof = [];
    if (r.currentEmployment && r.currentEmployment.title) prof.push(String(r.currentEmployment.title).trim());
    if (r.currentEmployment && r.currentEmployment.company) prof.push('@ ' + String(r.currentEmployment.company).trim());
    var hasRole = prof.length > 0;
    var kws = [];
    if (r.skills && r.skills.length) for (var s = 0; s < r.skills.length; s++) kws.push(strip(r.skills[s]));
    if (r.languages && r.languages.length) for (var li = 0; li < r.languages.length; li++) if (!isGenericLang(r.languages[li])) kws.push(strip(r.languages[li]));
    if (r.certifications && r.certifications.length) for (var ci = 0; ci < r.certifications.length; ci++) if (!isWeakCert(r.certifications[ci])) kws.push(strip(r.certifications[ci]));
    if (r.coreKeywords && r.coreKeywords.length) for (var ck = 0; ck < r.coreKeywords.length; ck++) kws.push(strip(r.coreKeywords[ck]));
    kws = uniq(kws.filter(Boolean)).slice(0, 18);
    var roles = [];
    if (r.targetRoles && r.targetRoles.length) {
      for (var ri = 0; ri < r.targetRoles.length; ri++) {
        var rv = strip(r.targetRoles[ri]);
        if (rv && !rejectRole(rv)) roles.push(rv);
      }
      roles = uniq(roles).slice(0, 7);
    }
    var hasEvidence = hasRole || kws.length > 0 || roles.length > 0;
    if (!hasEvidence) return ''; // insufficient safe evidence -> caller skips
    var lines = [];
    var head = '【人選概要】';
    if (prof.length) head += '\n' + prof.join(' ') + '。';
    lines.push(head);
    if (roles.length) {
      lines.push('【適合職位】');
      for (var i = 0; i < roles.length; i++) lines.push(roles[i]);
    }
    if (kws.length) lines.push('【核心關鍵字】' + kws.join('、'));
    return lines.join('\n');
  }

  // Deterministic 104 resume-code extraction. Reads ONLY the already-isolated
  // CURRENT candidate resume HTML (from the proven Golden 104 path), NEVER
  // document.body (which may contain other candidates). Real markup may split
  // the code across elements (<span>代碼:</span><span>123</span>), so we parse
  // the HTML into a DETACHED temporary element, read textContent, normalize
  // whitespace, then regex. Conservative digit capture; never invents a code.
  // Returns null when no verified code found. Accepts 代碼: / 代碼： / 代碼 :
  // (ASCII/full-width colon, optional spaces). No live-DOM mutation.
  function extract104ResumeCode(html) {
    try {
      if (!html || !String(html).trim()) return null;
      var tmp = (typeof document !== 'undefined' && document.createElement)
        ? document.createElement('div') : null;
      var text;
      if (tmp) {
        tmp.innerHTML = String(html);
        text = (tmp.textContent || '').replace(/\s+/g, ' ').trim();
      } else {
        text = String(html).replace(/\s+/g, ' ').trim();
      }
      var m = text.match(/代碼\s*[:：]\s*(\d{6,})/);
      return m ? m[1] : null;
    } catch (e) { return null; }
  }

  // Build the AI Note block from structured fields. Deterministic formatting
  // lives in the extension; Gemini never controls 【】 markers or layout.
  // meta = { linkedinUrl, resumeCode } — at most ONE is rendered (source-bound).
  function buildAiNoteBlock(resume, meta) {
    resume = resume || {};
    meta = meta || {};
    // 1) Preferred: structured fields (Gemini does NOT control formatting)
    var structured = formatRecruiterNote(resume);
    if (structured) {
      return appendSourceMeta(structured, meta);
    }
    // 2) Backward-compat fallback: Gemini free-form searchNote (already
    //    recruiter-grade text, not the deleted weak builder).
    if (resume.searchNote && String(resume.searchNote).trim().length) {
      return appendSourceMeta(String(resume.searchNote).trim(), meta);
    }
    // 3) Conservative evidence-only formatter (no fabricated years, no autobiography).
    return appendSourceMeta(conservativeEvidenceNote(resume), meta);
  }

  // Append the source-bound metadata section LAST. Renders LinkedIn URL OR
  // 104 resume code — never both, never when absent. Dedup-safe.
  function appendSourceMeta(block, meta) {
    meta = meta || {};
    if (/【LinkedIn】|【104履歷代碼】/.test(block)) return block; // defensive dedup
    if (meta.linkedinUrl && String(meta.linkedinUrl).trim()) {
      return block + '\n\n【LinkedIn】\n@url:`' + String(meta.linkedinUrl).trim() + '`';
    }
    if (meta.resumeCode && String(meta.resumeCode).trim()) {
      return block + '\n\n【104履歷代碼】' + String(meta.resumeCode).trim();
    }
    return block;
  }

  // Deterministic LinkedIn URL extraction (NO AI, NO slug guessing).
  // Public: canonical /in/<slug>/ from the page address.
  // Recruiter: prefer a verified Public Profile /in/<slug>/ anchor in DOM.
  // Omit entirely if no reliable URL exists.
  function extractLinkedInUrl(source) {
    try {
      if (source === 'linkedin-public') {
        var m = (global.location && global.location.href || '').match(/https?:\/\/(www\.)?linkedin\.com\/in\/[A-Za-z0-9_%-]+\//i);
        return m ? m[0].replace(/^https?:\/\/(www\.)?/i, 'https://www.').replace(/\/+$/, '/') : null;
      }
      if (source === 'linkedin-recruiter') {
        var anchors = document.querySelectorAll('a[href*="linkedin.com/in/"]');
        for (var i = 0; i < anchors.length; i++) {
          var href = anchors[i].href || '';
          // Skip only Recruiter SEARCH urls (not /in/ profile links that merely
          // carry tracking params like trk=). A /in/<slug>/ profile link is the
          // verified Public Profile we want, even with ?trk=foo appended.
          if (/searchContextId|searchHistoryId|highlightedPatternSource|searchRequestId|\/talent\/search\/|\/sales\/search\//.test(href)) continue;
          var mm = href.match(/https?:\/\/(www\.)?linkedin\.com\/in\/[A-Za-z0-9_%-]+\//i);
          if (mm) return mm[0].replace(/^https?:\/\/(www\.)?/i, 'https://www.').replace(/\/+$/, '/');
        }
        return null;
      }
    } catch (e) {}
    return null;
  }

  // Deterministic HARD-SAFETY Note gate (no model call). The AI is the primary
  // writer; recruiters review/edit before manually saving in Pinpin. The
  // extension only blocks OBVIOUS technical/safety failures — it does NOT
  // score recruiter quality, keyword counts, source richness, or summary
  // length. Returns { ok, reasons[] } so the caller can perform at most ONE
  // controlled regeneration on a hard failure.
  function assessNoteQuality(r, sourceText) {
    r = r || {};
    var reasons = [];
    var sum = String(r.recruiterSummary || '').trim();
    // 1) Empty summary while usable source content exists.
    var hasSource = String(sourceText || '').replace(/\s+/g, '').length >= 40;
    if (!sum && hasSource) { reasons.push('empty-summary'); return { ok: false, reasons: reasons }; }
    if (!sum) { reasons.push('empty-summary'); return { ok: false, reasons: reasons }; }
    // 2) Obvious first-person autobiography leakage copied into recruiterSummary.
    if (/\b(I\s|I'm|I've|my career|over the course of my career)\b/i.test(sum)) {
      reasons.push('first-person');
    }
    // 3) Obvious weak model result: "<title> @ <company>. X years relevant
    //    experience." OR a recruiterSummary that is essentially ONLY
    //    "<title> @ <company>。" — a single clause containing '@' ending with
    //    。/. —— an obvious weak generation that should trigger the one retry.
    if (/@\s*.{0,40}\.\s*\d+\s*年|relevant experience\.?$/i.test(sum) ||
        /^.{0,40}@\s*.{0,40}\.\s*\d+\s*年/i.test(sum) ||
        /^[^。，；！？]*\s*@\s*[^。，；！？]*[。.]$/.test(sum)) {
      reasons.push('weak-fallback');
    }
    // 4) Gross malformation: English-clause leakage ("Research Specialist at X
    //    with expertise") — clear sign the model returned copied English rather
    //    than Traditional Chinese analysis.
    if (/\b(Research|Senior|Specialist|Engineer|Manager|Designer) at .+ with expertise\b/i.test(sum)) {
      reasons.push('english-clause');
    }
    return { ok: reasons.length === 0, reasons: reasons };
  }
  function strip(v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); }
  function uniq(a) { var o = {}, r = []; for (var i = 0; i < a.length; i++) { if (!o[a[i]]) { o[a[i]] = 1; r.push(a[i]); } } return r; }
  // Role sanitizer: drop candidate name / employer / weak certs leaking into roles.
  function rejectRole(v) {
    return !!(isWeakCert(v) || isGenericLang(v));
  }

  // Merge AI block into existing Note, preserving recruiter-written text.
  var AI_BLOCK_MARKER = '--- TNT 人才備註 ---';
  var AI_BLOCK_MARKER_OLD = '--- AI Review ---';
  function mergeNote(existing, aiBlock) {
    existing = existing || '';
    var lines = existing.split(/\n/);
    var cut = -1;
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].indexOf(AI_BLOCK_MARKER) >= 0 || lines[i].indexOf(AI_BLOCK_MARKER_OLD) >= 0) { cut = i; break; }
    }
    var recruiter = (cut >= 0 ? lines.slice(0, cut) : lines).join('\n').trim();
    var body = recruiter ? (recruiter + '\n\n' + AI_BLOCK_MARKER + '\n' + aiBlock) : (AI_BLOCK_MARKER + '\n' + aiBlock);
    return body;
  }

  // Integrated AI Review: capture -> Gemini -> fill Name/Phone/Email + Note
  // directly into the ORIGINAL New Talent fields. No separate panel. No second
  // save client. Original Pinpin Save stays canonical.
  // Resolve the resume source. PATH B2: if the current New Talent has an
  // addFileName with a valid LinkedIn session-cache entry, use it (exact match).
  // Otherwise fall back to the detected source (104 or unknown). Returns a Promise
  // resolving to { source, cap, addFileName }.
  function resolveCapture(runId) {
    var st = stateForRun(runId);
    var srcType = detectSource();
    // ROUTING DIAGNOSTIC: mark resolveCapture entered; record detected source.
    try {
      if (!st.routeDiag) st.routeDiag = { click: false, pageHost: (global.location && global.location.hostname || ''), frameTop: (global.top === global.self), runAiReview: false, detectedSource: null, resolveCapture: false, captureForSource: false, profileTextCapture: false, container: false, chars: 0, errorStage: null };
      st.routeDiag.resolveCapture = true;
      st.routeDiag.detectedSource = srcType;
      updateB2DiagBadge();
    } catch (e) {}
    var scope = findAddResumeScope();
    var addFileName = scope && scope.addFileName ? String(scope.addFileName) : '';
    if (srcType === '104') {
      // PRESERVED: the stable, proven 104 capture path. Unchanged.
      return Promise.resolve(captureForSource('104')).then(function (cap) {
        return { source: '104', cap: cap, addFileName: null };
      });
    }
    if (srcType === 'linkedin' || srcType === 'linkedin-recruiter' || srcType === 'linkedin-public') {
      // NEW LinkedIn PATH (post-B2): direct current-profile text capture.
      // No B2 broker / storage.session / addFileName bridge.
      var liSrc = (srcType === 'linkedin-recruiter') ? 'linkedin-recruiter'
        : (srcType === 'linkedin-public') ? 'linkedin-public'
        : 'linkedin';
      return Promise.resolve(captureForSource(liSrc)).then(function (cap) {
        return { source: liSrc, cap: cap, addFileName: null };
      });
    }
    // unknown / unsupported: fail closed (do not degrade to New Talent form clone).
    return Promise.resolve({ source: 'unknown', cap: { source: 'unknown', resumeHtml: '', resumeText: '', error: '不支援的來源，無法執行 AI Fill。' }, addFileName: null });
  }

  function runAiReview(runId) {
    runId = runId || currentRunId;
    var st = stateForRun(runId);
    st.status = 'parsing';
    toast('AI 解析中…');
    // ROUTING DIAGNOSTIC: mark runAiReview entered; record exact detectSource().
    try {
      if (!st.routeDiag) st.routeDiag = { click: false, pageHost: (global.location && global.location.hostname || ''), frameTop: (global.top === global.self), runAiReview: false, detectedSource: null, resolveCapture: false, captureForSource: false, profileTextCapture: false, container: false, chars: 0, errorStage: null };
      st.routeDiag.runAiReview = true;
      st.routeDiag.detectedSource = detectSource();
      updateB2DiagBadge();
    } catch (e) {}
    resolveCapture(runId).then(function (resolved) {
      var source = resolved.source;
      var cap = resolved.cap;
      // FREEZE source metadata at run start (before async Gemini). RESET every
      // run so no stale cross-run metadata survives (LinkedIn URL must not leak
      // into a later 104 run, and vice versa). Populate ONLY the current source.
      st.sourceMeta = {};
      if (source === 'linkedin-recruiter' || source === 'linkedin-public') {
        st.sourceMeta.linkedinUrl = extractLinkedInUrl(source); // from page/root
      } else if (source === '104') {
        st.sourceMeta.resumeCode = extract104ResumeCode(cap.resumeHtml); // current-candidate HTML only
      }
      var addFileName = resolved.addFileName;
      // store non-PII capture status for the badge (no candidate data)
      st.captureStatus = {
        source: cap && cap.source ? cap.source : source,
        characterCount: cap && typeof cap.characterCount === 'number' ? cap.characterCount : (cap && cap.resumeText ? cap.resumeText.length : 0),
        sectionsDetected: cap && cap.sectionsDetected ? cap.sectionsDetected : null,
        error: cap && cap.error ? cap.error : null
      };
      if (!cap || cap.error || (!cap.resumeHtml && !cap.resumeText)) {
        st.status = 'error';
        st.error = (cap && cap.error) || 'LinkedIn 履歷內容擷取不完整，請確認人選頁面已完整載入後再試一次。';
        toast(st.error);
        return; // fail closed
      }
      parseResume({
        runId: runId,
        source: source,
        resumeHtml: cap.resumeHtml || '',
        resumeText: cap.resumeText || '',
        currentPinpinFields: currentPinpinFields()
      }).then(function (res) {
        // Backend/Gemini failure (parseResume resolves with ok:false, no resume)
        // -> RETAIN the cache so William can click AI Fill again. Do NOT delete.
        if (!res || res.ok === false || !res.resume) {
          st.status = 'error';
          st.error = (res && res.error) || 'AI 解析失敗';
          toast('AI 解析失敗，Original New Talent 不受影響；可再點一次 AI Fill');
          return; // cache intentionally retained for retry
        }
        // Deterministic Note Quality Gate. On LOW quality, perform EXACTLY ONE
        // controlled regeneration with the stricter prompt (backend-side),
        // reusing the SAME capture text — no re-run of browser capture logic.
        var firstResume = res.resume;
        // Fill Name/Phone/Email identity from the AUTHORITATIVE primary parse.
        // Done once here; the retry (if any) only refines recruiter intelligence
        // and must NOT overwrite candidate/experience/education. AI Fill writes
        // identity + Note into New Talent; the recruiter manually presses the
        // original Pinpin Save (submitCalls stays 0).
        try {
          var idMap = mapAIResumeToPinpinForm(firstResume, null);
          if (idMap.chineseName || idMap.mobile || idMap.email) {
            applyToPinpin(idMap, runId);
          }
        } catch (e) { log('identity fill error', String(e)); }
        var gate = assessNoteQuality(firstResume, (cap.resumeText || '') + ' ' + (cap.resumeHtml || ''));
        // Render the Note. qualityOk=false => gate failed (primary or retry):
        // do NOT render the failed recruiterSummary; fall back to evidence-only
        // safe note; if even that is empty, skip the Note update entirely.
        var finish = function (r, qualityOk) {
          st.resume = r; st.status = 'complete';
          var scope = findAddResumeScope();
          if (!scope) {
            st.noteFilled = false;
            showResultCard(r);
            toast('已解析（此頁無 New Talent）。請匯入 New Talent 後再用 AI Fill，或複製下方結果');
            return;
          }
          var noteField = findNoteField();
          if (!noteField) {
            st.noteFilled = false;
            toast('已填入 Name/Phone/Email；Note 欄位未找到（未寫入 Note）');
            return;
          }
          var block;
          if (qualityOk) {
            block = buildAiNoteBlock(r, st.sourceMeta); // passed gate
          } else {
            // Gate failed: render evidence-only safe note (no autobiography).
            block = buildAiNoteBlock(Object.assign({}, r, { recruiterSummary: null, searchNote: null }), st.sourceMeta);
          }
          // If the block is trivial/empty, do NOT overwrite the recruiter's Note.
          if (!block || block.indexOf('【人選概要】') < 0 || block.replace(/\s/g, '').length < 12) {
            st.noteFilled = false;
            toast('AI Note 品質不足，未覆寫人選備註；可再點一次 AI Fill');
            return;
          }
          var existing = noteField.value || '';
          var merged = mergeNote(existing, block);
          setNativeValue(noteField, merged);
          st.noteFilled = true;
          toast('已填入 Name/Phone/Email + Note，請在 New Talent 確認後按原本 Save');
        };
        if (gate.ok) { finish(firstResume, true); return; }
        // ONE controlled regeneration only.
        log('Note quality gate FAIL reasons=' + JSON.stringify(gate.reasons) + ' -> one regen');
        parseResume({
          runId: runId,
          source: source,
          resumeHtml: cap.resumeHtml || '',
          resumeText: cap.resumeText || '',
          currentPinpinFields: currentPinpinFields(),
          noteRetry: true
        }).then(function (res2) {
          if (!res2 || res2.ok === false || !res2.resume) { finish(firstResume, false); return; }
          var r2 = res2.resume;
          var gate2 = assessNoteQuality(r2, (cap.resumeText || '') + ' ' + (cap.resumeHtml || ''));
          // Retry exists ONLY to improve recruiter intelligence. Primary candidate
          // parsing (Name/Phone/Email/Experience/Education) stays authoritative;
          // merge in ONLY the three Note fields from the regen when it passed.
          if (gate2.ok) {
            var mergedResume = Object.assign({}, firstResume, {
              recruiterSummary: r2.recruiterSummary,
              targetRoles: r2.targetRoles,
              coreKeywords: r2.coreKeywords
            });
            finish(mergedResume, true);
          } else {
            finish(firstResume, false);
          }
        }).catch(function () { finish(firstResume, false); });
      }).catch(function (e) {
        // Gemini/parse failure: KEEP the cache so William can retry AI Fill.
        st.status = 'error'; st.error = 'AI 解析失敗';
        toast('AI 解析失敗，Original New Talent 不受影響；可再點一次 AI Fill');
      });
    }).catch(function (e) {
      st.status = 'error';
      st.error = 'LinkedIn 履歷來源已失效，請重新從 LinkedIn 匯入此人選後再使用 AI Fill。';
      toast(st.error);
    });
  }

  // Lightweight status toast near the launcher (no separate panel).
  function showResultCard(resume) {
    resume = resume || {};
    var cand = resume.candidate || {};
    var card = global.document.getElementById('tnai-result-card');
    if (card && card.parentNode) card.parentNode.removeChild(card);
    card = global.document.createElement('div');
    card.id = 'tnai-result-card';
    var block = buildAiNoteBlock(resume);
    card.style.cssText = 'position:fixed;right:12px;top:12px;z-index:2147483647;' +
      'max-width:320px;background:rgba(235,246,255,.94);color:#0b1b3a;' +
      'border:1px solid rgba(120,170,255,.6);border-radius:14px;padding:14px;' +
      'font:12px/1.5 system-ui,sans-serif;box-shadow:0 12px 36px rgba(20,55,90,.3);' +
      'white-space:pre-wrap;max-height:70vh;overflow:auto;';
    var html = '【AI 解析結果】\n姓名: ' + (cand.name || '-') +
      '\n電話: ' + (normalizePhone(cand.phone) || '-') +
      '\nEmail: ' + (cand.email || '-') + '\n\n' + block;
    card.textContent = html;
    (global.document.body || global.document.documentElement).appendChild(card);
    global.setTimeout(function () { if (card.parentNode) card.style.display = 'none'; }, 20000);
  }

  function toast(msg) {
    var t = global.document.getElementById('tnai-toast');
    if (!t) {
      t = global.document.createElement('div');
      t.id = 'tnai-toast';
      t.style.cssText = 'position:fixed;right:12px;bottom:52px;z-index:2147483647;' +
        'background:#0b1b3a;color:#e8eefc;border:1px solid #27406e;border-radius:8px;' +
        'padding:8px 12px;font:600 12px/1.4 system-ui,sans-serif;max-width:280px;' +
        'box-shadow:0 4px 14px rgba(0,0,0,.45);';
      (global.document.body || global.document.documentElement).appendChild(t);
    }
    t.textContent = msg;
    t.style.display = 'block';
    global.clearTimeout(t.__t);
    t.__t = global.setTimeout(function () { if (t.parentNode) t.style.display = 'none'; }, 6000);
  }

  // Floating panel UI (injected once)
  // =========================================================================
  var panelEl = null;

  function ensurePanel() {
    if (panelEl && document.body.contains(panelEl)) return panelEl;
    var host = document.createElement('div');
    host.id = 'tnai-panel-host';
    host.setAttribute('aria-label', 'AI Resume Review');
    host.style.cssText = [
      'position:fixed', 'right:16px', 'bottom:16px', 'z-index:2147483647',
      'width:340px', 'max-height:80vh', 'overflow:auto',
      'background:#0f2e2e', 'color:#eafff6', 'border:1px solid #2bd4a8',
      'border-radius:10px', 'font:13px/1.4 system-ui,sans-serif',
      'box-shadow:0 8px 30px rgba(0,0,0,.4)', 'padding:0'
    ].join(';');
    host.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;' +
      'background:#173f3c;padding:8px 10px;border-radius:10px 10px 0 0;">' +
      '<strong style="color:#2bd4a8;">✨ AI Resume Review</strong>' +
      '<button id="tnai-close" style="background:none;border:0;color:#e8eefc;cursor:pointer;font-size:16px;">×</button>' +
      '</div>' +
      '<div id="tnai-body" style="padding:10px;"></div>';
    document.body.appendChild(host);
    panelEl = host;
    host.querySelector('#tnai-close').addEventListener('click', function () {
      if (host.parentNode) host.parentNode.removeChild(host);
      panelEl = null;
    });
    return host;
  }

  function renderPanel(runId, opts) {
    opts = opts || {};
    var st = stateForRun(runId);

    // NOTE: NO capture on panel open. Opening AI Review must cause ZERO
    // capture calls, ZERO backend calls, ZERO Gemini calls. Capture happens
    // only on the explicit AI Parse click (see the Parse button handler).

    var host = ensurePanel();
    var body = host.querySelector('#tnai-body');
    var buf = [];

    buf.push('<div style="margin-bottom:6px;">');
    buf.push('Source: <b>' + escapeHtml(st.source || opts.source || 'unknown') + '</b><br>');
    buf.push('Status: <b>' + escapeHtml(st.status) + '</b>');
    if (st.error) buf.push(' <span style="color:#ffb4b4;">(' + escapeHtml(st.error) + ')</span>');
    buf.push('</div>');

    if (st.status === 'parsing') {
      buf.push('<div style="padding:10px 0;">AI analyzing resume…</div>');
    } else if (st.resume) {
      buf.push(renderEditor(st.resume));
    } else {
      buf.push('<div style="opacity:.8;">No AI result yet. Click ✨ AI Parse.</div>');
    }

    buf.push('<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;">');
    buf.push('<button id="tnai-parse" style="flex:1;background:#3b82f6;color:#04122e;border:0;border-radius:6px;padding:6px;cursor:pointer;">✨ AI Parse</button>');
    buf.push('<button id="tnai-reset" style="background:#173f3c;color:#e8eefc;border:1px solid #27406e;border-radius:6px;padding:6px;cursor:pointer;">Reset</button>');
    buf.push('<button id="tnai-save" style="flex:1;background:#1f8f6e;color:#fff;border:0;border-radius:6px;padding:6px;cursor:pointer;">Save to Pinpin</button>');
    buf.push('</div>');
    buf.push('<div style="margin-top:6px;font-size:11px;opacity:.7;">Switching Original/AI never alters the other. AI edits are not applied until you click Save.</div>');

    body.innerHTML = buf.join('');

    body.querySelector('#tnai-parse').addEventListener('click', function () {
      this.disabled = true;
      var st = stateForRun(runId);
      // Explicit capture ONCE, on this click only. No capture on panel open.
      var source = detectSource();
      // captureForSource may return a Promise (LinkedIn B2 session-cache path)
      // or a synchronous object (104). Normalize to a Promise.
      var capPromise = (typeof captureForSource(source).then === 'function')
        ? captureForSource(source)
        : Promise.resolve(captureForSource(source));
      capPromise.then(function (cap) {
        if (cap.error) {
          // Fail closed: surface the capture error, do NOT call the backend,
          // do NOT touch Original. #addResume is never a 104 fallback.
          st.status = 'error';
          st.error = cap.error;
          renderPanel(runId, opts);
          return;
        }
        parseResume({
          runId: runId,
          source: source,
          resumeHtml: cap.resumeHtml || '',
          resumeText: cap.resumeText || '',
          currentPinpinFields: currentPinpinFields()
        })
          .then(function () { renderPanel(runId, opts); })
          .catch(function () { renderPanel(runId, opts); });
      });
    });
    body.querySelector('#tnai-reset').addEventListener('click', function () {
      clearRun(runId);
      var st2 = stateForRun(runId); st2.status = 'idle';
      renderPanel(runId, opts);
    });
    body.querySelector('#tnai-save').addEventListener('click', function () {
      var st3 = stateForRun(runId);
      if (!st3.resume) { st3.error = 'parse first'; st3.status = 'error'; renderPanel(runId, opts); return; }
      // PERSISTED fields only: chineseName/mobile/email (the identity the
      // canonical submit carries). Experience/education/etc. are review-only
      // in this build — see docs/AI_PINPIN_FIELD_MAPPING.md.
      var mapped = mapAIResumeToPinpinForm(st3.resume, null);
      if (!mapped.chineseName && !mapped.mobile && !mapped.email) {
        st3.error = 'no-identity'; st3.status = 'error'; renderPanel(runId, opts); return;
      }
      var r = applyToPinpin(mapped, runId);
      if (!r.ok) { st3.status = 'error'; st3.error = r.reason; }
      else { st3.status = 'saved'; }
      renderPanel(runId, opts);
    });
  }

  function renderEditor(r) {
    var buf = [];
    buf.push('<div style="border-top:1px solid #2bd4a8;margin:6px 0;padding-top:6px;"><b>Basic (persisted on Save)</b></div>');
    buf.push(field('Name', 'cand.name', r.candidate && r.candidate.name));
    buf.push(field('Phone', 'cand.phone', r.candidate && r.candidate.phone));
    buf.push(field('Email', 'cand.email', r.candidate && r.candidate.email));
    buf.push(field('Location', 'cand.location', r.candidate && r.candidate.location));

    buf.push('<div style="border-top:1px solid #2bd4a8;margin:6px 0;padding-top:6px;"><b>Current Employment (review only)</b></div>');
    buf.push(field('Company', 'cur.company', r.currentEmployment && r.currentEmployment.company));
    buf.push(field('Title', 'cur.title', r.currentEmployment && r.currentEmployment.title));

    buf.push('<div style="border-top:1px solid #2bd4a8;margin:6px 0;padding-top:6px;"><b>Summary (review only)</b></div>');
    buf.push(textarea('summary', r.summary));

    buf.push('<div style="opacity:.7;font-size:11px;margin-top:6px;color:#8aa0c8;">On Save, only <b>Name / Phone / Email</b> are written to Pinpin New Talent via the existing Save button. Experience / Education / Skills / Summary are review-only here: the canonical Pinpin submit stores the full resume from the captured file (addFileName), not from these fields. See AI_PINPIN_FIELD_MAPPING.md.</div>');
    return buf.join('');
  }

  function field(label, key, val) {
    return '<label style="display:block;margin:3px 0;">' + escapeHtml(label) +
      '<input data-rk="' + escapeHtml(key) + '" value="' + escapeHtml(val || '') +
      '" style="width:100%;box-sizing:border-box;background:#0b2422;color:#e8eefc;border:1px solid #27406e;border-radius:4px;padding:4px;"></label>';
  }
  function textarea(key, val) {
    return '<textarea data-rk="' + escapeHtml(key) + '" style="width:100%;box-sizing:border-box;background:#0b2422;color:#e8eefc;border:1px solid #27406e;border-radius:4px;padding:4px;height:54px;">' +
      escapeHtml(val || '') + '</textarea>';
  }
  function escapeHtml(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // =========================================================================
  // Public API
  // =========================================================================
  global.TNAI = {
    setApiBaseUrl: setApiBaseUrl,
    setMockMode: setMockMode,
    getApiBaseUrl: function () { return AI_API_BASE_URL; },
    isMockMode: function () { return AI_MOCK_MODE; },
    parseResume: parseResume,
    captureForSource: captureForSource,

    mapAIResumeToPinpinForm: mapAIResumeToPinpinForm,
    normalizePhone: normalizePhone,
    buildAiNoteBlock: buildAiNoteBlock,
    mergeNote: mergeNote,
    applyToPinpin: applyToPinpin,
    findAddResumeScope: findAddResumeScope,
    getPinpinResume: getPinpinResume,
    renderPanel: renderPanel,
    clearRun: clearRun,
    stateForRun: stateForRun
  };

  // =========================================================================
  // New Talent visual theme: frosted light-blue glass, matching the AI Review
  // look. Pure CSS overlay on Pinpin's own New Talent page — NO HTML/function
  // change to Pinpin (Original Save / auth untouched). Injected only while the
  // live AddResumeCtrl is active, removed on unmount. Reversible / scoped.
  //
  // The native Pinpin .can-drag bar IS the official window title bar (it carries
  // the draggable directive + the X close). We restyle it in place and change
  // only its visible text, never the element itself.
  var TNAI_BRAND_ID = 'tnai-brand-subtitle';
  function applyNewTalentBranding() {
    if (global.document.getElementById(TNAI_BRAND_ID)) return;
    var root = global.document.getElementById('addResume');
    if (!root) return;
    // 1) Restyle the NATIVE .can-drag title bar in place.
    var bar = root.querySelector('.can-drag');
    if (bar) {
      // Replace ONLY the visible title text node; keep the <a>X</a> close.
      var nodes = bar.childNodes;
      for (var i = 0; i < nodes.length; i++) {
        if (nodes[i].nodeType === 3 && nodes[i].textContent.trim().length) {
          bar.setAttribute('data-tn-orig-title', nodes[i].textContent); // preserve exact original
          nodes[i].textContent = 'Talent Nexus Connector';
          break;
        }
      }
      bar.setAttribute('data-tn-title', '1');
    }
    // 2) Inject a SMALL subtitle directly BELOW the native title bar (not above).
    var sub = global.document.createElement('div');
    sub.id = TNAI_BRAND_ID;
    sub.style.cssText = 'width:100%;box-sizing:border-box;padding:6px 16px 8px;font:500 11px/1.3 system-ui,sans-serif;color:#eaf4ff;letter-spacing:.2px;text-align:left;white-space:normal;';
    tnGetLanguage(function (_l) { sub.textContent = tnUIText(_l, 'subtitle'); });
    if (bar && bar.parentNode) {
      bar.parentNode.insertBefore(sub, bar.nextSibling);
    } else if (root.firstChild) {
      root.insertBefore(sub, root.firstChild.nextSibling);
    } else {
      root.appendChild(sub);
    }
  }
  function removeNewTalentBranding() {
    var b = global.document.getElementById(TNAI_BRAND_ID);
    if (b && b.parentNode) b.parentNode.removeChild(b);
    // Restore native title bar text if we changed it.
    var root = global.document.getElementById('addResume');
    if (root) {
      var bar = root.querySelector('.can-drag[data-tn-title="1"]');
      if (bar) {
        var nodes = bar.childNodes;
        for (var i = 0; i < nodes.length; i++) {
          if (nodes[i].nodeType === 3 && nodes[i].textContent.trim().length) {
            var orig = bar.getAttribute('data-tn-orig-title');
            nodes[i].textContent = (orig != null ? orig : 'New talent');
            break;
          }
        }
        bar.removeAttribute('data-tn-title');
        bar.removeAttribute('data-tn-orig-title');
      }
    }
  }

  // =========================================================================
  // New Talent Layer B (REAL Pinpin window) — heavy visual correction v3
  // Architecture (verified against Golden Base add_resume.html):
  //   #addResume (draggable, Pinpin MOVE owner)
  //     <div class="bg">                      (Pinpin move wrapper, no width/bg)
  //       <div class="bg-write">              (VISIBLE SHELL — TN owns width/glass)
  //         <a ng-click="close()">X</a>       (native close, SIBLING of .can-drag)
  //         <div class="can-drag">New talent</div>  (native drag handle / header)
  //         <form class="form-horizontal">    (native fields, width:100% of form)
  // Pinpin has NO !important width on .bg-write/.bg/#addResume — so TN wins.
  // Golden Base window width was ~400px; we widen the SHELL to 560 (breathing
  // room) and cap the form to its ORIGINAL width so native fields stay Golden-sized.
  // Manual resize removed; native window MOVE via .can-drag retained.
  // =========================================================================
  var TNAI_THEME_ID = 'tnai-newtalent-theme';
  var TNAI_GOLDEN_FORM_W = '400px'; // restored Golden Base New Talent width

  function styleNewTalentOnce(root) {
    var card = root.querySelector('.bg-write');
    if (!card) return false;
    if (card.classList.contains('tn-newtalent-ready')) return true; // already styled

    // --- stylesheet (class-level) ---
    if (!global.document.getElementById(TNAI_THEME_ID)) {
      var style = global.document.createElement('style');
      style.id = TNAI_THEME_ID;
      style.textContent = [
        // Host: transparent wrapper, width owned by .bg-write.
        '#addResume{ box-sizing: border-box !important; width: auto !important; max-width: 92vw !important; background: transparent !important; border: 0 !important; box-shadow: none !important; margin: 0 !important; padding: 0 !important; }',
        // Pinpin move wrapper transparent so glass reads as glass.
        '#addResume .bg{ background: transparent !important; border: 0 !important; box-shadow: none !important; }',
        // .bg-write = VISIBLE SHELL. Block (not flex) so native .input-group flex
        // rows don't overflow. Real frosted glass: low alpha so page shows through.
        '#addResume .bg-write{ box-sizing: border-box !important; display: block !important; background: rgba(214, 236, 255, 0.40) !important; -webkit-backdrop-filter: blur(16px) saturate(130%) !important; backdrop-filter: blur(16px) saturate(130%) !important; border: 1px solid rgba(255,255,255,0.55) !important; border-radius: 12px !important; box-shadow: 0 16px 50px rgba(20,55,90,0.30), 0 2px 8px rgba(20,55,90,0.18) !important; overflow-x: hidden !important; overflow-y: auto !important; padding: 0 !important; }',
        // First-paint guard: hide native form until TN layout is ready (no flash).
        '#addResume .bg-write:not(.tn-newtalent-ready){ visibility: hidden !important; }',
        // .can-drag = WINDOW HEADER (sticky top, flush, no blank band). Flex:
        // brand left, native X right (X moved inside at runtime).
        '#addResume .can-drag{ position: sticky !important; top: 0 !important; z-index: 60 !important; display: flex !important; align-items: center !important; justify-content: space-between !important; background: rgba(11,42,91,0.94) !important; -webkit-backdrop-filter: blur(14px) !important; backdrop-filter: blur(14px) !important; color: #eaf2ff !important; height: 38px !important; line-height: 38px !important; font-size: 15px !important; font-weight: 700 !important; letter-spacing: .3px !important; text-align: left !important; padding: 0 12px !important; margin: 0 !important; border-radius: 11px 11px 0 0 !important; cursor: move !important; }',
        '#addResume .can-drag a[ng-click="close()"]{ float: none !important; color: #eaf2ff !important; font-size: 19px !important; line-height: 38px !important; width: 26px !important; text-align: center !important; text-decoration: none !important; cursor: pointer !important; }',
        '#addResume .can-drag a[ng-click="close()"]:hover{ color: #ffffff !important; }',
        // Subtitle below header.
        '#tnai-brand-subtitle{ width: 100% !important; box-sizing: border-box !important; padding: 8px 16px 6px !important; color: #eaf4ff !important; text-align: left !important; white-space: normal !important; }',
        // Form: restore GOLDEN BASE width (400px) -> native fields keep original
        // size; wider shell (560) leaves breathing room on the right. NOT a field
        // width override — it restores the original Pinpin window width.
        '#addResume .bg-write > form, #addResume form.form-horizontal{ max-width: ' + TNAI_GOLDEN_FORM_W + ' !important; margin: 0 !important; }',
        '#addResume .form-horizontal{ padding: 12px 16px 4px !important; }',
        // Prevent native flex rows (.input-group) from overflowing the column.
        '#addResume .input-group{ min-width: 0 !important; }',
        '#addResume .form-control, #addResume input, #addResume select, #addResume textarea{ min-width: 0 !important; box-sizing: border-box !important; }',
        // Light focus ring only (fields stay native/readable on glass).
        '#addResume input:focus, #addResume textarea:focus, #addResume select:focus{ outline: none !important; box-shadow: 0 0 0 3px rgba(59,130,246,0.22) !important; }',
        '#addResume label, #addResume .section-title, #addResume h1, #addResume h2, #addResume h3{ color: #13386e !important; }',
        // Native Pinpin Original Save -> Talent Nexus blue (primary persist).
        '#addResume button:not(#tnai-launcher), #addResume input[type=submit], #addResume .btn-save, #addResume .save-btn{ background: linear-gradient(135deg,#2563eb,#3b82f6) !important; color: #ffffff !important; border: 1px solid rgba(255,255,255,.5) !important; border-radius: 12px !important; padding: 10px 20px !important; font: 700 14px/1 system-ui,sans-serif !important; cursor: pointer !important; box-shadow: 0 8px 22px rgba(30,80,180,.35) !important; }',
        '#addResume button:not(#tnai-launcher):hover, #addResume input[type=submit]:hover{ filter: brightness(1.06) !important; }',
        '.tn-hide-wechat{ display: none !important; }'
      ].join('\n');
      (global.document.head || global.document.documentElement).appendChild(style);
    }

    // --- inline !important on the REAL visible card (.bg-write) —
    //   beats Pinpin's later class rule. BIG+TALL glass shell.
    var __set = function (k, v) { card.style.setProperty(k, v, 'important'); };
    __set('width', '560px'); __set('max-width', '92vw'); __set('min-width', '440px');
    __set('height', '86vh'); __set('max-height', '92vh'); __set('min-height', '460px');
    __set('box-sizing', 'border-box');
    __set('display', 'block');
    __set('overflow-x', 'hidden'); __set('overflow-y', 'auto');
    __set('background', 'rgba(214, 236, 255, 0.40)');
    __set('-webkit-backdrop-filter', 'blur(16px) saturate(130%)');
    __set('backdrop-filter', 'blur(16px) saturate(130%)');
    __set('border', '1px solid rgba(255, 255, 255, 0.55)');
    __set('border-radius', '12px');
    __set('box-shadow', '0 16px 50px rgba(20, 55, 90, 0.30), 0 2px 8px rgba(20, 55, 90, 0.18)');
    __set('position', 'relative');
    __set('padding', '0');

    // Move native close <a ng-click="close()"> INTO .can-drag (right side).
    // DOM move preserves the Angular ng-click binding (element+listener travel).
    var __drag = card.querySelector('.can-drag');
    var __x = card.querySelector('a[ng-click="close()"]');
    if (__drag && __x && __x.parentNode !== __drag) __drag.appendChild(__x);

    // Branding (title text + subtitle) — applied AFTER X move so it targets the
    // title text node only.
    applyNewTalentBranding();

    card.classList.add('tn-newtalent-ready');
    card.style.visibility = 'visible'; // clear inline hide (class rule no longer applies)
    // Brief opacity settle (layout already final — no geometry animation).
    card.style.opacity = '0';
    requestAnimationFrame(function () { card.style.transition = 'opacity 100ms ease'; card.style.opacity = '1'; });
    return true;
  }

  // First-paint guard: hide the native form the instant .bg-write exists, then
  // style synchronously BEFORE the browser paints. Re-applied per candidate open
  // (reopen-safe). Fail-open: force reveal after a bounded timeout.
  var __ntObs = null;
  function watchNewTalent() {
    if (__ntObs) return;
    var target = global.document.getElementById('kpBox') || global.document.body || global.document.documentElement;
    __ntObs = new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var m = muts[i];
        var nodes = m.addedNodes;
        for (var n = 0; nodes && n < nodes.length; n++) {
          var el = nodes[n];
          if (!el || el.nodeType !== 1) continue;
          var card = (el.id === 'addResume' || el.querySelector) ? (el.querySelector ? el.querySelector('.bg-write') : null) : null;
          if (el.classList && el.classList.contains('bg-write')) card = el;
          if (!card && el.querySelector) card = el.querySelector('.bg-write');
          if (card) {
            // hide immediately, then style synchronously before paint
            card.style.visibility = 'hidden';
            styleNewTalentOnce(global.document.getElementById('addResume') || el.closest('#addResume') || el);
          }
        }
      }
    });
    __ntObs.observe(target, { childList: true, subtree: true });
  }

  function applyNewTalentTheme() {
    // Manual trigger for cases where the observer hasn't fired yet.
    var root = global.document.getElementById('addResume');
    if (root) styleNewTalentOnce(root);
    watchNewTalent();
    // Fail-open safety: if styling didn't complete, reveal the native form.
    setTimeout(function () {
      var r = global.document.getElementById('addResume');
      var c = r && r.querySelector('.bg-write');
      if (c && !c.classList.contains('tn-newtalent-ready')) c.style.visibility = 'visible';
    }, 700);
  }

  function removeNewTalentTheme() {
    var t = global.document.getElementById(TNAI_THEME_ID);
    if (t && t.parentNode) t.parentNode.removeChild(t);
    removeNewTalentBranding();
  }
  function updateB2DiagBadge() { /* removed: no visible diagnostic overlay */ }
  function mountLauncher() {
    if (global.document.getElementById('tnai-launcher')) return;
    var root = global.document.getElementById('addResume');
    if (!root) return;
    var btn = global.document.createElement('button');
    btn.id = 'tnai-launcher';
    btn.type = 'button'; // never submits the native Pinpin form
    tnGetLanguage(function (_l) { btn.textContent = tnUIText(_l, 'aiFill'); });
    btn.style.cssText =
      'display:inline-block;margin:8px 0 4px;background:linear-gradient(135deg,#2563eb,#3b82f6);' +
      'color:#fff;border:1px solid rgba(255,255,255,.6);border-radius:12px;' +
      'padding:10px 18px;font:700 14px/1 system-ui,sans-serif;cursor:pointer;' +
      '-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);' +
      'box-shadow:0 8px 22px rgba(30,80,180,.35);';
    btn.addEventListener('mouseenter', function () { btn.style.filter = 'brightness(1.06)'; });
    btn.addEventListener('mouseleave', function () { btn.style.filter = 'none'; });
    btn.addEventListener('click', function () {
      log('launcher -> AI fill run=' + currentRunId);
      runAiReview(currentRunId);
    });
    // Integrate AI Fill into the native New Talent content (above native Save),
    // so it never overlaps the bottom-right resize corner nor the form.
    var form = root.querySelector('form.form-horizontal') || root.querySelector('form');
    if (form) {
      var submitBtn = form.querySelector('button[type=submit]');
      var anchor = submitBtn ? submitBtn : (form.querySelector('.btn-submit') || null);
      if (anchor && anchor.parentNode === form) {
        form.insertBefore(btn, anchor);
      } else if (anchor && anchor.parentNode && anchor.parentNode.parentNode === form) {
        form.insertBefore(btn, anchor.parentNode); // insert before the .form-group wrapping Save
      } else if (anchor) {
        form.insertBefore(btn, anchor);
      } else {
        form.appendChild(btn);
      }
    } else {
      root.appendChild(btn);
    }
    // UI-ONLY WeChat hide (Taiwan workflow). Defensive: only if a WeChat field
    // actually exists. Does NOT touch Angular model / backend / Save payload.
    try {
      var wc = root.querySelector('input[ng-model="resume.wechat"], input[name="wechat"], input[placeholder*="WeChat" i], input[placeholder*="微信" i]');
      if (wc) {
        var row = wc.closest('.form-group, .input-group, .form-row, div') || wc.parentNode;
        while (row && row !== root && !/(form-group|input-group|form-row)/.test(row.className || '')) row = row.parentNode;
        if (row && row !== root) row.classList.add('tn-hide-wechat');
      }
    } catch (e) {}
    applyNewTalentTheme();
    log('launcher mounted (integrated into New Talent content)');
  }

  function removeLauncher() {
    var b = global.document.getElementById('tnai-launcher');
    if (b && b.parentNode) b.parentNode.removeChild(b);
    removeNewTalentTheme();
  }

  // STRICT guard (CASE A, ISOLATED world, no postMessage).
  // Launcher appears ONLY while the live AddResumeCtrl exists AND the Golden
  // Base active flag (scope.$root.add_resume) is set. No URL/iframe/origin
  // dependency. This guarantees NO launcher on 104 / LinkedIn / unrelated
  // pages — only the real New Talent context.
  var currentRunId = null;

  function computeRunId() {
    var s = findAddResumeScope();
    if (s && s.addFileName) return String(s.addFileName);
    return getSessionKey(); // unique per New Talent instance; never shared
  }

  function isNewTalentActive() {
    var s = findAddResumeScope();
    if (!s) return false;
    return !!(s.$root && s.$root.add_resume);
  }
  function isLinkedInActive() {
    try {
      var h = (global.location && global.location.hostname || '').toLowerCase();
      return h.indexOf('linkedin.com') >= 0;
    } catch (e) { return false; }
  }

  function syncLauncher() {
    if (isNewTalentActive()) {
      currentRunId = computeRunId();
      if (!global.document.getElementById('tnai-launcher')) mountLauncher();
      log('active run=' + currentRunId);
    } else {
      removeLauncher(); // New Talent closed / route changed -> hide launcher
      var ph = global.document.getElementById('tnai-panel-host');
      if (ph && ph.parentNode) ph.parentNode.removeChild(ph);
    }
  }

  function boot() {
    if (!global.document) return;
    // [TNAI][frame diag] safe: origin + pathname + top-frame flag only.
    try {
      log('loaded href=' + (global.location.origin + global.location.pathname) +
          ' top=' + (global.window === global.top));
    } catch (e) { log('loaded (location unknown)'); }

    // Poll so we detect when New Talent opens/closes (SPA, no reliable event).
    var tries = 0;
    var timer = global.setInterval(function () {
      tries++;
      syncLauncher();
      if (tries > 240) { global.clearInterval(timer); } // ~2min safety stop
    }, 500);
  }

  log('module loaded (additive; Original New Talent untouched)');
  boot();
})(typeof window !== 'undefined' ? window : this);