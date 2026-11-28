const mongoose = require('mongoose');
const {
  TonKhoLoQuyCach
} = require('../models/kiot.model');
const { congTonKho, truTonKho } = require('./kho.service');

function toObjectId(value, fieldName) {
  if (!value) throw new Error(`Thiếu ${fieldName}`);
  if (value instanceof mongoose.Types.ObjectId) return value;
  if (!mongoose.Types.ObjectId.isValid(value)) throw new Error(`${fieldName} không hợp lệ`);
  return new mongoose.Types.ObjectId(value);
}

function normalizeTenQuyCach(value) {
  return String(value || '').trim();
}

function lotStockFilter(khoId, hangHoaId, loHangId) {
  return {
    kho_id: khoId,
    hang_hoa_id: hangHoaId,
    lo_hang_id: loHangId,
    $or: [{ gia_tri_thuoc_tinh_id: null }, { gia_tri_thuoc_tinh_id: { $exists: false } }]
  };
}

async function lotHasQuyCachStock(khoId, hangHoaId, loHangId) {
  const count = await TonKhoLoQuyCach.countDocuments({
    kho_id: khoId,
    hang_hoa_id: hangHoaId,
    lo_hang_id: loHangId,
    so_luong: { $gt: 0 }
  });
  return count > 0;
}

function disposalStockInput(ticket, row, userId, reverse) {
  return {
    kho_id: toObjectId(ticket.kho_id, 'kho_id'),
    hang_hoa_id: toObjectId(row.hang_hoa_id, 'hang_hoa_id'),
    lo_hang_id: row.lo_hang_id || null,
    ten_quy_cach: normalizeTenQuyCach(row.ten_quy_cach) || undefined,
    gia_tri_thuoc_tinh_id: row.gia_tri_thuoc_tinh_id || undefined,
    so_luong: require('../utils/stockQuantity').stockQuantity(row.so_luong, { allowZero: false }),
    gia_von: Number(row.gia_von) || 0,
    nguoi_tao_id: userId,
    loai_phieu: 'xuat_huy', ma_phieu: ticket.ma_xuat_huy,
    ngay: ticket.ngay_xuat || ticket.created_at,
    allow_negative: false,
    allow_expired_lot: true,
    ghi_chu: reverse ? 'Đảo hủy phiếu xuất hủy ' + (ticket.ma_xuat_huy || '')
      : row.ghi_chu || ticket.ly_do_huy || ticket.ghi_chu || 'Xuất hủy'
  };
}

async function applyXuatHuyLine(ticket, row, userId) {
  return truTonKho(disposalStockInput(ticket, row, userId, false));
}

async function reverseXuatHuyLine(ticket, row, userId) {
  return congTonKho(disposalStockInput(ticket, row, userId, true));
}

async function loadQuyCachTonForLot(khoId, hangHoaId, loHangId) {
  const rows = await TonKhoLoQuyCach.find({
    kho_id: khoId,
    hang_hoa_id: hangHoaId,
    lo_hang_id: loHangId,
    so_luong: { $gt: 0 }
  }).sort({ ten_quy_cach: 1 }).lean();

  return rows.map(row => ({
    ten_quy_cach: normalizeTenQuyCach(row.ten_quy_cach || row.ten_thuoc_tinh),
    ton_hien_tai: Number(row.so_luong || 0),
    gia_von: Number(row.gia_von || 0)
  })).filter(row => row.ten_quy_cach && row.ton_hien_tai > 0);
}

module.exports = {
  normalizeTenQuyCach,
  lotHasQuyCachStock,
  loadQuyCachTonForLot,
  applyXuatHuyLine,
  reverseXuatHuyLine,
  lotStockFilter
};
