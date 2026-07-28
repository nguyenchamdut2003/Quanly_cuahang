const { CTPhieuKiemKho, HangHoa } = require('../../../models/kiot.model');
const { congTonKho, truTonKho } = require('../../../services/kho.service');
const { normalizeTenQuyCach } = require('../helpers/common.helper');
const { shouldSyncQuyCach } = require('../helpers/stock.helper');

async function rollbackKiemKhoStock(phieu, userId) {
    if (!phieu || phieu.stock_rollback_at || phieu.trang_thai === 'cancelled') return false;
    const lines = await CTPhieuKiemKho.find({ phieu_kiem_kho_id: phieu._id }).lean();
    const maPhieu = phieu.ma_kiem_kho || String(phieu._id);
    for (const row of lines) {
        const diff = Number(row.so_luong_lech || 0);
        if (!diff) continue;
        const product = await HangHoa.findById(row.hang_hoa_id).select('gia_von').lean();
        const cost = Number(product?.gia_von || 0);
        const tenQuyCach = normalizeTenQuyCach(row.ten_quy_cach);
        const syncQuyCach = await shouldSyncQuyCach(phieu.kho_id, row.hang_hoa_id, row.lo_hang_id, tenQuyCach);
        if (diff > 0) {
            await truTonKho({ kho_id: phieu.kho_id, hang_hoa_id: row.hang_hoa_id, lo_hang_id: row.lo_hang_id, ten_quy_cach: tenQuyCach, sync_quy_cach: syncQuyCach, so_luong: diff, nguoi_tao_id: userId, loai_phieu: 'kiem_kho', ma_phieu: maPhieu, ghi_chu: `Huy kiem kho ${maPhieu}` });
        } else {
            await congTonKho({ kho_id: phieu.kho_id, hang_hoa_id: row.hang_hoa_id, lo_hang_id: row.lo_hang_id, ten_quy_cach: tenQuyCach, sync_quy_cach: syncQuyCach, so_luong: Math.abs(diff), gia_von: cost, nguoi_tao_id: userId, loai_phieu: 'kiem_kho', ma_phieu: maPhieu, ghi_chu: `Huy kiem kho ${maPhieu}` });
        }
    }
    phieu.stock_rollback_at = new Date();
    await phieu.save();
    return true;
}

module.exports = { rollbackKiemKhoStock };
