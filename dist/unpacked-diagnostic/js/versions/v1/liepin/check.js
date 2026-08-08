var headLP = '';
var linkLP = '';
$('head link').each(function (i, dom) {
    linkLP += dom.outerHTML;
});
var styleLP = '';
$('head style').each(function (i, dom) {
    styleLP += dom.outerHTML;
});
headLP = '<head><meta charset="utf-8"><meta http-equiv="X-UA-Compatible"><meta content="IE=edge,chrome=1">' + linkLP + styleLP + '</head>';
var more = $('.resume-detail-project-info .rd-info-other-link');
// var html2 = document.documentElement.outerHTML;
var html2 = $('#resume-detail-single .c-resume-body').prop('outerHTML');
// checkRepeat('<html>' + headLP + '<body>' + html2 + '</body></html>',type);
//新版猎聘的简历详情中的项目经历，如果是没展开状态，则点击后再抓取
if (more.length && more.text() != '收起') {
    more[0].click();
    setTimeout(function () {
        var html3 = $('#resume-detail-single .c-resume-body').prop('outerHTML');
        checkRepeat('<html>' + headLP + '<body>' + html3 + '</body></html>',type);
        // utils.message.sendMsg({
        //     type: 'request.api.addResume.normal',
        //     settings: {
        //         type: 'post',
        //         data: { data: JSON.stringify({ html: ['<html>' + headLP + '<body>' + html3 + '</body></html>'], host: Config.api, _id: '', email: msg.response }) }
        //     }
        // });
    }, 1500);
} else {
    checkRepeat('<html>' + headLP + '<body>' + html2 + '</body></html>',type);
}