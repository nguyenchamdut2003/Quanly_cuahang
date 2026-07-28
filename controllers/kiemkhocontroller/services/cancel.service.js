const { PhieuKiemKho } = require('../../../models/kiot.model');
const { activeKiemKhoDocumentFilter } = require('../helpers/filter.helper');
const { rollbackKiemKhoStock } = require('./rollback.service');

async function cancelKiemKho({ id, userId }) {
    const phieu = await PhieuKiemKho.findOne(activeKiemKhoDocumentFilter({ _id: id }));
    if (!phieu) return { status: 404, body: { success: false, message: 'Không tìm thấy phiếu kiểm kho' } };
    if (phieu.trang_thai === 'cancelled') return { status: 200, body: { success: true, message: 'Phiếu đã hủy' } };
    await rollbackKiemKhoStock(phieu, userId);
    phieu.trang_thai = 'cancelled';
    await phieu.save();
    return { status: 200, body: { success: true, message: 'Đã hủy phiếu kiểm kho' } };
}

module.exports = { cancelKiemKho };
