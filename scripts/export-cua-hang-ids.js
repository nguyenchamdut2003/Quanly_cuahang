require('dotenv').config();

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const OUTPUT_FILE = path.join(__dirname, '..', 'seed-data', '_cua-hang-ids.json');
const STORE_CODES = ['CH001', 'CH002', 'CH003', 'CH004', 'CH005'];

async function main() {
  const { connectDB } = require('../models/db.model');
  const { CuaHang } = require('../models/kiot.model');
  await connectDB();

  const stores = await CuaHang.find(
    { ma_cua_hang: { $in: STORE_CODES } },
    { ma_cua_hang: 1, ten_cua_hang: 1, trang_thai: 1 }
  ).sort({ ma_cua_hang: 1 }).lean();

  const foundCodes = new Set(stores.map((store) => store.ma_cua_hang));
  const missing = STORE_CODES.filter((code) => !foundCodes.has(code));
  if (missing.length) {
    console.error('[export-cua-hang-ids] Thieu cua hang, hay import cua_hang truoc:');
    missing.forEach((code) => console.error('- ' + code));
    process.exitCode = 1;
    return;
  }

  const output = stores.map((store) => ({
    _id: String(store._id),
    ma_cua_hang: store.ma_cua_hang,
    ten_cua_hang: store.ten_cua_hang,
    trang_thai: store.trang_thai
  }));

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2) + '\n', 'utf8');
  console.log(`[export-cua-hang-ids] Wrote ${OUTPUT_FILE}`);
  console.table(output);
}

main()
  .catch((error) => {
    console.error('[export-cua-hang-ids] ERROR:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close().catch(() => {});
    }
  });
