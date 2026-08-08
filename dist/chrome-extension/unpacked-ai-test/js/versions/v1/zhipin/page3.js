
if (window == window.top) {
    Object.defineProperty(HTMLCanvasElement.prototype, 'height', {
        set: function (val) {
            if (this.id == 'resume') {
                // console.log(`[canvas拦截] 设置height: ${val}`);
                window.__pluginResumeResult = [];
                this.setAttribute('height', 10000);
            } else {
                this.setAttribute('height', val);
            }
        },
        get: function () {
            return this.getAttribute('height') || this.height;
        },
        configurable: true
    });
}

// 注入解密函数到页面
wasmMod = null;
window.zhipinWasmDecrypt = async function (encryptString) {
    // 直接注入CSS代码到页面
    if (!document.getElementById('wasm-content-unset-style')) {
        const style = document.createElement('style');
        style.id = 'wasm-content-unset-style';
        style.textContent = '#wasm-content { height: 10000 !important; }';
        document.head.appendChild(style);
    }
    // 创建隐藏的div用于保存最终字符串
    let resultDiv = document.getElementById('zhipin-wasm-result');
    if (!resultDiv) {
        resultDiv = document.createElement('div');
        resultDiv.id = 'zhipin-wasm-result';
        resultDiv.style.display = 'none';
        document.body.appendChild(resultDiv);
    }
    
    try {
        //wasmMod = await import('https://static.zhipin.com/assets/zhipin/wasm/resume/wasm_canvas-1.0.2-5018.js');
        wasmMod = await import(chrome.runtime.getURL('js/versions/v1/zhipin/wasm_canvas-1.0.2-5018.js'));
    } catch (e) {
        alert('WASM模块加载失败: ' + e.message);
        return;
    }
    // 创建div容器
    const container = document.createElement('div');
    container.style.cssText = 'position:fixed;z-index:-9999;top:0;left:0;width:100vw;background:rgba(255,255,255,0.95);';
    container.id = 'zhipin-wasm-container';
    document.body.appendChild(container);
    const content = document.createElement('div');
    content.id = 'wasm-content';
    container.appendChild(content);
    let wasmMod;
    // 通过import动态加载远程wasm_canvas-1.0.2-5018.js
    // try {
    //     await wasmMod.default('https://static.zhipin.com/assets/zhipin/wasm/resume/wasm_canvas_bg-1.0.2-5018.wasm');

    //     const origFillText = window.CanvasRenderingContext2D.prototype.fillText;
    //     let fillTextEndChecker = null;
    //     window.CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
    //         clearTimeout(fillTextEndChecker);
    //         window.__pluginResumeResult.push(text);
    //         fillTextEndChecker = setTimeout(function () {
    //             const finalStr = window.__pluginResumeResult.join('');
    //             // resultDiv.textContent = finalStr;
    //             document.getElementById('zhipin-wasm-result').textContent = finalStr;
    //             console.log(finalStr);
    //             // window.CanvasRenderingContext2D.prototype.fillText = origFillText; // 恢复原始方法
    //             wasmMod.destroy();
    //             document.getElementById('zhipin-wasm-container').remove();
    //         }, 1000);
    //         return origFillText.call(this, text, ...args);
    //     };

    //     wasmMod.start(
    //         container,
    //         content,
    //         encryptString,
    //         null,
    //         window,
    //         null,
    //         null
    //     );
    // } catch (e) {
    //     // alert('WASM解密失败: ' + e.message);
    //     container.remove();
    // }
    if (!wasmMod) {
        try {
            //wasmMod = await import('https://static.zhipin.com/assets/zhipin/wasm/resume/wasm_canvas-1.0.2-5018.js');
            wasmMod = await import(chrome.runtime.getURL('js/versions/v1/zhipin/wasm_canvas-1.0.2-5018.js'));
        } catch (e) {
            alert('WASM模块加载失败: ' + e.message);
            return;
        }
        
        // 初始化并调用start
        try {
            await wasmMod.default('https://static.zhipin.com/assets/zhipin/wasm/resume/wasm_canvas_bg-1.0.2-5018.wasm');
            const origFillText = window.CanvasRenderingContext2D.prototype.fillText;
            let fillTextEndChecker = null;
            window.CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
                clearTimeout(fillTextEndChecker);
                window.__pluginResumeResult.push(text);
                fillTextEndChecker = setTimeout(function () {
                    const finalStr = window.__pluginResumeResult.join('');
                    // resultDiv.textContent = finalStr;
                    document.getElementById('zhipin-wasm-result').textContent = finalStr;
                    console.log(finalStr);
                    // window.CanvasRenderingContext2D.prototype.fillText = origFillText; // 恢复原始方法
                    wasmMod.destroy();
                    document.getElementById('zhipin-wasm-container').remove();
                }, 1000);
                return origFillText.call(this, text, ...args);
            };
        } catch (e) {
            // alert('WASM解密失败: ' + e.message);
            container.remove();
        }
    }

    wasmMod.start(
        container,
        content,
        encryptString,
        null,
        window,
        null,
        null
    );
};



// 监听页面消息，调用解密
// console.log(1111);
window.addEventListener('message', function(e) {
    // console.log(333, e);

    if (e.data && e.data.__zhipin_decrypt) {
        if (e.data.__zhipin_decrypt) {
            window.zhipinWasmDecrypt(e.data.__zhipin_decrypt);
        }
    }
});
// console.log(222);
