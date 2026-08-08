// const { marsStroke } = require("fontawesome");

var utils = {};

// object-assign.js
utils.objectAssign = (function () {
    var getOwnPropertySymbols = Object.getOwnPropertySymbols;
    var propIsEnumerable = Object.prototype.propertyIsEnumerable;

    var toObject = (val) => {
        if (val === null || val === undefined) {
            throw new TypeError('Object.assign cannot be called with null or undefined');
        }
        return Object(val);
    };

    var objectAssign = (...args) => {
        var to = toObject(args[0]);

        args.slice(1).forEach((arg) => {
            var from = Object(arg);

            Object.keys(from).forEach((key) => {
                to[key] = from[key];
            });

            if (getOwnPropertySymbols) {
                var symbols = getOwnPropertySymbols(from);
                symbols.forEach((symbol) => {
                    if (propIsEnumerable.call(from, symbol)) {
                        to[symbol] = from[symbol];
                    }
                });
            }
        });

        return to;
    };

    return objectAssign;
})();

// helper.js
(function () {
    utils.timestamp = () => Math.floor(Date.now() / 1000);

    var isWhat = (target, targetType) => Object.prototype.toString.call(target) === targetType;

    utils.checkType = {
        isFunc: (func) => isWhat(func, '[object Function]'),
        isString: (string) => isWhat(string, '[object String]'),
        isObj: (obj) => isWhat(obj, '[object Object]'),
        isNumber: (obj) => isWhat(obj, '[object Number]'),
        isArray: (obj) => isWhat(obj, '[object Array]')
    };

    /*
     * get value by key from a object
     *
     * e.g.
     * object = {
     *   a: {
     *     b: 1
     *   }
     * };
     * key = 'a.b'
     *
     * ===> result = 1
     */
    utils.getStoreValue = (object, key) => {
        if (!utils.checkType.isObj(object)) return null;
        var sections = key.split('.');
        let result = object;
        for (let i = 0; i < sections.length; i++) {
            var section = sections[i];
            if (result && utils.checkType.isObj(result)) {
                var {_value} = result;
                if (!_value) {
                    var sectionObj = result[section];
                    result = sectionObj && sectionObj['_value']
                        ? sectionObj['_value']
                        : sectionObj;
                    continue;
                }
                if (utils.checkType.isObj(_value)) {
                    result = _value[section];
                } else {
                    result = _value;
                }
            } else if (i === sections.length - 1) {
                result = undefined;
                break;
            }
        }
        return result;
    };

    utils.getValue = (object, key) => {
        if (!utils.checkType.isObj(object)) return null;
        var sections = key.split('.');

        let result = object;
        for (let i = 0; i < sections.length; i++) {
            var section = sections[i];
            result = utils.checkType.isObj(result) ? result[section] : null;
        }

        return typeof result === 'undefined' ? null : result;
    };

    utils.setValue = (object, key, value) => {
        if (!utils.checkType.isObj(object)) return utils.createObj(key, value);
        var sections = key.split('.');
        let newObj = value;

        for (let i = sections.length - 1; i >= 0; i--) {
            var section = sections[i];
            var currentKey = sections.slice(0, i + 1).join('.');
            var currentValue = utils.getValue(object, currentKey);

            var newValue = utils.checkType.isObj(newObj)
                ? utils.objectAssign({}, currentValue, newObj)
                : newObj;
            newObj = {[section]: newValue};
        }

        return utils.objectAssign(object, newObj);
    };

    utils.getStoreExpire = (object, key) => {
        if (!utils.checkType.isObj(object)) return null;
        var sections = key.split('.');
        let expire = null;
        let current = object;
        sections.forEach((section) => {
            current = current[section]
                ? current[section]
                : current;

            if (utils.checkType.isObj(current) && current['_expire']) {
                expire = current['_expire'];
            }
        });
        return expire;
    };

    /*
     * create a object
     *
     * e.g.
     * key = 'a.b.c';
     * value = 1;
     * ===> result = {a: {b: {c: 1}}}
     *
     * key = 'a';
     * value = 1;
     * ===> result = { a: 1 }
     */
    utils.createObj = (key, value) => {
        var sections = key.split('.');
        var baseObj = Object.apply(null);
        let next = baseObj;
        sections.forEach((section, index) => {
            var result = index === sections.length - 1 ? value : Object.apply(null);
            next[section] = result;
            next = result;
        });
        return baseObj;
    };

    utils.uuid = () => {
        var s4 = () => {
            return Math.floor((1 + Math.random()) * 0x10000)
                .toString(16)
                .substring(1);
        };
        return s4() + s4() + '-' + s4() + '-' + s4() + '-' +
            s4() + '-' + s4() + s4() + s4();
    };
})();

