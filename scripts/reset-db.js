require('dotenv').config();

const { mongoose, connectDB } = require('../models/db.model');

const BUSINESS_COLLECTIONS = [
  'cua_hang',
  'doanh_nghiep',
  'kho',
  'khach_hang',
  'dia_chi_khach_hang',
  'loai_dia_chi_khach_hang',
  'nha_cung_cap',
  'dia_chi_ncc',
  'doi_tac_giao_hang',
  'hang_hoa',
  'phieu_nhap',
  'ct_phieu_nhap',
  'lo_hang',
  'ton_kho',
  'ton_kho_lo',
  'ton_kho_lo_quy_cach',
  'don_hang',
  'ct_don_hang',
  'hoa_don_ban_hang',
  'ct_hoa_don_ban_hang',
  'van_don',
  'phieu_thu_chi',
  'so_quy',
  'cong_no_khach_hang'
];

function isLocalMongoUri(uri) {
  return /^mongodb:\/\/(localhost|127\.0\.0\.1)(:|\/)/i.test(String(uri || ''));
}

async function main() {
  const uri = process.env.MONGO_URI || '';
  const env = process.env.NODE_ENV || 'development';
  if (env === 'production' || !isLocalMongoUri(uri)) {
    throw new Error('reset-db chỉ được phép chạy với MongoDB local và NODE_ENV khác production.');
  }
  if (process.env.CONFIRM_RESET_DB !== 'true') {
    throw new Error('Đặt CONFIRM_RESET_DB=true để xác nhận reset dữ liệu nghiệp vụ.');
  }

  await connectDB();
  for (const name of BUSINESS_COLLECTIONS) {
    const exists = await mongoose.connection.db.listCollections({ name }).hasNext();
    if (!exists) continue;
    await mongoose.connection.db.collection(name).drop();
    console.log('Dropped collection:', name);
  }
  await mongoose.disconnect();
}

main().catch(async error => {
  console.error(error.message || error);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
