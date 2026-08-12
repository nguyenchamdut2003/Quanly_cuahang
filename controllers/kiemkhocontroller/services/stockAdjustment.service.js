const { TonKho, TonKhoLo, TonKhoLoQuyCach } = require('../../../models/kiot.model');
const { congTonKho, truTonKho, resolveTenQuyCachFromParams } = require('../../../services/kho.service');
const { normalizeTenQuyCach } = require('../helpers/common.helper');
const { shouldSyncQuyCach } = require('../helpers/stock.helper');

async function buildStockAdjustmentContext({ kho, item }) {
    const stock = item.lo_hang_id
        ? await TonKhoLo.findOne({ kho_id: kho._id, hang_hoa_id: item.hang_hoa_id, lo_hang_id: item.lo_hang_id })
        : await TonKho.findOne({ kho_id: kho._id, hang_hoa_id: item.hang_hoa_id });
    const tenQuyCach = normalizeTenQuyCach(item.ten_quy_cach || item.ten_thuoc_tinh || await resolveTenQuyCachFromParams(item));
    const syncQuyCach = await shouldSyncQuyCach(kho._id, item.hang_hoa_id, item.lo_hang_id, tenQuyCach);
    if (item.lo_hang_id && syncQuyCach && !tenQuyCach) {
        const error = new Error('Lô có quản lý quy cách, vui lòng kiểm kho theo từng quy cách');
        error.status = 400;
        throw error;
    }
    let systemQuantity = Number(stock?.so_luong || 0);
    if (item.lo_hang_id && tenQuyCach) {
        const qcStock = await TonKhoLoQuyCach.findOne({
            kho_id: kho._id,
            hang_hoa_id: item.hang_hoa_id,
            lo_hang_id: item.lo_hang_id,
            $or: [{ ten_quy_cach: tenQuyCach }, { ten_thuoc_tinh: tenQuyCach }]
        });
        systemQuantity = Number(qcStock?.so_luong || 0);
    }
    return { systemQuantity, tenQuyCach, syncQuyCach };
}

async function applyKiemKhoDifference({ difference, kho, item, cost, userId, maPhieu, ngay, ghiChu, differenceReason, tenQuyCach, syncQuyCach }) {
    if (difference > 0) {
        await congTonKho({
            kho_id: kho._id,
            hang_hoa_id: item.hang_hoa_id,
            lo_hang_id: item.lo_hang_id,
            ten_quy_cach: tenQuyCach,
            gia_tri_thuoc_tinh_id: item.gia_tri_thuoc_tinh_id,
            sync_quy_cach: syncQuyCach,
            so_luong: difference,
            gia_von: cost,
            nguoi_tao_id: userId,
            loai_phieu: 'kiem_kho',
            ma_phieu: maPhieu,
            ngay,
            ghi_chu: differenceReason || ghiChu
        });
    } else if (difference < 0) {
        await truTonKho({
            kho_id: kho._id,
            hang_hoa_id: item.hang_hoa_id,
            lo_hang_id: item.lo_hang_id,
            ten_quy_cach: tenQuyCach,
            gia_tri_thuoc_tinh_id: item.gia_tri_thuoc_tinh_id,
            sync_quy_cach: syncQuyCach,
            so_luong: Math.abs(difference),
            nguoi_tao_id: userId,
            loai_phieu: 'kiem_kho',
            ma_phieu: maPhieu,
            ngay,
            ghi_chu: differenceReason || ghiChu
        });
    }
}

module.exports = { buildStockAdjustmentContext, applyKiemKhoDifference };
