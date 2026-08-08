// [TNC][EARLY PING] Registered at the very FIRST top-level statement, BEFORE
// importScripts / Golden init, with ZERO dependency on utils/Config/Pinpin/B2.
// Proves whether the MV3 service worker starts and can answer a message at all.
(function () {
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage && chrome.runtime.onMessage.addListener) {
      chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
        if (msg && msg.type === 'tnai.runtime.ping') {
          try { sendResponse({ ok: true, runtimeId: String(chrome.runtime.id || ''), build: TNAI_B2_BG_BUILD, boot: true }); } catch (e) { sendResponse({ ok: false, boot: true }); }
          return true;
        }
        return false;
      });
    }
  } catch (e) {}
})();
var TNAI_B2_BG_BUILD = "b8c65b2";
// const { marsStroke } = require("fontawesome");
// import utils from "./js/core/utils2.js";
importScripts("./js/core/utils.js")
// Note: tntrace_sw.js is a diagnostic tracer kept in working/ but NOT shipped
// in production AI builds; do not importScripts it here or the SW fails to load.

// [TNC][TEMP DIAGNOSTIC] background service worker reached top-level execution
console.log("[TNC] background loaded");
// console.log(utils);

// 初始化动态加载服务器上的js
var Config = {};
var Schema = {};

// console.log('background: ', '插件后台启动');
(function () {
  utils.storeAsync.get("config").then(function (config) {
    // console.log('background: ', '插件配置信息: ', config);
    config = config;
    Config = config;
    if (!config) {
      // console.log('background: ', '插件还未配置，自动打开配置页面');
      chrome.runtime.openOptionsPage();
      return;
    }
  });
})();

// [TNC][TEMP DIAGNOSTIC] registering action click listener
console.log("[TNC] registering action listener");
chrome.action.onClicked.addListener(function (tab) {
  // [TNC][TEMP DIAGNOSTIC] user clicked the toolbar action
  console.log("[TNC] action clicked");
  utils.message.sendToTab({ type: "browserAction" }, tab.id);
});

utils.message.register({
  type: "img.send",
  callback: function (msg) {
    //console.log(111);
    try {
      chrome.tabs.captureVisibleTab(
        null,
        {
          format: "png",
          quality: 100,
        },
        function (data) {
          //console.log(data);
          utils.message.sendBgMsg({ type: "img.get", response: data });
        }
      );
    } catch (err) {}
  },
});
utils.message.register({
  type: "linkedin.checkRepeat",
  callback: function (msg, sender, sendResponse) {
    // console.log(333);
    setTimeout(() => {
      utils.message.sendBgMsg({ type: "linkedin.checkRepeatReceived" });
    }, 2500);
    sendResponse({ data: "success" });
    return true;
  },
});

// chrome.webNavigation.onCompleted.addListener((details) => {
//     if (details.frameId !== 0) { // 仅处理非顶层iframe
//         console.log(123);
//       chrome.scripting.executeScript({
//         target: { tabId: details.tabId, frameIds: [details.frameId] },
//         files: ['js/release/zhipin2.js']
//       });
//     }
//   }, { url: [{ urlMatches: "https://www.zhipin.com/web/frame/c-resume/*" }] });
// utils.message.register({
//     type: 'overrideCanvas', callback: function (msg, sender) {
//         console.log(333);
//         chrome.scripting.executeScript({
//             target: {tabId: sender.tab.id},
//             func: () => {
//                 console.log(111);
//                 const iframe = document.querySelector('.iframe-resume-detail iframe');
//                 const iframeWindow = iframe.contentWindow;
//                 console.log(iframeWindow);
//                 const origOpen = window.XMLHttpRequest.prototype.open;
//                 window.XMLHttpRequest.prototype.open = function(method, url) {
//                     this._isTarget = url && url.startsWith('/wapi/zpjob/view/geek/info/v2');
//                     console.log('[plugin.js] XHR拦截', this._isTarget, url);
//                     return origOpen.apply(this, arguments);
//                 };
//                 const origSend = window.XMLHttpRequest.prototype.send;
//                 window.XMLHttpRequest.prototype.send = function() {
//                     if (this._isTarget) {
//                         this.addEventListener('load', function() {
//                             try {
//                                 const contentType = this.getResponseHeader('content-type') || '';
//                                 if (this.response && contentType.includes('application/json')) {
//                                     let data = this.responseType === 'json' ? this.response : JSON.parse(this.responseText);
//                                     if (data && data.zpData && data.zpData.encryptGeekDetailInfo) {
//                                         window.top.postMessage({__zhipin_decrypt: data.zpData.encryptGeekDetailInfo}, '*');
//                                     }
//                                 }
//                             } catch (e) {
//                                 console.warn('[plugin.js] XHR拦截解密失败', e);
//                             }
//                         });
//                     }
//                     return origSend.apply(this, arguments);
//                 };
//             },
//             args: [],
//             world: "MAIN"
//         });
//     }
// });

