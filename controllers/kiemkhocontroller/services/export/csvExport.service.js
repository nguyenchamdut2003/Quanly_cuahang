const { PhieuKiemKho, CTPhieuKiemKho } = require('../../../../models/kiot.model');
const { buildKiemKhoFilter, activeKiemKhoDocumentFilter } = require('../../helpers/filter.helper');
const { lotDisplayFromPopulated } = require('../../helpers/common.helper');
const { buildCsvContent } = require('../../helpers/export.helper');

async function buildKiemKhoListCsv(query) {
    const { filter } = buildKiemKhoFilter(query);
    const tickets = await PhieuKiemKho.find(filter).populate('kho_id').populate('nguoi_tao_id').sort({ ngay_kiem: -1, created_at: -1 });
    const ticketIds = tickets.map(item => item._id);
    const details = ticketIds.length ? await CTPhieuKiemKho.find({ phieu_kiem_kho_id: { $in: ticketIds } }) : [];
    const summaryMap = details.reduce((acc, item) => {
        const key = String(item.phieu_kiem_kho_id);
        if (!acc[key]) acc[key] = { positive: 0, negative: 0, actual: 0, value: 0 };
        const diff = Number(item.so_luong_lech || 0);
        if (diff > 0) acc[key].positive += diff;
        if (diff < 0) acc[key].negative += Math.abs(diff);
        acc[key].actual += Number(item.so_luong_thuc_te || 0);
        acc[key].value += Number(item.gia_tri_lech || 0);
        return acc;
    }, {});
    const rows = [['Mã kiểm kho','Ngày tạo','Ngày cân bằng','Kho','Người tạo','SL thực tế','Tổng chênh lệch','SL lệch tăng','SL lệch giảm','Giá trị chênh lệch','Trạng thái','Ghi chú']];
    tickets.forEach(ticket => {
        const summary = summaryMap[String(ticket._id)] || {};
        const creator = ticket.nguoi_tao_id ? (ticket.nguoi_tao_id.ho_ten || ticket.nguoi_tao_id.username || ticket.nguoi_tao_id.email || '') : '';
        rows.push([ticket.ma_kiem_kho || '', ticket.ngay_kiem ? ticket.ngay_kiem.toISOString() : (ticket.created_at ? ticket.created_at.toISOString() : ''), ticket.trang_thai === 'completed' && (ticket.ngay_kiem || ticket.updated_at) ? (ticket.ngay_kiem || ticket.updated_at).toISOString() : '', ticket.kho_id ? ticket.kho_id.ten_kho : '', creator, ticket.tong_so_luong_thuc_te || summary.actual || 0, ticket.tong_so_luong_lech || 0, summary.positive || 0, summary.negative || 0, ticket.tong_gia_tri_lech || summary.value || 0, ticket.trang_thai || '', ticket.ghi_chu || '']);
    });
    return { filename: 'kiem-kho.csv', content: buildCsvContent(rows) };
}

async function buildKiemKhoDetailCsv(id) {
    if (!/^[0-9a-fA-F]{24}$/.test(String(id || ''))) {
        const error = new Error('Không tìm thấy phiếu kiểm kho');
        error.status = 404;
        throw error;
    }
    const ticket = await PhieuKiemKho.findOne(activeKiemKhoDocumentFilter({ _id: id })).populate('kho_id').populate('nguoi_tao_id');
    if (!ticket) {
        const error = new Error('Không tìm thấy phiếu kiểm kho');
        error.status = 404;
        throw error;
    }
    const details = await CTPhieuKiemKho.find({ phieu_kiem_kho_id: ticket._id }).populate({ path: 'hang_hoa_id', populate: [{ path: 'thuong_hieu_id' }, { path: 'don_vi_tinh_id' }] }).populate('lo_hang_id');
    const totalActual = details.reduce((sum, item) => sum + Number(item.so_luong_thuc_te || 0), 0);
    const positiveDiff = details.reduce((sum, item) => { const diff = Number(item.so_luong_lech || 0); return diff > 0 ? sum + diff : sum; }, 0);
    const negativeDiff = details.reduce((sum, item) => { const diff = Number(item.so_luong_lech || 0); return diff < 0 ? sum + Math.abs(diff) : sum; }, 0);
    const rows = [['Mã kiểm kho','Thời gian','Ngày cân bằng','SL thực tế','Tổng thực tế','Tổng chênh lệch','SL lệch tăng','SL lệch giảm','Ghi chú','Trạng thái','Mã hàng','Tên hàng','Thương hiệu','Đơn vị tính','Tên lô','Mã lô','Thuộc tính','Tồn kho','Kiểm thực tế','SL lệch','Giá trị lệch']];
    details.forEach(item => {
        const product = item.hang_hoa_id || {};
        const lot = item.lo_hang_id || {};
        rows.push([ticket.ma_kiem_kho || '', ticket.ngay_kiem ? ticket.ngay_kiem.toISOString() : (ticket.created_at ? ticket.created_at.toISOString() : ''), ticket.trang_thai === 'completed' && (ticket.ngay_kiem || ticket.updated_at) ? (ticket.ngay_kiem || ticket.updated_at).toISOString() : '', ticket.tong_so_luong_thuc_te || totalActual || 0, ticket.tong_gia_tri_thuc_te || 0, ticket.tong_so_luong_lech || 0, positiveDiff, negativeDiff, ticket.ghi_chu || '', ticket.trang_thai || '', product.ma_hang || '', product.ten_hang || '', product.thuong_hieu_id ? product.thuong_hieu_id.ten_thuong_hieu : '', product.don_vi_tinh_id ? product.don_vi_tinh_id.ten_don_vi : '', lotDisplayFromPopulated(lot), lot.ma_lo || '', item.ten_quy_cach || '', item.ton_kho_he_thong || 0, item.so_luong_thuc_te || 0, item.so_luong_lech || 0, item.gia_tri_lech || 0]);
    });
    if (!details.length) {
        rows.push([ticket.ma_kiem_kho || '', ticket.ngay_kiem ? ticket.ngay_kiem.toISOString() : (ticket.created_at ? ticket.created_at.toISOString() : ''), ticket.trang_thai === 'completed' && (ticket.ngay_kiem || ticket.updated_at) ? (ticket.ngay_kiem || ticket.updated_at).toISOString() : '', ticket.tong_so_luong_thuc_te || 0, ticket.tong_gia_tri_thuc_te || 0, ticket.tong_so_luong_lech || 0, 0, 0, ticket.ghi_chu || '', ticket.trang_thai || '', '', '', '', '', '', '', '', '', '', '', '']);
    }
    return { filename: `${ticket.ma_kiem_kho || 'kiem-kho'}.csv`, content: buildCsvContent(rows) };
}

module.exports = { buildKiemKhoListCsv, buildKiemKhoDetailCsv };