// message.js
utils.message = (function () {
    var _sendCallback = (msg, sender, listener) => {
        var checked = !listener.type || listener.type === msg.type;
        if (checked && utils.checkType.isFunc(listener.callback)) {
            listener.callback(msg, sender);
        }
    };

    var _checkListener = (listeners) => {
        listeners.forEach((listener) => {
            if (!listener.callback) {
                throw new Error('Listener should have a callback!');
            }
        });
    };

    var _checkMsg = (msg) => {
        if (!Object.keys(msg).indexOf('type') === -1) {
            throw new Error('Missing "type" key!');
        }
    };

    var register = (...args) => {
        _checkListener(args);
        chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
            for (let i = 0; i < args.length; i++) {
                var listener = args[i];
                _sendCallback(msg, sender, listener);
            }
        });
    };

    var sendMsg = (msg, callback) => {
        _checkMsg(msg);
        chrome.runtime.sendMessage(msg, (response) => {
            utils.checkType.isFunc(callback) && callback(response);
        });
    };

    var sendToTab = (msg, tabId) => {
        chrome.tabs.sendMessage(tabId, msg);
    };

    var sendToTabs = (msg = {}, query = {}, filterTabs = null) => {
        _checkMsg(msg);
        chrome.tabs.query(query, (tabs) => {
            let targetTabs = tabs;
            if (utils.checkType.isFunc(filterTabs)) {
                targetTabs = filterTabs(tabs);
            }
            targetTabs.forEach(tab => sendToTab(msg, tab.id));
        });
    };

    var sendBgMsg = (msg) => {
        sendToTabs(msg, {active: true, currentWindow: true});
    };

    return {
        register,
        sendMsg,
        sendToTab,
        sendToTabs,
        sendBgMsg
    };
})();

// store.js
utils.store = {};
(function () {
    /* ========================= raw api of chrome.storage.sync ========================= */

    var _rawSet = (obj, resolve) => {
        chrome.storage.sync.set(obj, () => {
            resolve && resolve();
        });
    };

    var _rawGet = (key, resolve) => {
        chrome.storage.sync.get(key, (result) => {
            resolve && resolve(result);
        });
    };

    var _rawRemove = (key, callback) => {
        chrome.storage.sync.remove(key, () => {
            callback && callback(null);
        });
    };

    var _rawClear = (callback) => {
        chrome.storage.sync.clear(() => {
            callback && callback();
        });
    };

    /* ========================= better api ========================= */
    var combineObj = (key, value, expire = null) => {
        return key ? utils.createObj(key, value) : value;
    };

    var getStorage = (key, resolve, reject = null) => {
        var mainKey = key.split('.')[0];

        var callback = (result) => {
            var value = utils.getValue(result, key);

            (value !== null && typeof value !== 'undefined')
                ? resolve && resolve(value)
                : (reject
                    ? reject && reject()
                    : resolve && resolve(null)
                );
        };
        _rawGet(mainKey, callback);
    };

    var setStorage = (key, value, options = {}) => {
        var resolve = utils.checkType.isFunc(options.callback) ? options.callback : null;
        var keys = key.split('.');
        var mainKey = keys[0];

        getStorage(mainKey, (result) => {
            var obj = combineObj(null, value);
            var rawObj = {[mainKey]: result};
            var newObj = utils.setValue(rawObj, key, obj);

            _rawSet(newObj, resolve);
        });
    };

    var listenChange = (...args) => {
        chrome.storage.onChanged.addListener((changes, namespace) => {
            Object.keys(changes).forEach((key) => {
                var listener = args.filter(arg => arg.key.split('.')[0] === key)[0];
                if (listener) {
                    var storageChange = changes[key];
                    if (storageChange) {
                        var newValue = utils.getValue({[key]: storageChange.newValue}, listener.key);
                        var oldValue = utils.getValue({[key]: storageChange.oldValue}, listener.key);
                        var changed = newValue !== oldValue;
                        changed && listener.callback && listener.callback(newValue);
                    }
                }
            });
        });
    };

    var clearStorage = (callback) => {
        _rawClear(callback);
    };

    var removeStorage = (key, callback) => {
        var keys = key.split('.');
        if (keys.length === 1) {
            _rawRemove(key, callback);
        } else {
            setStorage(key, null, {callback});
        }
    };

    utils.store.combineObj = combineObj;
    utils.store.get = getStorage;
    utils.store.set = setStorage;
    utils.store.listen = listenChange;
    utils.store.clear = clearStorage;
    utils.store.remove = removeStorage;
})();

