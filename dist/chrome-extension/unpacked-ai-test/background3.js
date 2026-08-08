import '../js/core/utils'
//调接口
import '../js/versions/v1/background/data'
import '../js/versions/v1/background/index'



// 初始化动态加载服务器上的js
var Config = {};
var Schema = {};

console.log('background: ', '插件后台启动');

chrome.action.onClicked.addListener(function (tab) {
    console.log(111);
    utils.message.sendToTab({type: 'browserAction'}, tab.id);
});

utils.message.register({
    type: 'img.send', callback: function (msg) {
        //console.log(111);
        try {
            chrome.tabs.captureVisibleTab(null, {
                format : "png",
                quality : 100
            }, function(data) {
                //console.log(data);
                utils.message.sendBgMsg({type: 'img.get', response: data});
            });
        } catch (err) {
        }
    }
});
utils.message.register({
    type: 'linkedin.checkRepeat', callback: function () {
        console.log(333);
        setTimeout(() => {
            utils.message.sendBgMsg({type: 'linkedin.checkRepeatReceived'});
        }, 2500);
    }
});

// console.log(this);



//一键发布
var ppPlugin = {};
//发布到网站
ppPlugin.sendToJob = function (data) {
    //console.log(data);
    var API = Config.api;
    var locationUrl = '';
    var sourceUrl = '';
    //51job
    if (data.webType == '51job') {
        locationUrl = 'https://ehire.51job.com/Jobs/JobEdit.aspx?Mark=New';
        //sourceUrl = 'http://127.0.0.1:8080/issue/51job.js';
        sourceUrl = API + '/webapp/issue/51job.js';
    }
    //猎聘
    if (data.webType == 'liepin') {
        locationUrl = 'https://h.liepin.cn/job/showaddpage/';
        //sourceUrl = 'http://127.0.0.1:8080/issue/liepin.js';
        sourceUrl = API +'/webapp/issue/liepin.js';
    }
    //智联招聘
    if (data.webType == 'zhaopin') {
        locationUrl = 'https://rd5.zhaopin.com/job/publish';
        //sourceUrl = 'http://127.0.0.1:8080/issue/zhaopin.js';
        sourceUrl = API +'/webapp/issue/zhaopin.js';
    }
    //58同城
    if (data.webType == '58') {
        locationUrl = 'https://zppost.58.com/zhaopin/1/9224/j5';
        //sourceUrl = 'http://127.0.0.1:8080/issue/58tc.js';
        sourceUrl = API +'/webapp/issue/58tc.js';
    }
    //卓聘
    if (data.webType == 'highpin') {
        locationUrl = 'https://h.highpin.cn/ManageJob/PubNewJob';
        //sourceUrl = 'http://127.0.0.1:8080/issue/highpin.js';
        sourceUrl = API +'/webapp/issue/58tc.js';
    }
    //脉脉
    if (data.webType == 'maimai') {
        locationUrl = 'https://maimai.cn/ent/talents/recruit/positions/add';
        //sourceUrl = 'http://127.0.0.1:8080/issue/maimai.js';
        sourceUrl = API +'/webapp/issue/maimai.js';
    }
    //领英
    if (data.webType == 'linkedin') {
        locationUrl = 'https://www.linkedin.com/start/join?trk=brandpage_baidu_pc-mainlink';
        //sourceUrl = 'http://127.0.0.1:8080/issue/linkedin.js';
        //sourceUrl = API +'/webapp/issue/linkedin.js';
    }
    if (data.webType == 'jobmd') {
        locationUrl = 'https://www.jobmd.cn/pc.htm#/login';
        //sourceUrl = 'http://127.0.0.1:8080/issue/jobmd.js';
        sourceUrl = API +'/webapp/issue/jobmd.js';
    }
    //中华英才
    if (data.webType == 'chinahr') {
        locationUrl = 'https://www.chinahr.com/home/sh/';
        //sourceUrl = 'http://127.0.0.1:8080/issue/chinahr.js';
        sourceUrl = API +'/webapp/issue/chinahr.js';
    }
    if (data.webType == 'linkedin') {
        locationUrl = 'https://www.linkedin.com/login/zh';
        //sourceUrl = 'http://127.0.0.1:8080/issue/linkedin.js';
        sourceUrl = API +'/webapp/issue/linkedin.js';
    }
    if (data.webType == 'lagou') {
        locationUrl = 'https://www.chinahr.com/home/sh/';
        //sourceUrl = 'http://127.0.0.1:8080/issue/lagou.js';
        sourceUrl = API +'/webapp/issue/lagou.js';
    }
    if (data.webType == 'job5156') {
        locationUrl = 'http://zp.job5156.com/login/com/zp';
        //sourceUrl = 'http://127.0.0.1:8080/issue/job5156.js';
        sourceUrl = API +'/webapp/issue/job5156.js';
    }
    chrome.tabs.create({url: locationUrl}, function (tab) {
        chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
            if (info.status === 'complete' && tabId === tab.id) {
                chrome.tabs.onUpdated.removeListener(listener);
                getScriptCode(tab.id,sourceUrl,data);
            }
        });
    });
};
function getScriptCode(tabId,url,data) {
    fetch(url, {
        type: 'get',
        dataType: 'text'
    }).then((response) => { response.text()}).then((resp) => {
        // var jsCode = 'var _info = ' + JSON.stringify(data) + ";\r\n" + resp;
        function jsCode() {
            'var _info = ' + JSON.stringify(data) + ";\r\n" + resp;
        }
        //console.log(jsCode);
        // chrome.scripting.executeScript(tabId, {
        //     code: jsCode
        // },null);
        chrome.scripting.executeScript({
            target: {tabId: tabId},
            func: jsCode
        });
    }).then(() => {
        console.log(arguments);
    });
}