// console.log(this);
//接口调用
(function () {
  var Config = {};
  utils.storeAsync.get("config").then(function (config) {
    // console.log('background: ', '插件配置信息: ', config);
    config = config || { server: "" };
    Config = config;
    var requests = {
      "request.api.UserContext": Config.api + "/rest/user/context",
      "request.plugin.toolbox": "./versions/v1/default/toolbox.html",
      "request.api.checkRepeat": Config.api + "/rest/file/htmlfileauto2",
      "request.api.checkRepeat2": Config.api + "/rest/file/htmlfileauto3",
      "request.api.checkRepeat3": Config.api + "/rest/file/htmlfileauto4",
      "request.api.addResume.normal": Config.api + "/rest/file/htmlfile",
      //获取重复数据
      "request.api.getRepeatInfo": Config.api + "/rest/candidate/listforcrx",
      "request.api.getRepeatTags": Config.api + "/rest/user/gettaglist",
      "request.api.setRepeatTags": Config.api + "/rest/user/settaglist",
      //新增的基本数据
      "request.api.getAddInfo": Config.api + "/rest/file/temp",
      //打电话
      "request.api.callTel": Config.api + "/rest/data/phoneCall",
      "request.api.addCallTel": Config.api + "/rest/data/phoneCall",
      //存成附件和替换正文
      // 'request.api.saveOrReplace': Config.api + '/rest/file/bind_candidatecrx',
      "request.api.saveOrReplace":
        Config.api + "/rest/file/bind_candidatecrxnew",
      "request.api.addSaveOrReplace":
        Config.api + "/rest/file/bind_candidatecrx",
      //加载项目或客户
      "request.api.loadJobs": Config.api + "/rest/joborder/listbyaddtoproject",
      //收藏夹
      "request.api.loadFavorite": Config.api + "/rest/folder/list",
      //文件夹
      "request.api.loadCustomFolders": Config.api + "/rest/folder/list",
      //行业
      "request.api.loadIndustry": Config.api + "/rest/data/industry",
      //职能
      "request.api.loadFunction": Config.api + "/rest/data/function",
      //状态
      "request.api.loadStatus":
        Config.api + "/rest/data/options?type=candidate_status",
      //标签
      "request.api.loadTags": Config.api + "/rest/data/tags",
      "request.api.searchTags": Config.api + "/rest/data/autocomplete",
      "request.api.submit": Config.api + "/rest/resume/addbyplug",
      //上传
      "request.api.addResume.upload": Config.api + "/rest/file/upload",
      "request.api.editMobile":
        Config.api + "/rest/candidate/modifycandidatephone",
      "request.api.addToJob": Config.api + "/rest/joborder/crxaddtoproject ",
    };

    // 数据服务：可以理解为调用服务器接口
    // 处理通用的请求(由background script发送请求并将数据返回给content script)
    utils.message.register({
      callback: function (msg, sender, sendResponse) {
        // console.log(msg);
        //console.log(sender);
        if (/^request\..*/.test(msg.type)) {
          var url = requests[msg.type];
          if (url) {
            // [TNC][B2 STAGE A] request received for the LinkedIn addResume path.
            if (msg.type === "request.api.addResume.normal") {
              try { if (chrome && chrome.storage && chrome.storage.session) chrome.storage.session.set({ 'tnai-b2-stage': Object.assign(global.__TNAI_B2_STAGE || {}, { request: true }) }); } catch (e) {}
              tnaiB2Stage({ request: true });
            }
            if (
              msg.type == "request.api.addResume.normal" ||
              msg.type == "request.api.addResume.upload"
            ) {
              // [TNC][TEMP DIAGNOSTIC] showing the "wait.." loading indicator
              console.log("[TNC] setting wait badge");
              chrome.action.setBadgeText({ text: "wait.." });
            }
            // console.log(url);
            if (msg.type == "request.api.addResume.upload") {
              // console.log(msg.settings.url2)
              fetch(msg.settings.url2, { xhrFields: { responseType: "blob" } })
                .then((response) => {
                  if (response.ok) {
                    console.log(response);
                    return response.blob();
                  }
                })
                .then((res) => {
                  var file = "";
                  if (msg.settings.url2.indexOf("zhipin") > -1) {
                    var fileName =
                      "【Boss直聘在线附件】简历原件 " +
                      msg.settings.candidate +
                      ".";
                    file = new File(
                      [res],
                      fileName + res.type.slice(res.type.indexOf("/") + 1),
                      {
                        type: res.type,
                      }
                    );
                  } else {
                    file = new File(
                      [res],
                      "【脉脉附件】简历原件." +
                        res.type.slice(res.type.indexOf("/") + 1),
                      {
                        type: res.type,
                      }
                    );
                  }
                  // msg.settings.file = file;
                  // console.log(file);
                  var formData = new FormData();
                  formData.append("data", msg.settings.data);
                  formData.append("file", file);
                  msg.settings.data = formData;
                  msg.settings.contentType = false;
                  msg.settings.processData = false;
                  doSth(url, msg, sender);
                });
            } else {
              doSth(url, msg, sender);
            }
          }
          sendResponse({ data: "success" });
          return true;
        }
      },
    });
    // ---- Talent Nexus AI: addFileName-keyed LinkedIn source cache (PATH B2) ----
  // Non-destructive: copies the captured LinkedIn HTML + source type into
  // chrome.storage.session keyed by the SAME addFileName Golden derives.
  // No change to the request, response, addFileName, or Golden parsing.
  function tnaiB2Stage(obj) {
    // Non-PII WRITE-SIDE diagnostic: persisted to chrome.storage.session
    // (background-owned) so the content script can surface it via the broker
    // without F12. NEVER stores name/email/phone/company/title/HTML.
    // Only booleans / source enum / key length.
    try {
      var d = global.__TNAI_B2_STAGE = global.__TNAI_B2_STAGE || {};
      if (obj) Object.assign(d, obj);
      if (chrome && chrome.storage && chrome.storage.session) {
        chrome.storage.session.set({ 'tnai-b2-stage': d });
      }
    } catch (e) {}
  }
  function tnaiB2Diag(obj) {
    // kept for compatibility; routes into the same write-side stage object.
    tnaiB2Stage(obj);
  }
  function tnaiExtractLinkedInHtml(settingsData) {
    // REAL Golden LinkedIn payload: settings.data = { data: JSON.stringify({html:[...], host, _id}) }.
    // Tolerant of (a) object with .data string, (b) bare JSON string, (c) object with .html[].
    var raw = settingsData;
    if (raw == null) return '';
    if (typeof raw === 'object') {
      if (typeof raw.data === 'string') {
        try { var inner = JSON.parse(raw.data); if (inner && Array.isArray(inner.html) && inner.html.length) return inner.html[0] || ''; } catch (e) {}
      }
      if (Array.isArray(raw.html) && raw.html.length) return raw.html[0] || '';
      return '';
    }
    if (typeof raw === 'string') {
      try {
        var p = JSON.parse(raw);
        if (p && typeof p.data === 'string') {
          try { var inner2 = JSON.parse(p.data); if (inner2 && Array.isArray(inner2.html) && inner2.html.length) return inner2.html[0] || ''; } catch (e2) {}
        }
        if (p && Array.isArray(p.html) && p.html.length) return p.html[0] || '';
      } catch (e) {}
    }
    return '';
  }
  function tnaiCacheLinkedInSource(msg, res, sender) {
    // [TNC][B2 STAGE E] helper entry.
    tnaiB2Stage({ helper: true });
    try {
      if (!msg || msg.type !== "request.api.addResume.normal") { tnaiB2Stage({ received: false }); return; }
      tnaiB2Stage({ received: true });
      if (!res || !res.data) { tnaiB2Stage({ htmlfileOk: false }); return; }
      tnaiB2Stage({ htmlfileOk: true });
      var key = String(res.data).substring(20); // identical to page.js addFileName
      if (!key) { tnaiB2Stage({ keyLen: 0 }); return; }
      // Extract raw HTML from the outgoing payload (REAL shape: settings.data = { data: "<json>" }).
      var html = tnaiExtractLinkedInHtml(msg.settings && msg.settings.data);
      // [TNC][B2 STAGE F] extract result.
      if (!html || typeof html !== "string" || !html.trim()) { tnaiB2Stage({ extract: false, keyLen: key.length }); return; }
      tnaiB2Stage({ extract: true });
      // Source type from the import-time sender tab URL (not inferred later).
      var src = "linkedin-public";
      try {
        var url = (sender && sender.tab && sender.tab.url) || (sender && sender.url) || "";
        if (url.indexOf("/talent/profile/") >= 0) src = "linkedin-recruiter";
      } catch (e) {}
      var entry = { html: html, source: src, createdAt: Date.now() };
      var storeKey = "tnai-linkedin-source:" + key;
      tnaiB2Stage({ helper: true, source: src, keyLen: key.length, store: "pending" });
      chrome.storage.session.set({ [storeKey]: entry }, function () {
        var okStore = !(chrome.runtime && chrome.runtime.lastError);
        // best-effort TTL sweep: drop entries older than 60 min
        try {
          chrome.storage.session.get(null, function (all) {
            if (chrome.runtime.lastError) return;
            var now = Date.now(), removes = [];
            for (var k in all) {
              if (k.indexOf("tnai-linkedin-source:") === 0 && all[k] && all[k].createdAt && (now - all[k].createdAt > 60 * 60 * 1000)) removes.push(k);
            }
            if (removes.length) chrome.storage.session.remove(removes);
          });
        } catch (e) {}
        // verify the key exists immediately after write (non-PII)
        try {
          chrome.storage.session.get(storeKey, function (written) {
            // [TNC][B2 STAGE G] store result.
            tnaiB2Stage({ store: okStore ? "ok" : "fail", keyExists: !!(written && written[storeKey]) });
          });
        } catch (e) { tnaiB2Stage({ store: okStore ? "ok" : "fail" }); }
      });
    } catch (e) {
      tnaiB2Stage({ helperError: String(e && e.message || e) });
    }
  }

  // ---- [TNT] PATH B2: content-script storage broker ----
  // chrome.storage.session is NOT accessible from content scripts (MV3 default).
  // The content script (tnai.js) asks the trusted background to read/delete the
  // exact addFileName-keyed LinkedIn source cache and the non-PII diagnostic.
  function tnaiB2ValidateEntry(entry) {
    if (!entry || typeof entry !== 'object') return null;
    if (!entry.html || typeof entry.html !== 'string' || !entry.html.trim()) return null;
    if (entry.source !== 'linkedin-recruiter' && entry.source !== 'linkedin-public') return null;
    if (!entry.createdAt || (Date.now() - entry.createdAt > 60 * 60 * 1000)) return null;
    return entry;
  }
  function tnaiB2GetSource(addFileName, sendResponse) {
    var key = (addFileName && typeof addFileName === 'string') ? String(addFileName).trim() : '';
    if (!key) { sendResponse({ ok: false, error: 'no-addFileName' }); return; }
    var storeKey = 'tnai-linkedin-source:' + key;
    chrome.storage.session.get(storeKey, function (items) {
      if (chrome.runtime.lastError) { sendResponse({ ok: false, error: 'session-unavailable' }); return; }
      var entry = items && items[storeKey];
      var valid = tnaiB2ValidateEntry(entry);
      if (!valid) { sendResponse({ ok: false, error: 'no-cache' }); return; }
      // Return ONLY the exact matching entry (no fallback, no cross-candidate).
      sendResponse({ ok: true, html: valid.html, source: valid.source });
    });
  }
  function tnaiB2DeleteSource(addFileName, sendResponse) {
    var key = (addFileName && typeof addFileName === 'string') ? String(addFileName).trim() : '';
    if (!key) { sendResponse({ ok: false, error: 'no-addFileName' }); return; }
    var storeKey = 'tnai-linkedin-source:' + key;
    chrome.storage.session.remove(storeKey, function () {
      sendResponse({ ok: true });
    });
  }
  function tnaiB2GetDiag(sendResponse) {
    // Returns write-side stage (A-G) plus read-side status.
    chrome.storage.session.get(['tnai-b2-stage'], function (items) {
      if (chrome.runtime.lastError) { sendResponse({ ok: false }); return; }
      var stage = (items && items['tnai-b2-stage']) || null;
      // read-side: broker reached = true (this handler is answering);
      // keyExists = any cached LinkedIn source currently present.
      var keyExists = false;
      try {
        chrome.storage.session.get(null, function (all) {
          if (!chrome.runtime.lastError && all) {
            for (var k in all) { if (k.indexOf('tnai-linkedin-source:') === 0) { keyExists = true; break; } }
          }
          sendResponse({ ok: true, diag: stage, read: { broker: true, keyExists: keyExists } });
        });
      } catch (e) {
        sendResponse({ ok: true, diag: stage, read: { broker: true, keyExists: false } });
      }
    });
  }

  // Register the broker listener once.
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage && !global.__tnaiB2BrokerReady) {
    global.__tnaiB2BrokerReady = true;
    chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
      if (!msg || !msg.type) return;
      if (msg.type === 'tnai.b2.getSource') { tnaiB2GetSource(msg.addFileName, sendResponse); return true; }
      if (msg.type === 'tnai.b2.deleteSource') { tnaiB2DeleteSource(msg.addFileName, sendResponse); return true; }
      if (msg.type === 'tnai.b2.getDiag') { tnaiB2GetDiag(sendResponse); return true; }
      if (msg.type === 'tnai.b2.identity') {
        // Runtime identity proof: content script asks which background it is talking to.
        try { sendResponse({ ok: true, bgId: String(chrome.runtime.id || ''), bgBuild: TNAI_B2_BG_BUILD }); } catch (e) { sendResponse({ ok: false }); }
        return true;
      }
      return false;
    });
  }


  function doSth(url, msg, sender) {
      // console.log('background: ', '请求' + url);
      // if (msg.type == 'request.api.addResume.normal') {
      //     chrome.action.setBadgeText({text: "wait.."});
      // }
      if (msg && msg.settings) {
        // console.log(msg.settings);
        var data = msg.settings.data;
        // console.log(data);
        if (msg.settings.url2) {
          msg.settings.body = data;
          //fetch需要的参数body
        } else if (msg.settings.type == "post") {
          msg.settings.headers = {
            "Content-Type": "application/json",
          };
          msg.settings.body = JSON.stringify(msg.settings.data);
          if (msg.settings.type2) {
            msg.settings.headers = {
              "Content-Type": "application/x-www-form-urlencoded",
            };
            msg.settings.body = data;
            //fetch需要的参数body
          }
          // console.log(msg.settings);
        } else {
          let temp = [];
          if (data) {
            for (let key in data) {
              temp.push(key + "=" + data[key]);
            }
          }
          url += "?" + temp.join("&");
        }
        //fetch需要的参数method
        msg.settings.method = msg.settings.type;
      }
      // $.ajax(url, msg.settings || {}).then(function (response) {
      // [TNC][B2 STAGE B] htmlfile request is about to be sent (addResume.normal).
      if (msg && msg.type === "request.api.addResume.normal") { tnaiB2Stage({ htmlfileReq: true }); }
      fetch(url, msg.settings || {})
        .then((response) => {
          // console.log(response);
          if (response.ok) {
            return url.indexOf("default/toolbox.html") > -1
              ? response.text()
              : response.json();
          }
        })
        .then((res) => {
          var result = res.data || res.message;
          // console.log(123);
          if (result == "login required") {
            if (url.indexOf("htmlfile") > -1) {
              chrome.cookies.getAll(
                { url: Config.api, name: "loginparam" },
                function (cookies) {
                  // console.log(cookies);
                  var param =
                    cookies.length && cookies[0].value ? cookies[0].value : "";
                  if (param) {
                    fetch(Config.api + "/rest/user/loginsimulation", {
                      method: "post",
                      headers: {
                        "Content-Type":
                          "application/x-www-form-urlencoded; charset=UTF-8",
                      },
                      body: JSON.stringify(param),
                    })
                      .then((resp) => {
                        resp.json();
                      })
                      .then(() => {
                        fetch(url, msg.settings || {})
                          .then((response) => {
                            response.json();
                          })
                          .then((respo) => {
                            var result = respo.data || respo.message;
                            if (result == "login required") {
                              // if (confirm('Request error. Do you need to check the login status？')) {
                              //     chrome.tabs.create({url: Config.api + '/webapp'}, function (tab) {

                              //     });
                              // }
                              utils.message.sendToTab(
                                {
                                  type: "confirm",
                                  response: { url: Config.api + "/webapp" },
                                },
                                sender.tab.id
                              );
                            } else {
                              utils.message.sendToTab(
                                { type: msg.type, response: respo },
                                sender.tab.id
                              );
                            }
                          });
                      });
                  } else {
                    utils.message.sendToTab(
                      {
                        type: "confirm",
                        response: { url: Config.api + "/webapp" },
                      },
                      sender.tab.id
                    );
                    // if (confirm('Request error. Do you need to check the login status？')) {
                    //     chrome.tabs.create({url: Config.api + '/webapp'}, function (tab) {

                    //     });
                    // }
                  }
                }
              );
            }
            // if (confirm('Request error. Do you need to check the login status？')) {
            //     window.open(Config.api + '/webapp');
            // }
          } else {
            // [TNC][B2 STAGE C] htmlfile success path reached (before sendToTab).
            tnaiB2Stage({ htmlfileOK: true });
            utils.message.sendToTab(
              { type: msg.type, response: res },
              sender.tab.id
            );
            // [TNT] PATH B2: copy LinkedIn source into session cache (non-destructive)
            // [TNC][B2 STAGE D] invoking the cache helper.
            tnaiB2Stage({ cacheCall: true });
            tnaiCacheLinkedInSource(msg, res, sender);
          }
          if (
            msg.type == "request.api.getAddInfo" ||
            msg.type == "request.api.addResume.upload"
          ) {
            chrome.action.setBadgeText({ text: "" });
          }
        })
        .catch(function (error) {
          if (error.status === 500) {
            //查重不提示
            //if (confirm('Request error. Do you need to check the login status？')) {
            //    window.open(Config.api + '/webapp');
            //}
          } else {
            console.log("background: ", "请求错误: ", error);
          }
          chrome.action.setBadgeText({ text: "" });
        });
    }
  });

})();
importScripts('./js/release/ppPlugin_background.js');

