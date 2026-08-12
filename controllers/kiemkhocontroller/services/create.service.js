const { CuaHang, Kho, HangHoa, PhieuKiemKho, CTPhieuKiemKho } = require('../../../models/kiot.model');
const { parseItems } = require('../helpers/common.helper');
const { loadKiemKhoCopyDraft } = require('./copyDraft.service');
const { buildStockAdjustmentContext, applyKiemKhoDifference } = require('./stockAdjustment.service');

function validationError(message) {
    const error = new Error(message);
    error.status = 400;
    return error;
}

function formatDateTimeLocal(date = new Date()) {
    const pad = value => String(value).padStart(2, '0');
    return [
        date.getFullYear(),
        pad(date.getMonth() + 1),
        pad(date.getDate())
    ].join('-') + 'T' + [pad(date.getHours()), pad(date.getMinutes())].join(':');
}

async function makeKiemKhoCode() {
    const rows = await PhieuKiemKho.find({ ma_kiem_kho: /^KK\d{4,6}$/ })
        .select('ma_kiem_kho')
        .lean();
    const maxNumber = rows.reduce((max, row) => {
        const number = Number(String(row.ma_kiem_kho || '').replace(/\D/g, ''));
        return Number.isFinite(number) && number > max ? number : max;
    }, 0);
    const next = maxNumber + 1;
    return 'KK' + String(next).padStart(4, '0');
}

async function loadCreatePageData({ query, user }) {
    const [stores, warehouses, products] = await Promise.all([
        CuaHang.find(),
        Kho.find({ trang_thai: 'active' }).sort({ ten_kho: 1 }),
        HangHoa.find()
    ]);
    let copyDraft = null;
    let copyFromError = '';
    const copyFromId = String(query?.copy_from || '').trim();
    if (copyFromId) {
        copyDraft = await loadKiemKhoCopyDraft(copyFromId);
        if (!copyDraft) copyFromError = 'Không tải được phiếu kiểm kho để sao chép.';
    }
    return { user, stores, warehouses, products, todayValue: formatDateTimeLocal(), copyDraftJson: copyDraft ? JSON.stringify(copyDraft).replace(/</g, '\\u003c') : '', copyFromError };
}

async function createKiemKho({ body, user }) {
    const { cua_hang_id, kho_id, ghi_chu, ngay_kiem } = body || {};
    const items = parseItems(body?.items);
    const ngayKiem = ngay_kiem ? new Date(ngay_kiem) : new Date();
    if (Number.isNaN(ngayKiem.getTime())) throw validationError('Ngày tạo không hợp lệ');
    if (!kho_id) throw validationError('Vui lòng chọn kho.');
    const kho = await Kho.findById(kho_id);
    if (!kho) throw validationError('Kho kiểm không hợp lệ');
    if (!items.length) throw validationError('Chưa chọn hàng hóa kiểm kho');

    const ma_kiem_kho = await makeKiemKhoCode();
    const phieu = await PhieuKiemKho.create({ ma_kiem_kho, ngay_kiem: ngayKiem, cua_hang_id: cua_hang_id || kho.cua_hang_id, chi_nhanh_id: kho.chi_nhanh_id, kho_id: kho._id, nguoi_tao_id: user?._id, ghi_chu, trang_thai: 'completed' });
    let tongThucTe = 0;
    let tongLech = 0;
    let tongGiaTriLech = 0;
    for (const item of items) {
        const actualQuantity = Number(item.so_luong_thuc_te);
        if (!item.hang_hoa_id || !Number.isFinite(actualQuantity) || actualQuantity < 0) throw validationError('Dữ liệu kiểm kho không hợp lệ');
        const product = await HangHoa.findById(item.hang_hoa_id);
        if (!product) throw validationError('Hàng hóa không hợp lệ');
        if (product.quan_ly_theo_lo && !item.lo_hang_id) throw validationError('Hàng quản lý theo lô phải có lô hàng');
        const { systemQuantity, tenQuyCach, syncQuyCach } = await buildStockAdjustmentContext({ kho, item });
        const difference = actualQuantity - systemQuantity;
        const differenceReason = String(item.nguyen_nhan_lech || '').trim();
        if (difference !== 0 && !differenceReason) throw validationError('Vui lòng nhập nguyên nhân lệch cho hàng hóa có chênh lệch');
        const cost = Number(product.gia_von) || 0;
        const differenceValue = difference * cost;
        tongThucTe += actualQuantity;
        tongLech += difference;
        tongGiaTriLech += differenceValue;
        try {
            await applyKiemKhoDifference({ difference, kho, item, cost, userId: user?._id, maPhieu: ma_kiem_kho, ngay: ngayKiem, ghiChu: ghi_chu, differenceReason, tenQuyCach, syncQuyCach });
        } catch (error) {
            throw validationError(error.message || (difference > 0 ? 'Không thể điều chỉnh kiểm kho' : 'Không đủ tồn kho để điều chỉnh kiểm kho'));
        }
        await CTPhieuKiemKho.create({ phieu_kiem_kho_id: phieu._id, hang_hoa_id: item.hang_hoa_id, lo_hang_id: item.lo_hang_id || null, ton_kho_he_thong: systemQuantity, so_luong_thuc_te: actualQuantity, so_luong_lech: difference, gia_tri_lech: differenceValue, ten_quy_cach: tenQuyCach, nguyen_nhan_lech: differenceReason });
    }
    phieu.tong_so_luong_thuc_te = tongThucTe;
    phieu.tong_so_luong_lech = tongLech;
    phieu.tong_gia_tri_lech = tongGiaTriLech;
    await phieu.save();
    return { success: true, message: 'Hoàn thành kiểm kho', ma_kiem_kho, id: phieu._id, print_url: '/chung-tu-kho/kiem-kho/' + phieu._id };
}

module.exports = { loadCreatePageData, createKiemKho };
