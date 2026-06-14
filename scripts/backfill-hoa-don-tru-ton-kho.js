/**
 * Trừ tồn kho cho các hóa đơn bán trực tiếp đã tạo trước khi có logic truTonKho khi thanh toán.
 * Dry-run (mặc định): node scripts/backfill-hoa-don-tru-ton-kho.js
 * Áp dụng thật:       node scripts/backfill-hoa-don-tru-ton-kho.js --apply
 */
require('dotenv').config();
const mongoose = require('mongoose');
const {
  HoaDonBanHang,
  CTHoaDonBanHang
} = require('../models/kiot.model');
const { truTonKho } = require('../services/kho.service');

const APPLY = process.argv.includes('--apply');

function applyLotAllocations(allocations = []) {
  const rows = allocations.filter(row => Number(row.so_luong) > 0 && row.lo_hang_id);
  return {
    lot_allocations: rows,
    lo_hang_id: rows.length === 1 ? rows[0].lo_hang_id : null
  };
}

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/quanly_cuahang';
  await mongoose.connect(uri);

  const invoices = await HoaDonBanHang.find({
    trang_thai: { $ne: 'cancelled' },
    da_tru_ton_kho: { $ne: true }
  }).sort({ ngay_ban: 1 }).lean();

  console.log(`Found ${invoices.length} invoice(s) without stock deduction. Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}`);

  for (const invoice of invoices) {
    const lines = await CTHoaDonBanHang.find({ hoa_don_id: invoice._id }).lean();
    if (!lines.length) {
      console.log(`- Skip ${invoice.ma_hoa_don}: no lines`);
      continue;
    }
    if (!invoice.kho_id) {
      console.log(`- Skip ${invoice.ma_hoa_don}: missing kho_id`);
      continue;
    }

    console.log(`\n${invoice.ma_hoa_don} (${lines.length} line(s))`);
    for (const line of lines) {
      const qty = Number(line.so_luong || 0);
      if (!qty || !line.hang_hoa_id) continue;
      console.log(`  ${line.ma_hang_snapshot || line.hang_hoa_id} x${qty} lo=${line.lo_hang_id || 'FEFO'}`);
      if (!APPLY) continue;

      const stockResult = await truTonKho({
        kho_id: invoice.kho_id,
        hang_hoa_id: line.hang_hoa_id,
        lo_hang_id: line.lo_hang_id || undefined,
        ten_quy_cach: line.ten_quy_cach || line.ten_thuoc_tinh || '',
        gia_tri_thuoc_tinh_id: line.gia_tri_thuoc_tinh_id || undefined,
        sync_quy_cach: Boolean(line.gia_tri_thuoc_tinh_id || line.ten_quy_cach || line.ten_thuoc_tinh),
        so_luong: qty,
        loai_phieu: 'ban_hang',
        ma_phieu: invoice.ma_hoa_don || String(invoice._id),
        ghi_chu: `Backfill tru ton HD ${invoice.ma_hoa_don || invoice._id}`
      });
      const lotPatch = applyLotAllocations(stockResult.allocations);
      await CTHoaDonBanHang.updateOne({ _id: line._id }, { $set: lotPatch });
    }

    if (APPLY) {
      await HoaDonBanHang.updateOne({ _id: invoice._id }, { $set: { da_tru_ton_kho: true } });
      console.log(`  => marked da_tru_ton_kho`);
    }
  }

  await mongoose.disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