//ppPlugin.sendTo51Job = function (data) {
//    chrome.tabs.create({url: 'https://ehire.51job.com/Jobs/JobEdit.aspx?Mark=New'}, function (tab) {
//        chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
//            if (info.status === 'complete' && tabId === tab.id) {
//                chrome.tabs.onUpdated.removeListener(listener);
//                $.ajax({
//                    type: 'get',
//                    url: 'http://127.0.0.1:8080/51job.js',
//                    dataType: 'text',
//                    success: function (resp) {
//                        chrome.tabs.executeScript(tab.id, {
//                            code: resp
//                        },null);
//                    },
//                    error: function() {
//                        console.log(arguments);
//                    }
//                });
//                //chrome.tabs.sendMessage(tab.id, {type: 'Fill51Job', message: data});
//                //ppPlugin.fillInputElement($('#jobname-input input').get(0), data.jobTitle);
//            }
//        });
//    });
//};
//51job
ppPlugin.searchFrom51Job = function (data) {
    chrome.tabs.query({url: 'https://ehire.51job.com/Candidate/SearchResumeIndexNew.aspx'}, function (tabs) {
        if (tabs.length) {
            chrome.tabs.update(tabs[0].id, {active: true}, function (tab) {
                chrome.tabs.sendMessage(tab.id, {type: 'FillSearch51Job', message: data});
            });
        } else {
            chrome.tabs.create({url: 'https://ehire.51job.com/Candidate/SearchResumeIndexNew.aspx'}, function (tab) {
                chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
                    if (info.status === 'complete' && tabId === tab.id) {
                        chrome.tabs.onUpdated.removeListener(listener);
                        chrome.tabs.sendMessage(tab.id, {type: 'FillSearch51Job', message: data});
                    }
                });
            });
        }
    });
    //chrome.tabs.create({ url: 'https://ehire.51job.com/Candidate/SearchResumeNew.aspx' }, function(tab) {
    //    chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
    //        if (info.status === 'complete' && tabId === tab.id) {
    //            chrome.tabs.onUpdated.removeListener(listener);
    //            chrome.tabs.sendMessage(tab.id, {type: 'FillSearch51Job', message: data});
    //        }
    //    });
    //});
};
//猎聘
ppPlugin.searchFromLiepin = function (data) {
    chrome.tabs.query({url: 'https://h.liepin.cn/search/soResume/'}, function (tabs) {
        if (tabs.length) {
            chrome.tabs.update(tabs[0].id, {active: true}, function (tab) {
                chrome.tabs.sendMessage(tab.id, {type: 'FillSearchLiepin', message: data});
            });
        } else {
            chrome.tabs.create({url: 'https://h.liepin.cn/search/soResume/'}, function (tab) {
                chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
                    if (info.status === 'complete' && tabId === tab.id) {
                        chrome.tabs.onUpdated.removeListener(listener);
                        chrome.tabs.sendMessage(tab.id, {type: 'FillSearchLiepin', message: data});
                    }
                });
            });
        }
    });
    //chrome.tabs.create({ url: 'https://h.liepin.com/search/soResume/' }, function(tab) {
    //    chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
    //        if (info.status === 'complete' && tabId === tab.id) {
    //            chrome.tabs.onUpdated.removeListener(listener);
    //            chrome.tabs.sendMessage(tab.id, {type: 'FillSearchLiepin', message: data});
    //        }
    //    });
    //});
};

