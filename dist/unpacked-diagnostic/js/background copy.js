// 初始化动态加载服务器上的js
var Config = {};
var Schema = {};

console.log('background: ', '插件后台启动');
(function () {
    var loadDynamicBackgrounds = function (scripts) {
        console.log('background: ', '开始加载动态脚本: ', scripts);
        if (_.isArray(scripts) && scripts.length) {
            async.retry(3, function (callback) {
                var scriptsLoader = [];
                scripts.forEach(function (script) {
                    var url = Config.server + script;
                    console.log('background: ', '加载脚本: ', url);
                    scriptsLoader.push($.getScript(url));
                });
                $.when.apply($, scriptsLoader).then(function () {
                    console.log('background: ', '动态脚本全部加载完成');
                    callback();
                }, function (error) {
                    console.log('background: ', '动态脚本全部异常，插件将不能正常工作');
                    callback(error);
                });
            }).then(function () {
            });
        }
    };

    utils.storeAsync.get('config').then(function (config) {
        console.log('background: ', '插件配置信息: ', config);
        config = config || {server: ''};
        Config = config;
        if (!config.server || !config.api) {
            console.log('background: ', '插件还未配置，自动打开配置页面');
            chrome.runtime.openOptionsPage();
            return;
        }

        var schemaUrl = chrome.extension.getURL("./data/schema.json");
        $.ajax({
            type: 'get',
            url: schemaUrl,
            success: function (schema) {
                // console.log(resp);
                var defaultSchema = {version: 0};
                schema = schema || defaultSchema;
                Schema = schema;
                utils.store.set('schema', schema, {
                    callback: function () {
                        console.log('background: ', 'schema已更新');
                        // loadDynamicBackgrounds(schema.backgrounds);
                    }
                });
            }
        });

        // utils.storeAsync.get('schema').then(function (schema) {
        //     console.log('background: ', '插件schema: ', schema);
        //     var defaultSchema = {version: 0};
        //     schema = schema || defaultSchema;
        //     Schema = schema;
        //     utils.store.set('schema', schema, {
        //         callback: function () {
        //             console.log('background: ', 'schema已更新');
        //             // loadDynamicBackgrounds(schema.backgrounds);
        //         }
        //     });
        //     // if (config.autoCheckUpdate || (config.dynamicUpdate || !schema.version)) {
        //     //     console.log('background: ', '检查服务器schema');
        //     //     $.get(config.server + '/plugin/data/schema.json', function (_schema) {
        //     //         console.log('background: ', '服务器schema: ', _schema);
        //     //         _schema = _schema || defaultSchema;

        //     //         // 动态更新
        //     //         console.log('background: ', '插件开启动态更新: ', config.dynamicUpdate);
        //     //         console.log('background: ', '插件schema版本: ', schema.version);
        //     //         if (config.dynamicUpdate || !schema.version) {
        //     //             if (_schema.version > schema.version) {
        //     //                 console.log('background: ', 'schema将从' + schema.version + '更新到' + _schema.version);
        //     //                 Schema = schema = _schema;
        //     //                 utils.store.set('schema', _schema, {
        //     //                     callback: function () {
        //     //                         console.log('background: ', 'schema已更新');
        //     //                         // loadDynamicBackgrounds(schema.backgrounds);
        //     //                     }
        //     //                 });
        //     //             } else {
        //     //                 console.log('background: ', 'schema无更新');
        //     //                 // loadDynamicBackgrounds(schema.backgrounds);
        //     //             }
        //     //         }

        //     //         // 检查更新
        //     //         console.log('background: ', '自动检查更新: ', config.autoCheckUpdate);
        //     //         if (config.autoCheckUpdate) {
        //     //             console.log('background: ', '开始检查更新');
        //     //             $.get('manifest.json', function (manifest) {
        //     //                 if (_schema.pluginVersion === (manifest || {}).version) {
        //     //                     console.log('background: ', '插件已是最新版本，无需更新');
        //     //                 } else {
        //     //                     console.log('background: ', '插件有最新版本，将打开更新页面');
        //     //                     window.open(config.server + '/plugin/update.html?version=' + (manifest || {}).version);
        //     //                 }
        //     //             }, 'json');
        //     //         }

        //     //     }, 'json').fail(function () {
        //     //         console.log('background: ', '检查schema更新失败');
        //     //         // loadDynamicBackgrounds(schema.backgrounds);
        //     //     });
        //     // } else {
        //     //     // loadDynamicBackgrounds(schema.backgrounds);
        //     // }
        // });
    });

    // 插件更新
    utils.message.register({
        // 更新
        type: '_update_', callback: function () {
            console.log('background: ', '收到更新请求，重新加载插件');
            localStorage.clear();
            chrome.runtime.reload();
        }
    });

    var load = function (url, type, tab) {
        var cache = localStorage.getItem(url);
        if (cache && !Config.dynamicUpdate) {
            console.log('background: ', '从缓存加载: ' + url);
            //console.log(tab.id,url);
            chrome.tabs[type](tab.id, {code: cache});
        } else {
            console.log('background: ', '从服务器加载: ' + url);
            $.get(url).then(function (code) {
                //console.log(tab.id,url);
                chrome.tabs[type](tab.id,{code: code});
                localStorage.setItem(url, code);
            });
        }
    };

    // // 加载 content_scripts
    utils.message.register({
        type: '_contentScripts_', callback: function (msg, sender) {
            console.log('background: ', '开始加载 content scripts');
            // 加载js
            (msg.js || []).forEach(function (script) {
                // var url = Config.server + script;
                var url = '' + script;
                // console.log('background: ', '加载 content js:' + url);
                load(url, 'executeScript', sender.tab);
            });

            // 加载css
            (msg.css || []).forEach(function (css) {
                var url = '' + css;
                // console.log('background: ', '加载 content css:' + url);
                load(url, 'insertCSS', sender.tab);
            });
        }
    });

})();

