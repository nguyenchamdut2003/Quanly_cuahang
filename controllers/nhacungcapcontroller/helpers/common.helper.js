var mongoose = require('mongoose');
var querystring = require('querystring');
var ExcelJS = require('exceljs');
var { NhaCungCap, NhomNhaCungCap, PhieuNhap, PhieuTraHangNhap, CongNoNhaCungCap, GiaoDichCongNoNhaCungCap, CuaHang, DiaChiNcc, DiaChiDoiTuong, LoaiDiaChiKhachHang, PhieuXuatNoiBo, CTXuatNoiBo, SoQuy, PhieuThuChi, Counter, NhapVatChua, XuatVatChua } = require('../../../models/kiot.model');
var { taoPhieuThuChi, parseMoney } = require('../../../services/soQuy.service');
var { buildReceiptPaymentInfo } = require('../../../services/paymentCashBook.service');
var { normalizeAddress } = require('../../../utils/address');
var {
    measureAsync,
    measureSync,
    isPerformanceEnabled
} = require('../../../utils/performance.util');
var { buildSupplierHangHoaExportPack } = require('../../../services/supplierHangHoaExport.service');
var { buildSupplierPurchaseInvoiceExportPack } = require('../../../services/supplierPurchaseInvoiceExport.service');
var { handleSupplierDebtExport } = require('../../../services/supplierDebtExport.service');
var nhaCungCapImportService = require('../../../services/nhaCungCapImport.service');
var DiaChiNhaCungCap = DiaChiNcc || DiaChiDoiTuong;
var SUPPLIER_TABLE_METRICS_LIMIT = 100;
var SUPPLIER_DEBT_WARN_DEFAULT_DAYS = 10;

