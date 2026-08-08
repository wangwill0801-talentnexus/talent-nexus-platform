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