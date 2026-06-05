/**
 * Backfill PhieuThuChi.chi_tiet_thanh_toan.tien_tra_khach (default 0).
 * Does not rewrite tien_mat/chuyen_khoan from phuong_thuc_thanh_toan.
 *
 * Usage: node scripts/migrate-phieu-thu-chi-tien-tra-khach.js
 */
require('dotenv').config();

const { mongoose, connectDB } = require('../models/db.model');
const { PhieuThuChi } = require('../models/kiot.model');

async function run() {
  await connectDB();

  const missingSubdoc = await PhieuThuChi.updateMany(
    { chi_tiet_thanh_toan: { $exists: false } },
    {
      $set: {
        chi_tiet_thanh_toan: {
          tien_mat: 0,
          chuyen_khoan: 0,
          tien_tra_khach: 0
        }
      }
    }
  );

  const missingRefund = await PhieuThuChi.updateMany(
    { 'chi_tiet_thanh_toan.tien_tra_khach': { $exists: false } },
    { $set: { 'chi_tiet_thanh_toan.tien_tra_khach': 0 } }
  );

  console.log('chi_tiet_thanh_toan created:', missingSubdoc.modifiedCount);
  console.log('tien_tra_khach defaulted:', missingRefund.modifiedCount);

  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch (_) { /* ignore */ }
  process.exit(1);
});
