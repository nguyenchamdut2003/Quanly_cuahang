var { Counter, KhachHang, DiaChiKhachHang } = require('../../../models/kiot.model');

async function makeCustomerCode() {
    for (var i = 0; i < 20; i += 1) {
        var counter = await Counter.findOneAndUpdate(
            { _id: 'khach_hang' },
            { $inc: { seq: 1 } },
            { upsert: true, returnDocument: 'after' }
        ).lean();
        var code = 'KH' + String(counter.seq || 1).padStart(4, '0');
        var existed = await KhachHang.exists({ ma_khach_hang: code });
        if (!existed) return code;
    }

    return 'KH' + String(Date.now()).slice(-10);
}

function parseSequentialCode(value, prefix) {
    var match = String(value || '').trim().match(new RegExp('^' + prefix + '(\\d+)$'));
    return match ? Number(match[1]) : 0;
}

function formatSequentialCode(prefix, number) {
    return prefix + String(number).padStart(4, '0');
}

async function getNextCustomerCodeSuggestion() {
    var rows = await KhachHang.find({ ma_khach_hang: /^KH\d+$/ }).select('ma_khach_hang').lean();
    var max = rows.reduce(function(value, row) {
        return Math.max(value, parseSequentialCode(row.ma_khach_hang, 'KH'));
    }, 0);
    return formatSequentialCode('KH', max + 1);
}

function isValidCustomerImportCode(value) {
    return /^KH\d+$/.test(String(value || '').trim());
}

function isValidAddressImportCode(value) {
    return /^DCKH\d+$/.test(String(value || '').trim());
}

async function makeAddressCode() {
    for (var i = 0; i < 20; i += 1) {
        var counter = await Counter.findOneAndUpdate(
            { _id: 'dia_chi_khach_hang' },
            { $inc: { seq: 1 } },
            { upsert: true, returnDocument: 'after' }
        ).lean();
        var code = 'DCKH' + String(counter.seq || 1).padStart(4, '0');
        var existed = await DiaChiKhachHang.exists({ ma_dia_chi: code });
        if (!existed) return code;
    }

    return 'DCKH' + String(Date.now()).slice(-10);
}


module.exports = {
    makeCustomerCode,
    parseSequentialCode,
    formatSequentialCode,
    getNextCustomerCodeSuggestion,
    makeAddressCode,
    isValidCustomerImportCode,
    isValidAddressImportCode
};

