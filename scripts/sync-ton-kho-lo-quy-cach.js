require('dotenv').config();
const mongoose = require('mongoose');
const {
  TonKho,
  TonKhoLo,
  TonKhoLoQuyCach,
  LoHang
} = require('../models/kiot.model');

async function main() {
  const apply = process.argv.includes('--apply');
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) throw new Error('Missing MONGO_URI');

  await mongoose.connect(uri);

  const lotRows = await TonKhoLo.find({}).lean();
  const report = {
    checked: 0,
    mismatched: 0,
    fixedSingleQuyCach: 0,
    skippedMultiQuyCach: 0,
    skippedNoQuyCach: 0
  };

  for (const lotStock of lotRows) {
    const filter = {
      kho_id: lotStock.kho_id,
      hang_hoa_id: lotStock.hang_hoa_id,
      lo_hang_id: lotStock.lo_hang_id
    };
    const qcRows = await TonKhoLoQuyCach.find(filter);
    if (!qcRows.length) {
      report.skippedNoQuyCach += 1;
      continue;
    }

    report.checked += 1;
    const lotQty = Number(lotStock.so_luong || 0);
    const qcTotal = qcRows.reduce((sum, row) => sum + Number(row.so_luong || 0), 0);
    if (qcTotal === lotQty) continue;

    report.mismatched += 1;
    const idText = [
      'kho=' + String(lotStock.kho_id),
      'hang=' + String(lotStock.hang_hoa_id),
      'lo=' + String(lotStock.lo_hang_id),
      'ton_lo=' + lotQty,
      'tong_quy_cach=' + qcTotal,
      'so_quy_cach=' + qcRows.length
    ].join(' ');

    if (qcRows.length !== 1) {
      report.skippedMultiQuyCach += 1;
      console.log('[skip-multi]', idText);
      continue;
    }

    console.log(apply ? '[fix]' : '[dry-run-fix]', idText);
    if (apply) {
      qcRows[0].so_luong = lotQty;
      await qcRows[0].save();
      const lot = await LoHang.findById(lotStock.lo_hang_id);
      if (lot) {
        lot.so_luong_con_lai = lotQty;
        if (lot.trang_thai !== 'huy') {
          lot.trang_thai = lotQty > 0 ? 'active' : 'het_hang';
        }
        await lot.save();
      }

      const allLots = await TonKhoLo.find({
        kho_id: lotStock.kho_id,
        hang_hoa_id: lotStock.hang_hoa_id
      }).lean();
      const productTotal = allLots.reduce((sum, row) => {
        return sum + Number(
          String(row._id) === String(lotStock._id) ? lotQty : row.so_luong || 0
        );
      }, 0);
      await TonKho.findOneAndUpdate(
        { kho_id: lotStock.kho_id, hang_hoa_id: lotStock.hang_hoa_id },
        { $set: { so_luong: productTotal } },
        { new: true }
      );
    }
    report.fixedSingleQuyCach += 1;
  }

  console.log(JSON.stringify(Object.assign({ apply }, report), null, 2));
  await mongoose.disconnect();
}

main().catch(async error => {
  console.error(error);
  try {
    await mongoose.disconnect();
  } catch (_) {}
  process.exit(1);
});