// storeAsync.js
utils.storeAsync = {
    get: function (key) {
        return new Promise(resolve => {
            utils.store.get(key, resolve);
        });
    },
    set: function (key, value, options = {}) {
        return new Promise(resolve => {
            utils.store.set(key, value, {callback: e => resolve(e)});
        });
    },
    clear: function () {
        return new Promise(resolve => {
            utils.store.clear(e => resolve(e));
        });
    },
    remove: function (key) {
        return new Promise(resolve => {
            utils.store.remove(key, e => resolve(e));
        });
    },
};

// i18n.js
utils.i18n = (function () {
    var getAcceptLanguages = (callback) => {
        chrome.i18n.getAcceptLanguages((languageList) => {
            callback && callback(languageList);
        });
    };

    var getMessage = (...args) => {
        var result = chrome.i18n.getMessage(...args);
        if (!result || !result.length) return null;
        return result;
    };

    return {
        acceptLanguages: getAcceptLanguages,
        get: getMessage
    };
})();


// info.js
utils.info = (function () {
    var getPlatform = (callback) => {
        chrome.runtime.getPlatformInfo((info) => {
            var platform = `${info.os}-${info.arch}`;
            callback && callback(platform);
        });
    };

    var getIdentifyId = (callback) => {
        utils.store.get('identifyId', (result) => {
            if (!result) {
                result = uuid();
                utils.store.set('identifyId', result);
            }
            callback(result);
        });
    };

    return {
        getUniqueId: () => chrome.runtime.id,
        getIdentifyId,
        getPlatform
    };
})();



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