function formatDate(value) {
    if (!value) return '---';
    return new Date(value).toLocaleString('vi-VN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function normalizeSupplierPayload(body) {
    body = body || {};
    return {
        ma_ncc: String(body.ma_ncc || '').trim(),
        ten_ncc: String(body.ten_ncc || '').trim(),
        sdt: String(body.sdt || '').trim(),
        email: String(body.email || '').trim(),
        ten_cong_ty: String(body.ten_cong_ty || '').trim(),
        ma_so_thue: String(body.ma_so_thue || '').trim(),
        ghi_chu: String(body.ghi_chu || '').trim(),
        trang_thai: body.trang_thai === 'inactive' ? 'inactive' : 'active'
    };
}

function getUserName(user) {
    return user ? (user.ho_ten || user.username || user.email || '') : '';
}

function normalizeIdParam(value) {
    return String(value || '').trim();
}

function normalizeIdList(value) {
    var source = Array.isArray(value) ? value : [value];
    return source
        .map(function(item) { return String(item || '').trim(); })
        .filter(Boolean);
}

function shouldRespondJson(req) {
    var accept = String(req?.headers?.accept || '').toLowerCase();
    var requestedWith = String(req?.headers?.['x-requested-with'] || '').toLowerCase();
    return requestedWith === 'xmlhttprequest' || accept.indexOf('application/json') >= 0;
}

async function loadSupplierGroups() {
    return await NhomNhaCungCap.find({}).sort({ ten_nhom_ncc: 1 }).lean();
}

async function makeSupplierGroupCode() {
    var groups = await NhomNhaCungCap.find({ ma_nhom_ncc: /^NNCC\d+$/ }).select('ma_nhom_ncc').lean();
    var maxNumber = 0;
    for (var group of groups) {
        var number = Number(String(group.ma_nhom_ncc || '').replace(/\D/g, ''));
        if (Number.isFinite(number) && number > maxNumber) maxNumber = number;
    }
    return 'NNCC' + String(maxNumber + 1).padStart(4, '0');
}

function respondSupplierGroupError(req, res, statusCode, message) {
    console.error('[SupplierGroup]', message);
    if (shouldRespondJson(req)) {
        return res.status(statusCode || 400).json({ success: false, message: message || 'Không thể xử lý nhóm nhà cung cấp.' });
    }
    return res.redirect('/nha-cung-cap?error=group_error');
}

async function loadAddressTypes() {
    if (!LoaiDiaChiKhachHang) return [];
    return await LoaiDiaChiKhachHang.find({ trang_thai: 'active' }).sort({ created_at: 1 }).lean();
}

function normalizeAddressTypeCode(value) {
    var text = String(value || '').trim().toLowerCase();
    text = text.normalize ? text.normalize('NFD').replace(/[\u0300-\u036f]/g, '') : text;
    text = text.replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    return text || 'loai_dia_chi';
}

async function makeAddressTypeCode(name) {
    var base = normalizeAddressTypeCode(name);
    var code = base;
    var index = 1;
    while (await LoaiDiaChiKhachHang.exists({ ma_loai: code })) {
        index += 1;
        code = base + '_' + index;
    }
    return code;
}

function respondAddressTypeError(req, res, statusCode, message) {
    console.error('[AddressType]', message);
    if (shouldRespondJson(req)) {
        return res.status(statusCode || 400).json({ success: false, message: message || 'Không thể xử lý loại địa chỉ.' });
    }
    return res.redirect('/nha-cung-cap?error=address_type_error');
}

function buildSupplierStoreAccessQuery(storeId) {
    if (!storeId || !mongoose.Types.ObjectId.isValid(storeId)) return {};
    var storeObjectId = new mongoose.Types.ObjectId(String(storeId));
    return {
        $or: [
            { cua_hang_id: storeObjectId },
            { cua_hang_id: null },
            { cua_hang_id: { $exists: false } }
        ]
    };
}

async function resolveStoreId(req) {
    var sessionStoreId = req && req.session ? String(req.session.cua_hang_id || '').trim() : '';
    if (sessionStoreId && mongoose.Types.ObjectId.isValid(sessionStoreId)) return sessionStoreId;
    var userStoreId = req && req.user ? String(req.user.cua_hang_id || '').trim() : '';
    if (userStoreId && mongoose.Types.ObjectId.isValid(userStoreId)) return userStoreId;
    var activeStore = await CuaHang.findOne({ trang_thai: 'active' }).sort({ created_at: 1 }).lean();
    return activeStore ? String(activeStore._id) : '';
}

async function makeSupplierCode() {
    var lastSupplier = await NhaCungCap.findOne({ ma_ncc: /^NCC\d+$/ }).sort({ ma_ncc: -1 }).lean();
    var nextNumber = 1;
    if (lastSupplier && lastSupplier.ma_ncc) {
        nextNumber = Number(lastSupplier.ma_ncc.replace(/\D/g, '')) + 1;
    }
    return 'NCC' + String(nextNumber).padStart(4, '0');
}

function normalizeSupplierAddressPayload(body) {
    body = body || {};
    var address = normalizeAddress(body);
    return {
        ma_dia_chi: String(body.ma_dia_chi || '').trim(),
        ten_nguoi_nhan: String(body.ten_nguoi_nhan || '').trim(),
        sdt_nguoi_nhan: String(body.sdt_nguoi_nhan || '').trim(),
        dia_chi_chi_tiet: address.dia_chi_chi_tiet,
        dia_chi_day_du: address.dia_chi_day_du,
        tinh_thanh: address.tinh_thanh,
        phuong_xa: address.phuong_xa,
        loai_dia_chi: String(body.loai_dia_chi || '').trim(),
        ghi_chu: String(body.ghi_chu || '').trim(),
        mac_dinh: body.mac_dinh === 'true' || body.mac_dinh === true || body.mac_dinh === 'on'
    };
}

module.exports = {
  mongoose,
  querystring,
  ExcelJS,
  NhaCungCap,
  NhomNhaCungCap,
  PhieuNhap,
  PhieuTraHangNhap,
  CongNoNhaCungCap,
  GiaoDichCongNoNhaCungCap,
  CuaHang,
  DiaChiNcc,
  DiaChiDoiTuong,
  LoaiDiaChiKhachHang,
  PhieuXuatNoiBo,
  CTXuatNoiBo,
  SoQuy,
  PhieuThuChi,
  Counter,
  NhapVatChua,
  XuatVatChua,
  DiaChiNhaCungCap,
  SUPPLIER_TABLE_METRICS_LIMIT,
  SUPPLIER_DEBT_WARN_DEFAULT_DAYS,
  taoPhieuThuChi,
  parseMoney,
  buildReceiptPaymentInfo,
  normalizeAddress,
  measureAsync,
  measureSync,
  isPerformanceEnabled,
  buildSupplierHangHoaExportPack,
  buildSupplierPurchaseInvoiceExportPack,
  handleSupplierDebtExport,
  nhaCungCapImportService,
  formatDate,
  normalizeSupplierPayload,
  getUserName,
  normalizeIdParam,
  normalizeIdList,
  shouldRespondJson,
  loadSupplierGroups,
  makeSupplierGroupCode,
  respondSupplierGroupError,
  loadAddressTypes,
  normalizeAddressTypeCode,
  makeAddressTypeCode,
  respondAddressTypeError,
  buildSupplierStoreAccessQuery,
  resolveStoreId,
  makeSupplierCode,
  normalizeSupplierAddressPayload
};
