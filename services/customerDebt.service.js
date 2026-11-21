const mongoose = require('mongoose');
const {
  Counter,
  GiaoDichCongNoKhachHang,
  KhachHang
} = require('../models/kiot.model');

function isObjectId(value) {
  return mongoose.Types.ObjectId.isValid(String(value || '').trim());
}

function optionalId(value) {
  return isObjectId(value) ? value : undefined;
}

function withSession(options, session) {
  return session ? Object.assign({}, options, { session }) : options;
}

async function generateCustomerDebtTransactionCode(session) {
  const counter = await Counter.findOneAndUpdate(
    { _id: 'giao_dich_cong_no_khach_hang' },
    { $inc: { seq: 1 } },
    withSession({ new: true, upsert: true }, session)
  ).lean();
  return 'GDKH' + String(counter.seq).padStart(6, '0');
}

function normalizeAmount(value) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Giá trị giao dịch công nợ khách hàng phải lớn hơn 0');
  }
  return amount;
}

function validateDirection(value) {
  if (value !== 'tang_no' && value !== 'giam_no') {
    throw new Error('Hướng công nợ khách hàng không hợp lệ');
  }
  return value;
}

async function createCustomerDebtTransaction({
  cua_hang_id,
  khach_hang_id,
  loai_giao_dich,
  huong_cong_no,
  gia_tri,
  ngay_giao_dich,
  anh_huong_so_quy,
  don_hang_id,
  hoa_don_id,
  phieu_thu_chi_id,
  phieu_tra_hang_id,
  van_don_id,
  ma_chung_tu_goc,
  ghi_chu,
  nguoi_tao_id,
  session
} = {}) {
  if (!isObjectId(cua_hang_id)) throw new Error('Thiếu cua_hang_id khi ghi công nợ khách hàng');
  if (!isObjectId(khach_hang_id)) throw new Error('Thiếu khach_hang_id khi ghi công nợ khách hàng');

  const amount = normalizeAmount(gia_tri);
  const direction = validateDirection(huong_cong_no);
  const customer = await KhachHang.findById(khach_hang_id)
    .select('tong_no')
    .session(session || null)
    .lean();
  if (!customer) throw new Error('Không tìm thấy khách hàng để ghi công nợ');

  const previousDebt = Math.max(0, Number(customer.tong_no || 0));
  let nextDebt = previousDebt;
  if (direction === 'tang_no') {
    nextDebt = previousDebt + amount;
  } else {
    if (amount > previousDebt) {
      throw new Error('Số tiền giảm nợ lớn hơn nợ hiện tại của khách hàng');
    }
    nextDebt = previousDebt - amount;
  }

  const transactionPayload = {
    cua_hang_id,
    khach_hang_id,
    ma_giao_dich: await generateCustomerDebtTransactionCode(session),
    loai_giao_dich,
    huong_cong_no: direction,
    gia_tri: amount,
    no_truoc: previousDebt,
    no_sau: nextDebt,
    ngay_giao_dich: ngay_giao_dich ? new Date(ngay_giao_dich) : new Date(),
    anh_huong_so_quy: anh_huong_so_quy === true || anh_huong_so_quy === 'true',
    don_hang_id: optionalId(don_hang_id) || null,
    hoa_don_id: optionalId(hoa_don_id) || null,
    phieu_thu_chi_id: optionalId(phieu_thu_chi_id) || null,
    phieu_tra_hang_id: optionalId(phieu_tra_hang_id) || null,
    van_don_id: optionalId(van_don_id) || null,
    ma_chung_tu_goc: String(ma_chung_tu_goc || '').trim(),
    ghi_chu,
    nguoi_tao_id: optionalId(nguoi_tao_id)
  };

  const created = await GiaoDichCongNoKhachHang.create(
    [transactionPayload],
    withSession({}, session)
  );
  await KhachHang.updateOne(
    { _id: khach_hang_id },
    { $set: { tong_no: nextDebt } },
    withSession({}, session)
  );

  return created[0];
}

async function cancelCustomerDebtTransaction({
  giao_dich_id,
  ly_do_huy,
  nguoi_huy_id,
  session
} = {}) {
  if (!isObjectId(giao_dich_id)) throw new Error('giao_dich_id không hợp lệ');

  const transaction = await GiaoDichCongNoKhachHang.findOne({
    _id: giao_dich_id,
    trang_thai: 'active'
  }).session(session || null);
  if (!transaction) throw new Error('Không tìm thấy giao dịch công nợ khách hàng đang hiệu lực');

  const customer = await KhachHang.findById(transaction.khach_hang_id)
    .select('tong_no')
    .session(session || null)
    .lean();
  if (!customer) throw new Error('Không tìm thấy khách hàng để hủy giao dịch công nợ');

  const currentDebt = Math.max(0, Number(customer.tong_no || 0));
  const amount = Math.max(0, Number(transaction.gia_tri || 0));
  const nextDebt = transaction.huong_cong_no === 'tang_no'
    ? Math.max(0, currentDebt - amount)
    : currentDebt + amount;

  transaction.trang_thai = 'cancelled';
  transaction.nguoi_huy_id = optionalId(nguoi_huy_id);
  transaction.ngay_huy = new Date();
  transaction.ly_do_huy = String(ly_do_huy || '').trim();
  await transaction.save(withSession({}, session));

  await KhachHang.updateOne(
    { _id: transaction.khach_hang_id },
    { $set: { tong_no: nextDebt } },
    withSession({}, session)
  );

  return transaction;
}

module.exports = {
  createCustomerDebtTransaction,
  cancelCustomerDebtTransaction
};
