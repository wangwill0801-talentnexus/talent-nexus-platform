/*
 * TNTRACE-SW — service-worker tracer. DIAGNOSTIC BUILD ONLY.
 *
 * Wraps the global fetch to observe the Pinpin REST calls the MV3 service
 * worker makes. Page DevTools cannot see this traffic; view it at
 * chrome://extensions -> PINPINSOFT -> "Service worker".
 *
 * Behaviour-neutral: the wrapper forwards the original arguments untouched,
 * returns the original promise, and never consumes the body (it clones before
 * reading, and only when the endpoint is one we trace). No retries, no sleeps,
 * no payload edits, no error swallowing — rejections propagate unchanged.
 *
 * Loaded by background.js via importScripts BEFORE the request map is built.
 *
 * PRIVACY: logs only endpoint label, HTTP status, response `data` TYPE and
 * LENGTH. Never the URL/host, filename, response body, cookies or tokens.
 *
 * REMOVAL: delete this file and its importScripts line in background.js.
 */
(function () {
  'use strict';

  if (self.__tntraceSw) return;
  self.__tntraceSw = true;

  var T = '[TNTRACE-SW]';
  function log() {
    var a = Array.prototype.slice.call(arguments);
    a.unshift(T);
    try { console.log.apply(console, a); } catch (e) {}
  }

  // Endpoint path fragment -> label. Order matters: htmlfileauto* (duplicate
  // check) must be matched BEFORE the bare htmlfile (import).
  var ENDPOINTS = [
    ['/rest/file/htmlfileauto', 'checkRepeat'],
    ['/rest/file/htmlfile', 'htmlfile'],
    ['/rest/file/temp', 'temp'],
    ['/rest/data/options', 'loadStatus'],
    ['/rest/folder/list', 'loadFavorite/CustomFolders'],
    ['/rest/data/industry', 'loadIndustry'],
    ['/rest/data/function', 'loadFunction'],
    ['/rest/data/tags', 'loadTags'],
    ['/rest/joborder/listbyaddtoproject', 'loadJobs'],
    ['/rest/resume/addbyplug', 'addbyplug'],
    ['/rest/file/bind_candidatecrx', 'bind_candidate'],
    ['/rest/user/loginsimulation', 'loginsimulation']
  ];

  function labelFor(url) {
    var u = String(url || '');
    for (var i = 0; i < ENDPOINTS.length; i++) {
      if (u.indexOf(ENDPOINTS[i][0]) > -1) return ENDPOINTS[i][1];
    }
    return null;
  }

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

  var origFetch = self.fetch;

  self.fetch = function (input, init) {
    var url = (input && input.url) ? input.url : input;
    var label = labelFor(url);

    if (!label) return origFetch.apply(this, arguments);

    log(label + ' request started');

    var p = origFetch.apply(this, arguments);

    // Observe only. Clone so the real consumer still gets an unread body.
    p.then(function (res) {
      try {
        log(label + ' HTTP status: ' + res.status);
        // Only the import call's payload shape is diagnostically interesting.
        if (label === 'htmlfile') {
          res.clone().json().then(function (j) {
            var d = j && j.data;
            log('htmlfile response data type: ' +
              (typeOf(d) === 'string' ? 'string' : 'non-string (' + typeOf(d) + ')'));
            log('htmlfile response data length: ' + lengthOf(d));
          }).catch(function () {
            log('htmlfile response not JSON-parseable');
          });
        }
      } catch (e) {}
    }).catch(function () {
      log(label + ' request FAILED (network/rejected)');
    });

    return p;
  };

  log('tracer active (service worker) — diagnostic build, no behaviour change');
})();
