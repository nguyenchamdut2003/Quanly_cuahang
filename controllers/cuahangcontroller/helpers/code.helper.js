const { CuaHang, Kho } = require('../../../models/kiot.model');

function parseCodeNumber(value, prefix) {
    var match = String(value || '').trim().match(new RegExp('^' + prefix + '(\\d+)$'));
    return match ? Number(match[1]) : 0;
}

function formatSequentialCode(prefix, number) {
    return prefix + String(number).padStart(4, '0');
}

async function getMaxSequentialCodeNumber(Model, field, prefix) {
    var rows = await Model.find({ [field]: new RegExp('^' + prefix + '\\d+$') }).select(field).lean();
    return rows.reduce(function(max, row) {
        return Math.max(max, parseCodeNumber(row[field], prefix));
    }, 0);
}

async function getNextStoreCodeNumber() {
    return (await getMaxSequentialCodeNumber(CuaHang, 'ma_cua_hang', 'CH')) + 1;
}

async function getNextWarehouseCodeNumber() {
    return (await getMaxSequentialCodeNumber(Kho, 'ma_kho', 'KHO')) + 1;
}

function isValidStoreCode(value) {
    return /^CH\d+$/.test(String(value || '').trim());
}

function isValidWarehouseCode(value) {
    return /^KHO\d+$/.test(String(value || '').trim());
}

async function makeStoreCode() {
    return formatSequentialCode('CH', await getNextStoreCodeNumber());
}

async function makeWarehouseCode() {
    return formatSequentialCode('KHO', await getNextWarehouseCodeNumber());
}

module.exports = {
    parseCodeNumber,
    formatSequentialCode,
    getMaxSequentialCodeNumber,
    getNextStoreCodeNumber,
    getNextWarehouseCodeNumber,
    makeStoreCode,
    makeWarehouseCode,
    isValidStoreCode,
    isValidWarehouseCode
};
