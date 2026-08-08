/*
 * Talent Nexus — 104 (vip.104.com.tw) site adapter  [POC]
 * Additive module. Exposes window.TN104. Does not modify any existing
 * extension behaviour; the legacy chains only call into it.
 *
 * Compliance: captures ONLY what the authenticated user's own session already
 * renders. No unlocking, no credit-consuming actions, no private APIs,
 * no unmasking, no crawling. Masked contact info is a tolerated normal state.
 * Logging: mode / selector / char-count / booleans only — never PII or HTML.
 */
(function (global) {
  'use strict';

  var LOG_PREFIX = '[TN104]';

  function log() {
    try {
      var a = Array.prototype.slice.call(arguments);
      a.unshift(LOG_PREFIX);
      console.log.apply(console, a);
    } catch (e) {}
  }

  // innerText is undefined outside a rendering context (jsdom / detached).
  function textOf(el) {
    if (!el) return '';
    return String(el.innerText || el.textContent || '').trim();
  }

  var HOST = 'vip.104.com.tw';
  var ROUTE_HINT = 'searchresumemaster';

  var LAYOUT_SELECTOR = '.resume-master-layout.search-resume-master';
  var CARD_SELECTOR = '.vip-resume-card.resume-card';
  var RESUME_WRAPPER_SELECTOR = '.standard-resume-wrapper';
  var RESUME_SELECTOR = '.standard-resume';

  // zh-TW resume semantics; used only to qualify a route-only match.
  var SEMANTIC_LABELS = [
    '工作經歷', '教育背景', '個人資料', '求職條件', '技能', '語文能力',
    '證照', '自傳', '希望職稱', '最高學歷', '最近工作', '居住地', '學歷'
  ];

  // Stripped from the captured clone (noise / non-resume UI).
  var STRIP_SELECTORS = [
    'script', 'noscript', 'iframe', 'object', 'embed', 'style', 'link',
    'canvas', 'svg use',
    'header', 'nav', 'footer', 'menu',
    '[role="navigation"]', '[role="banner"]', '[role="dialog"]',
    '[role="alertdialog"]', '[role="menu"]', '[role="tooltip"]',
    '.modal', '.modal-backdrop', '.v-modal', '.el-dialog', '.el-dialog__wrapper',
    '.el-tooltip__popper', '.el-popper', '.popover', '.tooltip', '.dropdown-menu',
    '.chat', '.chatbot', '.chat-room', '.im-panel',
    '.advertisement', '.ad', '.ads', '.gtm', '.ga',
    '.similar-resume', '.recommend', '.recommend-list', '.recommendation',
    '.suggest-list', '.other-resume', '.resume-recommend',
    '.floating', '.float-bar', '.fixed-bar', '.back-top', '.go-top',
    '.sidebar', '.side-bar', '.aside', 'aside',
    '.pagination', '.paginate',
    '.interview-dialog', '.message-dialog', '.invite-dialog',
    '#kpBox', '.kpBox', '[id^="pp-"]', '[class^="pp-plugin"]'
  ];

  // Third-party recruiter remarks. Extracted separately AND removed from the
  // parser payload so a recruiter's name is never parsed as the candidate's.
  var REMARK_SELECTORS = [
    '.remark', '.remarks', '.company-remark', '.recruiter-remark',
    '.internal-remark', '.note-area', '.resume-note', '.private-note',
    '[data-remark]', '[class*="remark"]', '[class*="note-block"]'
  ];

  function q(sel, root) {
    try {
      return (root || document).querySelector(sel);
    } catch (e) {
      return null;
    }
  }

  function qa(sel, root) {
    try {
      return Array.prototype.slice.call((root || document).querySelectorAll(sel));
    } catch (e) {
      return [];
    }
  }

  function hostMatches() {
    return String(location.hostname || '').toLowerCase() === HOST;
  }

  function routeMatches() {
    return String(location.pathname || '').toLowerCase().indexOf(ROUTE_HINT) > -1;
  }

  function semanticScore(root) {
    var t = textOf(root || document.body);
    if (!t) return 0;
    var n = 0;
    for (var i = 0; i < SEMANTIC_LABELS.length; i++) {
      if (t.indexOf(SEMANTIC_LABELS[i]) > -1) n++;
    }
    return n;
  }

  /**
   * Multi-signal detection. Host is mandatory. Structural DOM alone is enough;
   * a route-only match must be backed by >= 2 zh-TW resume labels so the
   * adapter never fires on unrelated 104 pages.
   */
  function isResumePage() {
    if (!hostMatches()) return false;

    var layout = q(LAYOUT_SELECTOR);
    var card = q(CARD_SELECTOR);
    var resume = q(RESUME_SELECTOR) || q(RESUME_WRAPPER_SELECTOR);

    if (layout || card || resume) return true;
    if (routeMatches() && semanticScore(document.body) >= 2) return true;
    return false;
  }

  function stripFrom(node, selectors) {
    for (var i = 0; i < selectors.length; i++) {
      var found = qa(selectors[i], node);
      for (var j = 0; j < found.length; j++) {
        if (found[j] && found[j].parentNode) {
          found[j].parentNode.removeChild(found[j]);
        }
      }
    }
  }

  function stripEventAttributes(node) {
    var all = qa('*', node);
    all.push(node);
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (!el || !el.attributes) continue;
      var names = [];
      for (var k = 0; k < el.attributes.length; k++) {
        var nm = el.attributes[k].name;
        if (nm && nm.toLowerCase().indexOf('on') === 0) names.push(nm);
      }
      for (var m = 0; m < names.length; m++) {
        try { el.removeAttribute(names[m]); } catch (e) {}
      }
    }
  }

  /** Clone into a detached node, sanitize there. Live DOM is never mutated. */
  function sanitizeClone(el) {
    if (!el) return null;
    var clone = el.cloneNode(true);
    stripFrom(clone, STRIP_SELECTORS.concat(REMARK_SELECTORS));
    stripEventAttributes(clone);
    return clone;
  }


  function outer(el) {
    return el && el.outerHTML ? el.outerHTML : '';
  }

  /** Internal recruiter remarks — kept OUT of the parser payload. */
  function extractInternalRemarkText() {
    var scope = q(LAYOUT_SELECTOR) || document.body;
    var parts = [];
    for (var i = 0; i < REMARK_SELECTORS.length; i++) {
      var nodes = qa(REMARK_SELECTORS[i], scope);
      for (var j = 0; j < nodes.length; j++) {
        var t = textOf(nodes[j]);
        if (t && parts.indexOf(t) === -1) parts.push(t);
      }
    }
    return parts.join('\n');
  }

  function wrap(sections) {
    var body = '';
    for (var i = 0; i < sections.length; i++) {
      if (!sections[i].html) continue;
      body += '<section data-source="' + sections[i].name + '">' +
        sections[i].html + '</section>';
    }
    return '<!doctype html><html lang="zh-TW"><head><meta charset="UTF-8">' +
      '<title>104 Candidate Resume</title></head><body>' + body +
      '</body></html>';
  }

  function bodyFallback() {
    var clone = sanitizeClone(document.body);
    return clone ? clone.innerHTML : '';
  }

  /**
   * Find the summary card belonging to the OPENED candidate.
   *
   * On SearchResumeMaster / hunter/master the left pane is a LIST of
   * candidate cards. A plain querySelector returns the FIRST card, which is
   * usually a DIFFERENT person from the resume open on the right. That put
   * candidate B's name and phone at the top of the parser payload, and Pinpin
   * created candidate B while the recruiter was looking at candidate A.
   *
   * Strategy, strictest first:
   *   1. card whose id/data-id matches the opened resume wrapper
   *   2. card marked active/selected/current by the UI
   *   3. card matching the ?id= / path id in the URL
   *   4. no card at all -- the resume body alone is correct and unambiguous,
   *      which is far safer than guessing and importing the wrong person.
   *
   * @param {Element|null} wrapper opened resume container, if found
   * @returns {{el: Element|null, how: string}}
   */
  function findOpenCandidateCard(wrapper) {
    var cards = qa(CARD_SELECTOR);
    if (!cards.length) return { el: null, how: 'none' };
    if (cards.length === 1) return { el: cards[0], how: 'only-card' };

    // 1. id agreement with the opened resume
    var wid = wrapper && (wrapper.getAttribute('data-id') ||
                          wrapper.getAttribute('data-resume-id') ||
                          wrapper.getAttribute('data-idno'));
    if (wid) {
      for (var i = 0; i < cards.length; i++) {
        var cid = cards[i].getAttribute('data-id') ||
                  cards[i].getAttribute('data-resume-id') ||
                  cards[i].getAttribute('data-idno');
        if (cid && cid === wid) return { el: cards[i], how: 'id-match' };
      }
    }

    // 2. UI selection state
    var ACTIVE = ['active', 'is-active', 'selected', 'is-selected',
                  'current', 'is-current', 'on'];
    for (var j = 0; j < cards.length; j++) {
      var cl = cards[j].classList;
      if (!cl) continue;
      for (var k = 0; k < ACTIVE.length; k++) {
        if (cl.contains(ACTIVE[k])) return { el: cards[j], how: 'active-class' };
      }
      if (cards[j].getAttribute('aria-selected') === 'true') {
        return { el: cards[j], how: 'aria-selected' };
      }
    }

    // 3. id carried in the URL
    var uid = '';
    try {
      var m = /[?&]id=([^&#]+)/.exec(location.search || '');
      uid = m ? decodeURIComponent(m[1]) : '';
    } catch (e) { uid = ''; }
    if (uid) {
      for (var n = 0; n < cards.length; n++) {
        var nid = cards[n].getAttribute('data-id') ||
                  cards[n].getAttribute('data-resume-id') || '';
        if (nid && nid === uid) return { el: cards[n], how: 'url-id' };
      }
    }

    // 4. Ambiguous. Omit the summary rather than risk the wrong identity.
    return { el: null, how: 'ambiguous-omitted' };
  }

  /**
   * Capture ladder:
   *  1. opened candidate's summary card + resume wrapper
   *  2. .standard-resume
   *  3. <article> inside the resume layout
   *  4. sanitized body (last resort)
   * @returns {{html:string, mode:string, chars:number, ok:boolean}}
   */
  function capture104Resume() {
    var mode = '', html = '';

    var wrapper = q(RESUME_WRAPPER_SELECTOR);
    var picked = findOpenCandidateCard(wrapper);
    var card = picked.el;

    if (card || wrapper) {
      var sections = [];
      if (card) sections.push({ name: '104-summary', html: outer(sanitizeClone(card)) });
      if (wrapper) sections.push({ name: '104-resume', html: outer(sanitizeClone(wrapper)) });
      if (!wrapper) {
        var std = q(RESUME_SELECTOR);
        if (std) sections.push({ name: '104-resume', html: outer(sanitizeClone(std)) });
      }
      html = wrap(sections);
      mode = card && wrapper ? 'card+wrapper' : (card ? 'card' : 'wrapper');
    }

    if (!html) {
      var standard = q(RESUME_SELECTOR);
      if (standard) {
        html = wrap([{ name: '104-resume', html: outer(sanitizeClone(standard)) }]);
        mode = 'standard-resume';
      }
    }

    if (!html) {
      var art = q(LAYOUT_SELECTOR + ' article');
      if (art) {
        html = wrap([{ name: '104-resume', html: outer(sanitizeClone(art)) }]);
        mode = 'layout-article';
      }
    }

    if (!html) {
      var fb = bodyFallback();
      if (fb) {
        html = wrap([{ name: '104-resume', html: fb }]);
        mode = 'body-fallback';
      }
    }

    var res = {
      html: html || '',
      mode: mode || 'none',
      chars: (html || '').length,
      ok: !!html
    };
    // cardPick tells you WHY a summary was (or was not) included. If you ever
    // see cardPick=ambiguous-omitted the summary was deliberately dropped to
    // avoid importing the wrong person.
    log('capture', 'mode=' + res.mode, 'cardPick=' + picked.how,
        'cards=' + qa(CARD_SELECTOR).length,
        'chars=' + res.chars, 'ok=' + res.ok);
    return res;
  }

  /** Auto/precise duplicate check — reuses the extension's own checkRepeat(). */
  function check(clickType) {
    var fn = global.checkRepeat;
    if (typeof fn !== 'function') {
      log('checkRepeat unavailable');
      return false;
    }
    var r = capture104Resume();
    if (!r.ok) {
      log('duplicate skipped: no capture');
      return false;
    }
    log('duplicate -> checkRepeat', 'click=' + (clickType || 'auto'));
    fn(r.html, clickType || '');
    return true;
  }

  /**
   * Resolve the Pinpin API host exactly the way the legacy branches do.
   *
   * The legacy code writes a bare `Config.api`. `Config` is declared with
   * `var Config` at the top of js/page.js, so inside the content script's
   * shared scope the bare identifier resolves even in engines/contexts where
   * `window.Config` is not reliably populated. Reading only `global.Config`
   * silently yielded '' — which produced "capture works, but save and the
   * status dropdown do nothing", because the import file was never bound.
   *
   * Order: bare identifier first (what the golden path uses), then window.
   * Returns '' only if genuinely unavailable, and logs that fact.
   */
  function resolveApiHost() {
    var host = '';
    try {
      // eslint-disable-next-line no-undef
      if (typeof Config !== 'undefined' && Config && Config.api) host = Config.api;
    } catch (e) {}
    if (!host && global.Config && global.Config.api) host = global.Config.api;
    if (!host) log('WARNING: Config.api unresolved — import will likely fail');
    return host || '';
  }

  /** Manual import — reuses the extension's own addResume.normal message. */
  function addResume() {
    var r = capture104Resume();
    if (!r.ok) {
      log('import skipped: no capture');
      return false;
    }
    var host = resolveApiHost();
    try {
      utils.message.sendMsg({
        type: 'request.api.addResume.normal',
        settings: {
          type: 'post',
          data: {
            data: JSON.stringify({
              html: [r.html],
              host: host,
              _id: ''
            })
          }
        }
      });
    } catch (e) {
      log('import send failed');
      return false;
    }
    // Log only whether a host was resolved — never the host value itself.
    log('import -> request.api.addResume.normal',
      'chars=' + r.chars, 'hostResolved=' + !!host);
    return true;
  }

  global.TN104 = {
    HOST: HOST,
    isResumePage: isResumePage,
    capture104Resume: capture104Resume,
    extractInternalRemarkText: extractInternalRemarkText,
    check: check,
    addResume: addResume,
    _internal: {
      textOf: textOf,
      sanitizeClone: sanitizeClone,
      semanticScore: semanticScore,
      STRIP_SELECTORS: STRIP_SELECTORS,
      REMARK_SELECTORS: REMARK_SELECTORS
    }
  };
})(typeof window !== 'undefined' ? window : this);
