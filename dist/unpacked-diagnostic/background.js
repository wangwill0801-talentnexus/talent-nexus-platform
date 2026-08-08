// const { marsStroke } = require("fontawesome");
// import utils from "./js/core/utils2.js";
importScripts("./js/core/utils.js")
importScripts("./js/versions/v1/sites/tntrace_sw.js")  // TNTRACE diagnostic — remove with the tracer
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

chrome.action.onClicked.addListener(function (tab) {
  // console.log(111);
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
            if (
              msg.type == "request.api.addResume.normal" ||
              msg.type == "request.api.addResume.upload"
            ) {
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
            utils.message.sendToTab(
              { type: msg.type, response: res },
              sender.tab.id
            );
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

