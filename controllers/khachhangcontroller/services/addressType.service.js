var { LoaiDiaChiKhachHang, DiaChiKhachHang } = require('../../../models/kiot.model');
var { slugifyAddressType } = require('../helpers/address.helper');

async function loadAddressTypes() {
    return await LoaiDiaChiKhachHang.find({ trang_thai: 'active' }).sort({ created_at: 1 }).lean();
}

async function createAddressType(body) {
    var tenLoai = String(body.ten_loai || '').trim();
    var maLoai = String(body.ma_loai || '').trim().toLowerCase();
    if (!tenLoai) {
        var missing = new Error('missing_address_type');
        missing.code = 'missing_address_type';
        throw missing;
    }
    if (!maLoai) maLoai = slugifyAddressType(tenLoai);
    if (!maLoai) maLoai = 'loai_dia_chi';
    var existed = await LoaiDiaChiKhachHang.findOne({
        $or: [{ ma_loai: maLoai }, { ten_loai: tenLoai }]
    }).lean();
    if (existed) {
        var duplicate = new Error('duplicate_address_type');
        duplicate.code = 'duplicate_address_type';
        throw duplicate;
    }
    return await LoaiDiaChiKhachHang.create({ ma_loai: maLoai, ten_loai: tenLoai, trang_thai: 'active' });
}

async function updateAddressType(addressTypeId, body) {
    var tenLoai = String(body.ten_loai || '').trim();
    if (!tenLoai) {
        var missing = new Error('missing_address_type');
        missing.code = 'missing_address_type';
        throw missing;
    }
    var current = await LoaiDiaChiKhachHang.findById(addressTypeId).lean();
    if (!current) {
        var notFound = new Error('invalid_address_type');
        notFound.code = 'invalid_address_type';
        notFound.statusCode = 404;
        throw notFound;
    }
    if (String(current.ma_loai || '').toLowerCase() === 'khac') {
        var defaultError = new Error('default_address_type');
        defaultError.code = 'default_address_type';
        throw defaultError;
    }
    var duplicateName = await LoaiDiaChiKhachHang.findOne({
        _id: { $ne: addressTypeId },
        ten_loai: tenLoai
    }).lean();
    if (duplicateName) {
        var duplicate = new Error('duplicate_address_type');
        duplicate.code = 'duplicate_address_type';
        throw duplicate;
    }
    await LoaiDiaChiKhachHang.findByIdAndUpdate(addressTypeId, { ten_loai: tenLoai }, { runValidators: true });
}

async function removeAddressType(addressTypeId) {
    var addressType = await LoaiDiaChiKhachHang.findById(addressTypeId).lean();
    if (!addressType) {
        var notFound = new Error('invalid_address_type');
        notFound.code = 'invalid_address_type';
        notFound.statusCode = 404;
        throw notFound;
    }
    if (String(addressType.ma_loai || '').toLowerCase() === 'khac') {
        var defaultError = new Error('default_address_type');
        defaultError.code = 'default_address_type';
        throw defaultError;
    }
    if (addressType && addressType.ma_loai) {
        await DiaChiKhachHang.updateMany(
            { loai_dia_chi: addressType.ma_loai },
            { $set: { loai_dia_chi: 'khac' } }
        );
    }
    await LoaiDiaChiKhachHang.findByIdAndDelete(addressTypeId);
}

module.exports = {
    loadAddressTypes,
    createAddressType,
    updateAddressType,
    removeAddressType
};
