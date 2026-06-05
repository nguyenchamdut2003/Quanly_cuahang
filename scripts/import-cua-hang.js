require('dotenv').config();

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const DATA_FILE = path.join(__dirname, '..', 'seed-data', '01-cua-hang.json');
const DRY_RUN = String(process.env.DRY_RUN || '').toLowerCase() === 'true';
const VALID_STATUS = new Set(['active', 'inactive']);

function readRows() {
  const raw = fs.readFileSync(DATA_FILE, 'utf8');
  const rows = JSON.parse(raw);
  if (!Array.isArray(rows)) throw new Error('File seed-data/01-cua-hang.json phai la mang JSON');
  return rows;
}

function validateRows(rows) {
  const errors = [];
  const seenCodes = new Set();
  rows.forEach((row, index) => {
    const line = index + 1;
    const code = String(row.ma_cua_hang || '').trim();
    if (!code) errors.push(`Dong ${line}: thieu ma_cua_hang`);
    if (seenCodes.has(code)) errors.push(`Dong ${line}: trung ma_cua_hang trong file ${code}`);
    if (code) seenCodes.add(code);
    if (!String(row.ten_cua_hang || '').trim()) errors.push(`Dong ${line} ${code}: thieu ten_cua_hang`);
    if (row.trang_thai && !VALID_STATUS.has(row.trang_thai)) {
      errors.push(`Dong ${line} ${code}: trang_thai khong hop le ${row.trang_thai}`);
    }
  });
  return errors;
}

function normalize(row) {
  return {
    ma_cua_hang: String(row.ma_cua_hang || '').trim(),
    ten_cua_hang: String(row.ten_cua_hang || '').trim(),
    ma_so_thue: String(row.ma_so_thue || '').trim(),
    dia_chi: String(row.dia_chi || '').trim(),
    dia_chi_chi_tiet: String(row.dia_chi_chi_tiet || '').trim(),
    dia_chi_day_du: String(row.dia_chi_day_du || '').trim(),
    tinh_thanh: String(row.tinh_thanh || '').trim(),
    tinh_thanh_id: Number(row.tinh_thanh_id || 0) || undefined,
    phuong_xa: String(row.phuong_xa || '').trim(),
    phuong_xa_code: String(row.phuong_xa_code || '').trim(),
    sdt: String(row.sdt || '').trim(),
    email: String(row.email || '').trim(),
    trang_thai: row.trang_thai === 'inactive' ? 'inactive' : 'active'
  };
}

async function main() {
  const rows = readRows();
  const errors = validateRows(rows);
  if (errors.length) {
    console.error('[import-cua-hang] Validate failed');
    errors.forEach((error) => console.error('- ' + error));
    process.exitCode = 1;
    return;
  }

  const payloads = rows.map(normalize);
  console.log(`[import-cua-hang] file=${DATA_FILE}`);
  console.log(`[import-cua-hang] total=${payloads.length} dry_run=${DRY_RUN}`);

  if (DRY_RUN) {
    payloads.forEach((item) => console.log(`[dry-run] ${item.ma_cua_hang} | ${item.ten_cua_hang}`));
    return;
  }

  const { connectDB } = require('../models/db.model');
  const { CuaHang } = require('../models/kiot.model');
  await connectDB();

  let inserted = 0;
  let updated = 0;
  const failed = [];

  for (const payload of payloads) {
    try {
      const result = await CuaHang.updateOne(
        { ma_cua_hang: payload.ma_cua_hang },
        { $set: payload },
        { upsert: true, runValidators: true }
      );
      if (result.upsertedCount > 0) inserted += 1;
      else if (result.matchedCount > 0) updated += 1;
    } catch (error) {
      failed.push(`${payload.ma_cua_hang}: ${error.message}`);
    }
  }

  console.log('[import-cua-hang] Summary');
  console.log(`- total: ${payloads.length}`);
  console.log(`- inserted: ${inserted}`);
  console.log(`- updated: ${updated}`);
  console.log(`- failed: ${failed.length}`);
  failed.forEach((error) => console.error('- ' + error));
  if (failed.length) process.exitCode = 1;

  const importedStores = await CuaHang.find({
    ma_cua_hang: { $in: payloads.map((item) => item.ma_cua_hang) }
  })
    .select('_id ma_cua_hang ten_cua_hang tinh_thanh trang_thai')
    .sort({ ma_cua_hang: 1 })
    .lean();

  console.log('[import-cua-hang] Imported store ids');
  console.table(importedStores.map((store) => ({
    _id: String(store._id),
    ma_cua_hang: store.ma_cua_hang,
    ten_cua_hang: store.ten_cua_hang,
    tinh_thanh: store.tinh_thanh,
    trang_thai: store.trang_thai
  })));
}

main()
  .catch((error) => {
    console.error('[import-cua-hang] ERROR:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close().catch(() => {});
    }
  });