//接口调用
(function () {
    var Config = {};
    utils.storeAsync.get('config').then(function (config) {
        // console.log('background: ', '插件配置信息: ', config);
        config = config || {server: ''};
        Config = config;
        var requests = {
            'request.api.UserContext': Config.api + '/rest/user/context',
            'request.plugin.toolbox': './versions/v1/default/toolbox.html',
            'request.api.checkRepeat': Config.api + '/rest/file/htmlfileauto2',
            'request.api.checkRepeat2': Config.api + '/rest/file/htmlfileauto3',
            'request.api.addResume.normal': Config.api + '/rest/file/htmlfile',
            //获取重复数据
            'request.api.getRepeatInfo': Config.api + '/rest/candidate/listforcrx',
            'request.api.getRepeatTags': Config.api + '/rest/user/gettaglist',
            'request.api.setRepeatTags': Config.api + '/rest/user/settaglist',
            //新增的基本数据
            'request.api.getAddInfo': Config.api + '/rest/file/temp',
            //打电话
            'request.api.callTel': Config.api + '/rest/data/phoneCall',
            'request.api.addCallTel': Config.api + '/rest/data/phoneCall',
            //存成附件和替换正文
            'request.api.saveOrReplace': Config.api + '/rest/file/bind_candidatecrx',
            'request.api.addSaveOrReplace': Config.api + '/rest/file/bind_candidatecrx',
            //加载项目或客户
            'request.api.loadJobs': Config.api + '/rest/joborder/listbyaddtoproject',
            //收藏夹
            'request.api.loadFavorite': Config.api + '/rest/folder/list',
            //文件夹
            'request.api.loadCustomFolders': Config.api + '/rest/folder/list',
            //行业
            'request.api.loadIndustry': Config.api + '/rest/data/industry',
            //职能
            'request.api.loadFunction': Config.api + '/rest/data/function',
            //状态
            'request.api.loadStatus': Config.api + '/rest/data/options?type=candidate_status',
            //标签
            'request.api.loadTags': Config.api + '/rest/data/tags',
            'request.api.searchTags': Config.api + '/rest/data/autocomplete',
            'request.api.submit': Config.api + '/rest/resume/addbyplug'
        };

        // 数据服务：可以理解为调用服务器接口
        // 处理通用的请求(由background script发送请求并将数据返回给content script)
        utils.message.register({
            callback: function (msg, sender) {
                // console.log(msg);
                //console.log(sender);
                if (/^request\..*/.test(msg.type)) {
                    var url = requests[msg.type];
                    if (url) {
                        console.log('background: ', '请求' + url);
                        if (msg.type == 'request.api.addResume.normal') {
                            chrome.action.setBadgeText({text: "wait.."});
                        }
                        if (msg && msg.settings) {
                            // console.log(msg.settings);
                            var data = msg.settings.data
                            console.log(data);
                            if (msg.settings.type == 'post') {
                                msg.settings.headers = {
                                    'Content-Type': 'application/json'
                                };
                                //fetch需要的参数body
                                msg.settings.body = JSON.stringify(msg.settings.data);
                                // console.log(msg.settings);
                            } else {
                                let temp = [];
                                if (data) {
                                    for (let key in data) {
                                        temp.push(key + '=' + data[key]);
                                    } 
                                }
                                url += '?' + temp.join('&');
                            }
                            //fetch需要的参数method
                            msg.settings.method = msg.settings.type;
                        }
                        // $.ajax(url, msg.settings || {}).then(function (response) {
                        fetch(url, msg.settings || {}).then((response) => {
                            if(response.ok) {
                                return url.indexOf('default/toolbox.html') > -1 ? response.text() : response.json();
                            }
                        
                        }).then(res => {
                            var result = res.data || res.message;
                            if (result == 'login required') {
                                if (url.indexOf('htmlfile') > -1) {
                                    chrome.cookies.getAll({"url": Config.api, "name": "loginparam"}, function(cookies) {
                                        // console.log(cookies);
                                        var param = cookies.length && cookies[0].value ? cookies[0].value : '';
                                        if (param) {
                                            fetch(Config.api + '/rest/user/loginsimulation',{
                                                method: 'post',
                                                headers: {'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'},
                                                body: JSON.stringify(param)
                                            }).then((resp) => {resp.json()}).then(() => {
                                                    fetch(url, msg.settings || {}).then((response) => { response.json()}).then(respo => {
                                                        var result = respo.data || respo.message;
                                                        if (result == 'login required') {
                                                            // if (confirm('请求错误，您需要检查登陆状态吗？')) {
                                                            //     chrome.tabs.create({url: Config.api + '/webapp'}, function (tab) {
                                                                    
                                                            //     });
                                                            // }
                                                            utils.message.sendToTab({type: 'confirm'}, sender.tab.id);
                                                        } else {
                                                            utils.message.sendToTab({type: msg.type, response: respo}, sender.tab.id);
                                                        }
                                                    });                                                                
                                                });     
                                        } else {
                                            utils.message.sendToTab({type: 'confirm'}, sender.tab.id);
                                            // if (confirm('请求错误，您需要检查登陆状态吗？')) {
                                            //     chrome.tabs.create({url: Config.api + '/webapp'}, function (tab) {
                                                                    
                                            //     });
                                            // }
                                        }
                                    });
                                }
                                // if (confirm('请求错误，您需要检查登陆状态吗？')) {
                                //     window.open(Config.api + '/webapp');
                                // }    
                            } else {
                                utils.message.sendToTab({type: msg.type, response: res}, sender.tab.id);
                            }
                            chrome.action.setBadgeText({text: ""});
                        }).catch(function (error) {
                            if (error.status === 500) {
                                //查重不提示
                                //if (confirm('请求错误，您需要检查登陆状态吗？')) {
                                //    window.open(Config.api + '/webapp');
                                //}
                            } else {
                                console.log('background: ', '请求错误: ', error);
                            }
                            chrome.action.setBadgeText({text: ""});
                        });
                    }
                }
            }
        });
    });
    
})();

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

