const { PhieuKiemKho, CTPhieuKiemKho } = require('../../../models/kiot.model');
const { activeKiemKhoDocumentFilter } = require('../helpers/filter.helper');

async function loadKiemKhoCopyDraft(copyFromId) {
    if (!/^[0-9a-fA-F]{24}$/.test(String(copyFromId || ''))) return null;
    const ticket = await PhieuKiemKho.findOne(activeKiemKhoDocumentFilter({ _id: copyFromId })).lean();
    if (!ticket) return null;
    const lines = await CTPhieuKiemKho.find({ phieu_kiem_kho_id: ticket._id }).populate('hang_hoa_id').populate('lo_hang_id').lean();
    if (!lines.length) return null;
    return {
        cua_hang_id: ticket.cua_hang_id ? String(ticket.cua_hang_id) : '',
        kho_id: ticket.kho_id ? String(ticket.kho_id) : '',
        ghi_chu: ticket.ghi_chu || '',
        items: lines.map(row => ({
            hang_hoa_id: String(row.hang_hoa_id?._id || row.hang_hoa_id || ''),
            lo_hang_id: row.lo_hang_id ? String(row.lo_hang_id._id || row.lo_hang_id) : '',
            ma_hang: row.hang_hoa_id?.ma_hang || '',
            ten_hang: row.hang_hoa_id?.ten_hang || '',
            ton_kho_he_thong: Number(row.ton_kho_he_thong || 0),
            so_luong_thuc_te: Number(row.so_luong_thuc_te || 0),
            ten_quy_cach: row.ten_quy_cach || '',
            nguyen_nhan_lech: row.nguyen_nhan_lech || ''
        })).filter(row => row.hang_hoa_id)
    };
}

module.exports = { loadKiemKhoCopyDraft };