//卓聘
ppPlugin.searchFromHighpin = function (data) {
    //chrome.tabs.query({url: 'https://h.highpin.cn/SearchResume/SearchResumeList'}, function (tabs) {
    chrome.tabs.query({status: 'complete'}, function (tabs) {
        var create = true;
        if (tabs.length) {
            $.each(tabs,function (i,obj) {
                //如果存在搜索后的页面则create为false
                if (obj.url.indexOf('https://h.highpin.cn/SearchResume/SearchResumeList') > -1) {
                    create = false;
                }
            });
            //如果存在搜索后的页面则在此页面打开搜索页
            if (!create) {
                $.each(tabs,function (i,obj) {
                    if (obj.url.indexOf('https://h.highpin.cn/SearchResume/SearchResumeList') > -1) {
                        chrome.tabs.update(obj.id,{url: 'https://h.highpin.cn/SearchResume/SearchResumeConditions',active: true}, function (tab) {
                            chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
                                if (info.status === 'complete' && tabId === tab.id) {
                                    chrome.tabs.onUpdated.removeListener(listener);
                                    chrome.tabs.sendMessage(tab.id, {type: 'FillSearchHighpin', message: data});
                                }
                            });
                        });
                        return false;
                    }
                });
            } else {//否则直接在新窗口打开搜索页
                chrome.tabs.create({ url: 'https://h.highpin.cn/SearchResume/SearchResumeConditions' }, function(tab) {
                    chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
                        //等待页面加载完成再发送消息
                        if (info.status === 'complete' && tabId === tab.id) {
                            chrome.tabs.onUpdated.removeListener(listener);
                            chrome.tabs.sendMessage(tab.id, {type: 'FillSearchHighpin', message: data});
                        }
                    });
                });
            }
        }
    });
    //chrome.tabs.create({url: 'https://h.highpin.cn/SearchResume/SearchResumeConditions'}, function (tab) {
    //    chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
    //        if (info.status === 'complete' && tabId === tab.id) {
    //            chrome.tabs.onUpdated.removeListener(listener);
    //            chrome.tabs.sendMessage(tab.id, {type: 'FillSearchHighpin', message: data});
    //        }
    //    });
    //});
};
//boss直聘
//猎聘
ppPlugin.searchFromZhipin = function (data) {
    chrome.tabs.query({url: 'https://www.zhipin.com/chat/im?mu=search'}, function (tabs) {
        if (tabs.length) {
            chrome.tabs.update(tabs[0].id, {active: true}, function (tab) {
                chrome.tabs.sendMessage(tab.id, {type: 'FillSearchZhipin', message: data});
            });
        } else {
            chrome.tabs.create({url: 'https://www.zhipin.com/chat/im?mu=search'}, function (tab) {
                chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
                    if (info.status === 'complete' && tabId === tab.id) {
                        chrome.tabs.onUpdated.removeListener(listener);
                        chrome.tabs.sendMessage(tab.id, {type: 'FillSearchZhipin', message: data});
                    }
                });
            });
        }
    });
};
chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    if (request.type == 'SendToWebsite') {
        ppPlugin.sendToJob(request.message);
        sendResponse({code: 0});
    }

    if (request.type.indexOf('SearchFrom51Job') > -1) {
        ppPlugin.searchFrom51Job(request.message);
        sendResponse({code: 0});
    }
    if (request.type.indexOf('SearchFromLiepin') > -1) {
        ppPlugin.searchFromLiepin(request.message);
        sendResponse({code: 0});
    }
    if (request.type.indexOf('SearchFromHighpin') > -1) {
        ppPlugin.searchFromHighpin(request.message);
        sendResponse({code: 0});
    }
    if (request.type.indexOf('SearchFromZhipin') > -1) {
        ppPlugin.searchFromZhipin(request.message);
        sendResponse({code: 0});
    }
});

