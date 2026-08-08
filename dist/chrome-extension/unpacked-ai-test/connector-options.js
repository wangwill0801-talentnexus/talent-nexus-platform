/*
 * connector-options.js — Talent Nexus Connector Options behavior.
 *
 * External (MV3 CSP-safe): loaded by options.html via <script src>. No inline JS.
 *
 * Authoritative storage: Pinpin keeps the ATS/server base URL in the SAME
 * chrome.storage.sync key "config" (field "api") consumed across the extension
 * at runtime (Config.api -> all /rest/... endpoints, cookies, navigation).
 * We integrate with that EXACT mechanism so the Interface Language selector is
 * a REAL consumer, not a decorative parallel setting.
 *
 * Single source of truth: interfaceLanguage = "zh-TW" | "en" | "custom".
 *   zh-TW -> config.api = http://ats.talentnexus.com.tw:5679/  + interfaceLanguage=zh-TW
 *   en    -> config.api = http://ats-en.talentnexus.com.tw:5678/ + interfaceLanguage=en
 *   custom-> config.api preserved exactly (edited only under Advanced) + interfaceLanguage=custom
 *
 * Invariants:
 *   - Opening Options NEVER overwrites an existing custom config.api.
 *   - Changing nothing NEVER modifies configuration.
 *   - Selecting a preset from custom intentionally switches config.api to it.
 *   - NO /webapp/ in any preset.
 */
(function () {
  'use strict';

  var ZH = 'http://ats.talentnexus.com.tw:5679/';
  var EN = 'http://ats-en.talentnexus.com.tw:5678/';
  var PRESETS = { 'zh-TW': ZH, 'en': EN };

  // Talent Nexus-owned Options labels (only our strings get localized).
  var LABELS = {
    'zh-TW': {
      connector: 'Talent Nexus Connector',
      atsLangLabel: 'ATS 介面語言',
      advanced: '進階設定',
      customAtsLabel: '自訂 ATS 端點',
      customNote: '未知的自訂網址會被保留，不會被預設值覆寫。',
      save: '儲存設定',
      saved: '已儲存',
      preview: function (u) { return 'ATS 基礎位址：@url:`' + u + '`'; }
    },
    'en': {
      connector: 'Talent Nexus Connector',
      atsLangLabel: 'ATS Interface Language',
      advanced: 'Advanced',
      customAtsLabel: 'Custom ATS endpoint',
      customNote: 'Unknown custom URLs are preserved and not overwritten by presets.',
      save: 'Save Settings',
      saved: 'Saved',
      preview: function (u) { return 'ATS base: @url:`' + u + '`'; }
    }
  };
  function ui(lang) { return LABELS[lang] || LABELS['zh-TW']; }

  var langEl = document.getElementById('tnAtsLang');
  var customEl = document.getElementById('tnAtsCustom');
  var previewEl = document.getElementById('tnAtsUrlPreview');
  var savedEl = document.getElementById('tnAtsSaved');
  if (!langEl) return; // Options page not mounted

  // Read authoritative config via Pinpin's utils.store (chrome.storage.sync).
  function loadConfig(cb) {
    if (typeof utils !== 'undefined' && utils.store) {
      utils.store.get('config', function (cfg) {
        cb(cfg && typeof cfg === 'object' ? cfg : {});
      });
    } else if (chrome && chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.get(['config'], function (v) { cb((v && v.config) || {}); });
    } else {
      cb({});
    }
  }
  function saveConfig(cfg, cb) {
    if (typeof utils !== 'undefined' && utils.store) {
      utils.store.set('config', cfg, { callback: cb });
    } else if (chrome && chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.set({ config: cfg }, cb);
    } else if (cb) { cb(); }
  }

  // Resolve current authoritative API -> interfaceLanguage state.
  function stateFromApi(api) {
    if (api === ZH) return 'zh-TW';
    if (api === EN) return 'en';
    return 'custom';
  }

  var currentApi = '';

  function applyLabels(lang) {
    var d = ui(lang);
    var set = function (key, val) {
      var el = document.querySelector('[data-tn="' + key + '"]');
      if (el) el.textContent = val;
    };
    set('connector', d.connector);
    set('atsLangLabel', d.atsLangLabel);
    set('advanced', d.advanced);
    set('customAtsLabel', d.customAtsLabel);
    set('customNote', d.customNote);
    set('save', d.save);
    set('saved', d.saved);
  }

  function render(lang) {
    applyLabels(lang);
    if (lang === 'custom') {
      previewEl.textContent = (ui(lang).preview(currentApi));
    } else {
      previewEl.textContent = ui(lang).preview(PRESETS[lang]);
    }
  }

  function load() {
    loadConfig(function (cfg) {
      currentApi = (typeof cfg.api === 'string') ? cfg.api : '';
      var lang = stateFromApi(currentApi);
      // If a stored interfaceLanguage exists and matches a known state, honor it;
      // otherwise infer from the API URL.
      if (cfg.interfaceLanguage === 'zh-TW' || cfg.interfaceLanguage === 'en' || cfg.interfaceLanguage === 'custom') {
        lang = cfg.interfaceLanguage;
      }
      langEl.value = lang;
      if (lang === 'custom') {
        customEl.value = currentApi; // expose exact custom URL under Advanced
      } else {
        customEl.value = '';
      }
      render(lang);
    });
  }

  langEl.addEventListener('change', function () { render(langEl.value); });

  document.getElementById('tnAtsSave').addEventListener('click', function () {
    var lang = langEl.value;
    loadConfig(function (cfg) {
      cfg = cfg || {};
      if (lang === 'zh-TW' || lang === 'en') {
        // Intentional switch to a preset -> update authoritative ATS base + language.
        cfg.api = PRESETS[lang];
        cfg.interfaceLanguage = lang;
      } else if (lang === 'custom') {
        // Preserve custom URL exactly (use Advanced field if edited, else existing).
        var edited = customEl.value && customEl.value.trim();
        cfg.api = edited ? edited : (cfg.api || '');
        cfg.interfaceLanguage = 'custom';
      }
      saveConfig(cfg, function () {
        savedEl.style.display = 'inline';
        setTimeout(function () { savedEl.style.display = 'none'; }, 2000);
      });
    });
  });

  load();
})();
