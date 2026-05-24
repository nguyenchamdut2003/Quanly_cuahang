require('dotenv').config();

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const DATA_FILE = path.join(__dirname, '..', 'seed-data', '02-nguoi-dung.json');
const DRY_RUN = String(process.env.DRY_RUN || '').toLowerCase() === 'true';
const VALID_ROLES = new Set(['admin', 'quan_ly', 'nhan_vien', 'user']);
const VALID_STATUS = new Set(['active', 'inactive', 'blocked']);

function readRows() {
  const raw = fs.readFileSync(DATA_FILE, 'utf8');
  const rows = JSON.parse(raw);
  if (!Array.isArray(rows)) throw new Error('File seed-data/02-nguoi-dung.json phai la mang JSON');
  return rows;
}

function validateRows(rows) {
  const errors = [];
  const seenEmails = new Set();

  rows.forEach((row, index) => {
    const line = index + 1;
    const email = String(row.email || '').trim().toLowerCase();
    const storeCode = String(row.ma_cua_hang || '').trim();
    if (!email) errors.push(`Dong ${line}: thieu email`);
    if (seenEmails.has(email)) errors.push(`Dong ${line}: trung email trong file ${email}`);
    if (email) seenEmails.add(email);
    if (!storeCode) errors.push(`Dong ${line} ${email}: thieu ma_cua_hang`);
    if (row.vai_tro && !VALID_ROLES.has(row.vai_tro)) {
      errors.push(`Dong ${line} ${email}: vai_tro khong hop le ${row.vai_tro}`);
    }
    if (row.trang_thai && !VALID_STATUS.has(row.trang_thai)) {
      errors.push(`Dong ${line} ${email}: trang_thai khong hop le ${row.trang_thai}`);
    }
  });

  return errors;
}

async function main() {
  const rows = readRows();
  const errors = validateRows(rows);
  if (errors.length) {
    console.error('[import-nguoi-dung] Validate failed');
    errors.forEach((error) => console.error('- ' + error));
    process.exitCode = 1;
    return;
  }

  const { connectDB } = require('../models/db.model');
  const { NguoiDung, CuaHang } = require('../models/kiot.model');
  await connectDB();

  let updated = 0;
  let skipped = 0;
  const failed = [];

  console.log(`[import-nguoi-dung] file=${DATA_FILE}`);
  console.log(`[import-nguoi-dung] total=${rows.length} dry_run=${DRY_RUN}`);

  for (const row of rows) {
    const email = String(row.email || '').trim().toLowerCase();
    const storeCode = String(row.ma_cua_hang || '').trim();
    const store = await CuaHang.findOne({ ma_cua_hang: storeCode }).lean();
    const user = await NguoiDung.findOne({ email }).lean();

    if (!store) {
      failed.push(`${email}: khong tim thay cua_hang ma_cua_hang=${storeCode}`);
      continue;
    }
    if (!user) {
      failed.push(`${email}: khong tim thay nguoi_dung hien co, script nay khong tu tao user`);
      continue;
    }

    const payload = {
      cua_hang_id: store._id,
      ho_ten: String(row.ho_ten || user.ho_ten || '').trim(),
      vai_tro: row.vai_tro || user.vai_tro || 'admin',
      trang_thai: row.trang_thai || user.trang_thai || 'active'
    };
    if (row.sdt) payload.sdt = String(row.sdt || '').trim();

    if (DRY_RUN) {
      console.log(`[dry-run] ${email} -> ${store.ma_cua_hang} ${store.ten_cua_hang || ''}`);
      skipped += 1;
      continue;
    }

    try {
      await NguoiDung.updateOne({ _id: user._id }, { $set: payload }, { runValidators: true });
      updated += 1;
      console.log(`[updated] ${email} -> ${store.ma_cua_hang}`);
    } catch (error) {
      failed.push(`${email}: ${error.message}`);
    }
  }

  console.log('[import-nguoi-dung] Summary');
  console.log(`- total: ${rows.length}`);
  console.log(`- updated: ${updated}`);
  console.log(`- skipped: ${skipped}`);
  console.log(`- failed: ${failed.length}`);
  failed.forEach((error) => console.error('- ' + error));
  if (failed.length) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error('[import-nguoi-dung] ERROR:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close().catch(() => {});
    }
  });
