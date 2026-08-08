/*
 * TNTRACE — content-script tracer. DIAGNOSTIC BUILD ONLY.
 *
 * Observes CHAIN A (resume import) and CHAIN B (New Talent metadata init)
 * by wrapping utils.message.sendMsg / utils.message.register.
 *
 * It changes NO behaviour: every wrapper forwards the original arguments
 * untouched and returns the original return value. No payload is modified,
 * no sleep is added, no call is suppressed or reordered.
 *
 * Loaded AFTER js/core/utils.js and BEFORE js/versions/v1/default/page.js so
 * that the registrations page.js makes are wrapped as they are created.
 *
 * PRIVACY: logs only types, booleans, counts and lengths. Never resume HTML,
 * candidate name/phone/email, temp filename, host, cookies, tokens, or any
 * response body.
 *
 * REMOVAL: delete this file and its one line in manifest.json.
 */
(function () {
  'use strict';

  if (typeof utils === 'undefined' || !utils.message) return;
  if (utils.__tntrace) return;
  utils.__tntrace = true;

  var T = '[TNTRACE]';
  function log() {
    var a = Array.prototype.slice.call(arguments);
    a.unshift(T);
    try { console.log.apply(console, a); } catch (e) {}
  }

  // ---- state (booleans/counters only) -------------------------------------
  var state = {
    gateLogged: false,
    addFileNameSeen: false,
    getAddInfoSent: false
  };

  function typeOf(v) {
    if (v === null) return 'null';
    if (v === undefined) return 'undefined';
    if (Array.isArray(v)) return 'array';
    return typeof v;
  }

  function lengthOf(v) {
    if (typeof v === 'string' || Array.isArray(v)) return v.length;
    if (v && typeof v === 'object') { try { return Object.keys(v).length; } catch (e) {} }
    return -1;
  }

  // ---- CHAIN B: metadata init requests ------------------------------------
  var CHAIN_B = {
    'request.api.loadStatus': 'loadStatus',
    'request.api.loadFavorite': 'loadFavorite',
    'request.api.loadCustomFolders': 'loadCustomFolders',
    'request.api.loadIndustry': 'loadIndustry',
    'request.api.loadFunction': 'loadFunction',
    'request.api.loadTags': 'loadTags',
    'request.api.loadJobs': 'loadJobs'
  };

  // ---- wrap sendMsg (outbound) --------------------------------------------
  var origSendMsg = utils.message.sendMsg;
  utils.message.sendMsg = function (msg, cb) {
    try {
      var t = msg && msg.type;

      // CHAIN B: the metadata burst is the first thing the add_resume gate does.
      // loadJobs is the gate's first call, so it is our gate marker.
      if (t === 'request.api.loadJobs' && !state.gateLogged) {
        state.gateLogged = true;
        log('add_resume gate entered');
      }

      if (CHAIN_B[t]) log(CHAIN_B[t] + ' sent');

      // CHAIN A
      if (t === 'request.api.addResume.normal') {
        log('addResume.normal sent');
      }
      if (t === 'request.api.getAddInfo') {
        state.getAddInfoSent = true;
        var hasFilename = !!(msg.settings && msg.settings.data &&
          msg.settings.data.filename);
        // Log only whether a filename was attached, never its value.
        log('getAddInfo sent', 'filenameAttached=' + hasFilename);
      }
      if (t === 'request.api.submit') {
        // /rest/resume/addbyplug — only reachable from the Save handler.
        log('Save click fired');
        log('addbyplug sent');
      }
    } catch (e) {}
    return origSendMsg.apply(this, arguments);
  };

  // ---- wrap register (inbound callbacks) ----------------------------------
  var origRegister = utils.message.register;
  utils.message.register = function () {
    var listeners = Array.prototype.slice.call(arguments);

    listeners.forEach(function (l) {
      if (!l || typeof l.callback !== 'function') return;
      var type = l.type;
      var inner = l.callback;

      l.callback = function (msg) {
        try {
          var t = (msg && msg.type) || type;
          var resp = msg && msg.response;

          if (CHAIN_B[t]) {
            log(CHAIN_B[t] + ' response received');
            if (t === 'request.api.loadStatus') {
              var n = Array.isArray(resp) ? resp.length
                    : (resp && Array.isArray(resp.data) ? resp.data.length : -1);
              log('status option count:', n);
            }
          }

          if (t === 'request.api.addResume.normal') {
            log('addResume.normal callback received');
            var d = resp && resp.data;
            log('response.data type:',
              typeOf(d) === 'string' ? 'string' : 'non-string (' + typeOf(d) + ')');
            log('response.data length:', lengthOf(d));
            // Mirrors page.js: addFileName = response.data.substring(20)
            var resolved = typeof d === 'string' && d.length > 20;
            state.addFileNameSeen = resolved;
            log('addFileName resolved:', resolved);
          }

          if (t === 'request.api.getAddInfo') {
            log('getAddInfo callback received');
            // page.js reads: response[0].extract
            var usable = !!(resp && resp[0] && resp[0].extract);
            log('getAddInfo usable data:', usable);
          }
        } catch (e) {}
        return inner.apply(this, arguments);
      };
    });

    return origRegister.apply(this, listeners);
  };

  log('tracer active (content) — diagnostic build, no behaviour change');
})();
