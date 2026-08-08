 alert(1);
 // 通过inject方式将XHR拦截代码注入到页面上下文
 function injectXHRInterceptor() {
    const script = document.createElement('script');
    script.textContent = `
(function() {
const origOpen = window.XMLHttpRequest.prototype.open;
window.XMLHttpRequest.prototype.open = function(method, url) {
    this._isTarget = url && url.startsWith('/wapi/zpjob/view/geek/info/v2');
    console.log('[plugin.js] XHR拦截', this._isTarget, url);
    return origOpen.apply(this, arguments);
};
const origSend = window.XMLHttpRequest.prototype.send;
window.XMLHttpRequest.prototype.send = function() {
    if (this._isTarget) {
        this.addEventListener('load', function() {
            try {
                const contentType = this.getResponseHeader('content-type') || '';
                if (this.response && contentType.includes('application/json')) {
                    let data = this.responseType === 'json' ? this.response : JSON.parse(this.responseText);
                    if (data && data.zpData && data.zpData.encryptGeekDetailInfo) {
                        window.top.postMessage({__zhipin_decrypt: data.zpData.encryptGeekDetailInfo}, '*');
                    }
                }
            } catch (e) {
                console.warn('[plugin.js] XHR拦截解密失败', e);
            }
        });
    }
    return origSend.apply(this, arguments);
};
})();
`;
    document.head.appendChild(script);
}
injectXHRInterceptor();