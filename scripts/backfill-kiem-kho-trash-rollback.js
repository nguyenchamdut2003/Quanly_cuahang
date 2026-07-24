require('dotenv').config();

const { mongoose } = require('../models/db.model');
const {
  PhieuKiemKho,
  CTPhieuKiemKho,
  HangHoa
} = require('../models/kiot.model');
const {
  congTonKho,
  truTonKho,
  lotHasQuyCachStock
} = require('../services/kho.service');

function normalizeTenQuyCach(value) {
  return String(value || '').trim();
}

async function shouldSyncQuyCach(khoId, hangHoaId, loHangId, tenQuyCach) {
  if (tenQuyCach) return true;
  if (!loHangId) return false;
  return lotHasQuyCachStock(khoId, hangHoaId, loHangId);
}

async function rollbackTicket(ticket, apply) {
  const lines = await CTPhieuKiemKho.find({ phieu_kiem_kho_id: ticket._id }).lean();
  const maPhieu = ticket.ma_kiem_kho || String(ticket._id);
  let changedLines = 0;

  for (const row of lines) {
    const diff = Number(row.so_luong_lech || 0);
    if (!diff) continue;
    changedLines += 1;
    if (!apply) continue;

    const product = await HangHoa.findById(row.hang_hoa_id).select('gia_von').lean();
    const cost = Number(product?.gia_von || 0);
    const tenQuyCach = normalizeTenQuyCach(row.ten_quy_cach);
    const syncQuyCach = await shouldSyncQuyCach(ticket.kho_id, row.hang_hoa_id, row.lo_hang_id, tenQuyCach);
    const payload = {
      kho_id: ticket.kho_id,
      hang_hoa_id: row.hang_hoa_id,
      lo_hang_id: row.lo_hang_id,
      ten_quy_cach: tenQuyCach,
      sync_quy_cach: syncQuyCach,
      nguoi_tao_id: ticket.deleted_by || ticket.nguoi_tao_id || null,
      loai_phieu: 'kiem_kho',
      ma_phieu: maPhieu,
      ghi_chu: `Huy kiem kho ${maPhieu}`
    };

    if (diff > 0) {
      await truTonKho(Object.assign({}, payload, { so_luong: diff }));
    } else {
      await congTonKho(Object.assign({}, payload, {
        so_luong: Math.abs(diff),
        gia_von: cost
      }));
    }
  }

  if (apply) {
    ticket.stock_rollback_at = new Date();
    await ticket.save();
  }

  return changedLines;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const tickets = await PhieuKiemKho.find({
    deleted_at: { $ne: null },
    stock_rollback_at: null,
    trang_thai: { $ne: 'cancelled' }
  }).sort({ deleted_at: 1 });

  console.log(`[kiem-kho-trash-rollback] mode=${apply ? 'apply' : 'dry-run'} tickets=${tickets.length}`);

  let lineCount = 0;
  for (const ticket of tickets) {
    const changed = await rollbackTicket(ticket, apply);
    lineCount += changed;
    console.log(`${apply ? '[rolled-back]' : '[would-rollback]'} ${ticket.ma_kiem_kho || ticket._id} lines=${changed}`);
  }

  console.log(`[kiem-kho-trash-rollback] done tickets=${tickets.length} lines=${lineCount}`);
}

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
