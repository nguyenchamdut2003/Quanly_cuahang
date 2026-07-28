var { NhomKhachHang, KhachHang } = require('../../../models/kiot.model');

async function loadCustomerGroups() {
    return await NhomKhachHang.find().sort({ ten_nhom: 1 }).lean();
}

async function createGroup(body) {
    var tenNhom = String(body.ten_nhom || '').trim();
    var moTa = String(body.mo_ta || '').trim();
    if (!tenNhom) {
        var error = new Error('missing_group_name');
        error.code = 'missing_group_name';
        throw error;
    }
    return await NhomKhachHang.create({ ten_nhom: tenNhom, mo_ta: moTa, trang_thai: 'active' });
}

async function updateGroup(groupId, body) {
    var tenNhom = String(body.ten_nhom || '').trim();
    var moTa = String(body.mo_ta || '').trim();
    if (!tenNhom) {
        var error = new Error('missing_group_name');
        error.code = 'missing_group_name';
        throw error;
    }
    await NhomKhachHang.findByIdAndUpdate(groupId, { ten_nhom: tenNhom, mo_ta: moTa }, { runValidators: true });
}

async function removeGroup(groupId) {
    await KhachHang.updateMany(
        { nhom_khach_hang_id: groupId },
        { $unset: { nhom_khach_hang_id: 1 } }
    );
    await NhomKhachHang.findByIdAndDelete(groupId);
}

module.exports = {
    loadCustomerGroups,
    createGroup,
    updateGroup,
    removeGroup
};
