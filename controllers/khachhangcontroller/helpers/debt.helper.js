var mongoose = require('mongoose');
var { SoQuy, HoaDonBanHang, PhieuThuChi } = require('../../../models/kiot.model');
var { parseMoney } = require('../../../services/soQuy.service');

function readNestedPayment(body) {
  body = body || {};
  if (body.chi_tiet_thanh_toan && typeof body.chi_tiet_thanh_toan === 'object') return body.chi_tiet_thanh_toan;
  return {};
}

function readPaymentValue(body, key) {
  var nested = readNestedPayment(body);
  if (nested[key] !== undefined) return nested[key];
  var bracketKey = 'chi_tiet_thanh_toan[' + key + ']';
  if (body && body[bracketKey] !== undefined) return body[bracketKey];
  return body ? body[key] : undefined;
}

function hasPaymentBookId(body, key) {
  return String(readPaymentValue(body, key) || '').trim() !== '';
}

function paymentIsV2(body) {
  var flag = body && body.payment_v2;
  return flag === true
    || flag === 'true'
    || flag === '1'
    || hasPaymentBookId(body, 'so_quy_tien_mat_id')
    || hasPaymentBookId(body, 'so_quy_chuyen_khoan_id');
}

function normalizeCustomerPaymentInput(body) {
  body = body || {};
  var isV2 = paymentIsV2(body);
  var tienMat = parseMoney(readPaymentValue(body, 'tien_mat'));
  var chuyenKhoan = parseMoney(readPaymentValue(body, 'chuyen_khoan'));
  var tienTraKhach = parseMoney(readPaymentValue(body, 'tien_tra_khach'));
  var amount = tienMat + chuyenKhoan;
  if (!isV2 && amount <= 0) {
    amount = parseMoney(body.gia_tri);
    tienMat = amount;
    chuyenKhoan = 0;
  }
  if (isV2 && tienTraKhach > 0) {
    throw new Error('Tiền trả khách không áp dụng cho thanh toán công nợ khách hàng.');
  }
  return {
    isV2: isV2,
    amount: amount,
    tien_mat: tienMat,
    chuyen_khoan: chuyenKhoan,
    tien_tra_khach: 0,
    so_quy_tien_mat_id: String(readPaymentValue(body, 'so_quy_tien_mat_id') || '').trim(),
    so_quy_chuyen_khoan_id: String(readPaymentValue(body, 'so_quy_chuyen_khoan_id') || '').trim()
  };
}

function isActiveInvoice(invoice) {
  if (!invoice) return false;
  var status = String(invoice.trang_thai || '').trim();
  if (status === 'cancelled' || status === 'merged') return false;
  var dataStatus = String(invoice.trang_thai_du_lieu || 'active').trim();
  return dataStatus === 'active' || dataStatus === '';
}

async function loadCustomerUnpaidInvoices(customerId, storeId) {
  if (!customerId || !mongoose.Types.ObjectId.isValid(String(customerId))) return [];
  var query = {
    khach_hang_id: customerId,
    trang_thai: { $nin: ['cancelled', 'merged'] },
    $or: [
      { trang_thai_du_lieu: 'active' },
      { trang_thai_du_lieu: { $exists: false } },
      { trang_thai_du_lieu: null },
      { trang_thai_du_lieu: '' }
    ]
  };
  if (storeId && mongoose.Types.ObjectId.isValid(String(storeId))) {
    query.cua_hang_id = storeId;
  }

  var invoices = await HoaDonBanHang.find(query)
    .sort({ ngay_ban: 1, created_at: 1 })
    .select('ma_hoa_don ngay_ban thanh_toan tong_tien trang_thai trang_thai_du_lieu')
    .lean();
  if (!invoices.length) return [];

  var ids = invoices.map(function(row) { return row._id; });
  var receipts = await PhieuThuChi.find({
    loai_phieu: 'thu',
    trang_thai: { $ne: 'cancelled' },
    $and: [
      {
        $or: [
          { trang_thai_du_lieu: 'active' },
          { trang_thai_du_lieu: { $exists: false } },
          { trang_thai_du_lieu: null },
          { trang_thai_du_lieu: '' }
        ]
      },
      {
        $or: [
          { hoa_don_id: { $in: ids } },
          { 'allocations.hoa_don_id': { $in: ids } }
        ]
      }
    ]
  }).select('hoa_don_id gia_tri allocations').lean();

  var paidMap = {};
  receipts.forEach(function(row) {
    var allocs = Array.isArray(row.allocations) ? row.allocations : [];
    var invoiceAllocs = allocs.filter(function(alloc) {
      return alloc && alloc.hoa_don_id;
    });
    if (invoiceAllocs.length) {
      invoiceAllocs.forEach(function(alloc) {
        var key = String(alloc.hoa_don_id || '');
        if (!key) return;
        paidMap[key] = (paidMap[key] || 0) + Math.max(0, Number(alloc.so_tien || 0));
      });
      return;
    }
    var headerKey = String(row.hoa_don_id || '');
    if (!headerKey) return;
    paidMap[headerKey] = (paidMap[headerKey] || 0) + Math.max(0, Number(row.gia_tri || 0));
  });

  return invoices.map(function(invoice) {
    if (!isActiveInvoice(invoice)) return null;
    var payable = Math.max(0, Number(invoice.thanh_toan != null ? invoice.thanh_toan : invoice.tong_tien || 0));
    var paid = Math.max(0, Number(paidMap[String(invoice._id)] || 0));
    var conNo = Math.max(0, payable - paid);
    if (conNo <= 0) return null;
    return {
      _id: invoice._id,
      doc_id: invoice._id,
      doc_type: 'hoa_don',
      ma_chung_tu: invoice.ma_hoa_don || '',
      ma_hoa_don: invoice.ma_hoa_don || '',
      ngay_chung_tu: invoice.ngay_ban || invoice.created_at,
      gia_tri_phai_tra: payable,
      da_thanh_toan: paid,
      con_no: conNo
    };
  }).filter(Boolean);
}

function sumInvoiceDebt(rows) {
  return (Array.isArray(rows) ? rows : []).reduce(function(sum, row) {
    return sum + Math.max(0, Number(row.con_no || 0));
  }, 0);
}

async function loadActiveCashBooks() {
  return SoQuy.find({ trang_thai: 'active' }).sort({ ten_so_quy: 1 }).lean();
}

module.exports = {
  normalizeCustomerPaymentInput,
  loadCustomerUnpaidInvoices,
  sumInvoiceDebt,
  loadActiveCashBooks
};
