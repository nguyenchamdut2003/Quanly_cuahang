var mongoose = require('mongoose');
var path = require('path');
var { PhieuNhap, CTPhieuNhap, NhaCungCap, Kho, CuaHang, HangHoa, TonKho, TonKhoLo, LoHang, LichSuKho, CongNoNhaCungCap, NhomHang, DonViTinh, SoQuy, DiaChiNcc } = require('../models/kiot.model');
var { taoPhieuThuChi, ensureDefaultSoQuy } = require('../services/soQuy.service');
var purchaseService = require('../services/purchase.service');
var pdfService = require('../services/pdf.service');

function normalizeNhapHangFilter(query) {
  query = query || {};
  var statuses = Array.isArray(query.trang_thai) ? query.trang_thai : (query.trang_thai ? [query.trang_thai] : []);
  statuses = statuses.map(function(x) { return String(x || '').trim(); }).filter(Boolean);
  statuses = statuses.filter(function(x) { return ['draft', 'completed', 'cancelled'].indexOf(x) >= 0; });
  var timeType = String(query.time_type || '').trim();
  if (['this_month', 'custom'].indexOf(timeType) < 0) timeType = '';
  return {
    q: String(query.q || '').trim(),
    statuses: statuses,
    time_type: timeType,
    date_from: String(query.date_from || '').trim(),
    date_to: String(query.date_to || '').trim(),
    nguoi_tao: String(query.nguoi_tao || '').trim(),
    nha_cung_cap: String(query.nha_cung_cap || '').trim()
  };
}

function toStartOfMonth() {
  var now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
}

function toEndOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

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

function statusLabel(value) {
  if (value === 'draft') return 'Phi\u1ebfu t\u1ea1m';
  if (value === 'cancelled') return '\u0110\u00e3 h\u1ee7y';
  return '\u0110\u00e3 nh\u1eadp h\u00e0ng';
}

function paymentMethodLabel(value) {
  if (value === 'tien_mat') return 'Ti\u1ec1n m\u1eb7t';
  if (value === 'chuyen_khoan') return 'Chuy\u1ec3n kho\u1ea3n';
  return 'C\u00f4ng n\u1ee3';
}

async function makePhieuNhapCode() {
  var last = await PhieuNhap.findOne({ ma_phieu_nhap: /^PN\d+$/ }).sort({ ma_phieu_nhap: -1 }).lean();
  var nextNumber = 1;
  if (last && last.ma_phieu_nhap) {
    nextNumber = Number(String(last.ma_phieu_nhap).replace(/\D/g, '')) + 1;
  }
  return 'PN' + String(nextNumber).padStart(6, '0');
}

async function makeSupplierCode() {
  var last = await NhaCungCap.findOne({ ma_ncc: /^NCC\d+$/ }).sort({ ma_ncc: -1 }).lean();
  var nextNumber = 1;
  if (last && last.ma_ncc) {
    nextNumber = Number(String(last.ma_ncc).replace(/\D/g, '')) + 1;
  }
  return 'NCC' + String(nextNumber).padStart(4, '0');
}

async function makeProductCode() {
  var last = await HangHoa.findOne({ ma_hang: /^HH\d+$/ }).sort({ ma_hang: -1 }).lean();
  var nextNumber = 1;
  if (last && last.ma_hang) {
    nextNumber = Number(String(last.ma_hang).replace(/\D/g, '')) + 1;
  }
  return 'HH' + String(nextNumber).padStart(6, '0');
}

async function makeLoCode() {
  var last = await LoHang.findOne({ ma_lo: /^LO\d+$/ }).sort({ ma_lo: -1 }).lean();
  var nextNumber = 1;
  if (last && last.ma_lo) {
    nextNumber = Number(String(last.ma_lo).replace(/\D/g, '')) + 1;
  }
  return 'LO' + String(nextNumber).padStart(6, '0');
}

async function resolveStoreId(req) {
  var sessionStoreId = req && req.session ? String(req.session.cua_hang_id || '').trim() : '';
  if (sessionStoreId && mongoose.Types.ObjectId.isValid(sessionStoreId)) return sessionStoreId;
  var userStoreId = req && req.user ? String(req.user.cua_hang_id || '').trim() : '';
  if (userStoreId && mongoose.Types.ObjectId.isValid(userStoreId)) return userStoreId;
  var activeStore = await CuaHang.findOne({ trang_thai: 'active' }).sort({ created_at: 1 }).lean();
  return activeStore ? String(activeStore._id) : '';
}

async function seedNhapHangIfEmpty(storeId, userId) {
  if (!storeId || !mongoose.Types.ObjectId.isValid(storeId)) return;
  var existing = await PhieuNhap.countDocuments({ cua_hang_id: storeId });
  if (existing > 0) return;

  var firstWarehouse = await Kho.findOne({ cua_hang_id: storeId }).lean();
  if (!firstWarehouse) {
    var suffix = String(Date.now()).slice(-5);
    firstWarehouse = await Kho.create({
      cua_hang_id: storeId,
      ma_kho: 'KHO' + suffix,
      ten_kho: 'Kho tổng'
    });
  }

  var supplier = await NhaCungCap.findOne({ cua_hang_id: storeId, ten_ncc: /hoang gia/i }).lean();
  if (!supplier) {
    var supplierCode = await makeSupplierCode();
    supplier = await NhaCungCap.create({
      cua_hang_id: storeId,
      ma_ncc: supplierCode,
      ten_ncc: 'Công ty Hoàng Gia',
      trang_thai: 'active'
    });
  }

  var product = await HangHoa.findOne({ cua_hang_id: storeId, ten_hang: 'Áo thun nam' }).lean();
  if (!product) {
    var productCode = await makeProductCode();
    product = await HangHoa.create({
      cua_hang_id: storeId,
      nha_cung_cap_id: supplier._id,
      ma_hang: productCode,
      ten_hang: 'Áo thun nam',
      gia_von: 100000,
      gia_ban: 150000,
      loai_hang: 'hang_hoa',
      trang_thai: 'active',
      quan_ly_theo_lo: false
    });
  }

  var code = await makePhieuNhapCode();
  var soLuong = 50;
  var donGia = 100000;
  var tongTien = soLuong * donGia;

  var purchase = await PhieuNhap.create({
    cua_hang_id: storeId,
    kho_id: firstWarehouse._id,
    nha_cung_cap_id: supplier._id,
    nguoi_tao_id: userId || null,
    ma_phieu_nhap: code,
    ngay_nhap: new Date(),
    tong_tien_hang: tongTien,
    giam_gia: 0,
    kieu_giam_gia: 'vnd',
    tong_tien: tongTien,
    can_tra_ncc: tongTien,
    da_tra_ncc: tongTien, // Đã thanh toán đủ
    con_no_ncc: 0,
    phuong_thuc_thanh_toan: 'tien_mat',
    trang_thai: 'completed',
    ghi_chu: 'Nhập hàng mẫu tự động'
  });

  await CTPhieuNhap.create({
    phieu_nhap_id: purchase._id,
    hang_hoa_id: product._id,
    so_luong: soLuong,
    don_gia_nhap: donGia,
    giam_gia: 0,
    kieu_giam_gia: 'vnd',
    thanh_tien: tongTien
  });

  if (mongoose.models.PhieuThuChi) {
    await mongoose.models.PhieuThuChi.create({
      cua_hang_id: storeId,
      phieu_nhap_id: purchase._id,
      doi_tuong_id: supplier._id,
      nguoi_tao_id: userId || null,
      loai_phieu: 'chi',
      loai_thu_chi: 'tra_tien_ncc',
      ma_phieu: 'PC' + code,
      so_tien: tongTien,
      phuong_thuc: 'tien_mat',
      ngay_thu_chi: new Date(),
      trang_thai: 'completed'
    });
  }

  await TonKho.updateOne(
    { kho_id: firstWarehouse._id, hang_hoa_id: product._id },
    { 
      $inc: { so_luong: soLuong }, 
      $setOnInsert: { cua_hang_id: storeId } 
    },
    { upsert: true }
  );

  await LichSuKho.create({
    cua_hang_id: storeId,
    kho_id: firstWarehouse._id,
    hang_hoa_id: product._id,
    loai_phieu: 'nhap_hang',
    ma_phieu: code,
    so_luong_thay_doi: soLuong,
    ton_kho_sau: soLuong,
    ghi_chu: 'Nhập hàng',
    ngay: new Date()
  });
}

exports.index = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    var filter = normalizeNhapHangFilter(req.query);
    var query = {};
    if (storeId && mongoose.Types.ObjectId.isValid(storeId)) query.cua_hang_id = storeId;
    if (filter.q) query.ma_phieu_nhap = { $regex: filter.q, $options: 'i' };
    if (filter.statuses && filter.statuses.length > 0) query.trang_thai = { $in: filter.statuses };

    var timeRange = null;
    if (filter.time_type === 'this_month') {
      timeRange = { $gte: toStartOfMonth(), $lte: toEndOfDay(new Date()) };
    } else if (filter.time_type === 'custom' || filter.date_from || filter.date_to) {
      var from = filter.date_from ? new Date(filter.date_from + 'T00:00:00') : null;
      var to = filter.date_to ? new Date(filter.date_to + 'T00:00:00') : null;
      if (from || to) {
        timeRange = {};
        if (from && !isNaN(from.getTime())) timeRange.$gte = from;
        if (to && !isNaN(to.getTime())) timeRange.$lte = toEndOfDay(to);
      }
    }
    if (timeRange && (timeRange.$gte || timeRange.$lte)) query.ngay_nhap = timeRange;

    var importSlips = await PhieuNhap.find(query)
      .populate({ path: 'nha_cung_cap_id', select: 'ma_ncc ten_ncc' })
      .populate({ path: 'nguoi_tao_id', select: 'ho_ten email' })
      .populate({ path: 'kho_id', select: 'ten_kho ma_kho' })
      .sort({ ngay_nhap: -1, created_at: -1 })
      .lean();

    if (filter.nguoi_tao) {
      var creatorNeedle = filter.nguoi_tao.toLowerCase();
      importSlips = importSlips.filter(function(item) {
        var creatorName = String(item?.nguoi_tao_id?.ho_ten || '').toLowerCase();
        var creatorEmail = String(item?.nguoi_tao_id?.email || '').toLowerCase();
        return creatorName.indexOf(creatorNeedle) >= 0 || creatorEmail.indexOf(creatorNeedle) >= 0;
      });
    }

    if (filter.nha_cung_cap) {
      var supplierNeedle = filter.nha_cung_cap.toLowerCase();
      importSlips = importSlips.filter(function(item) {
        var supplierCode = String(item?.nha_cung_cap_id?.ma_ncc || '').toLowerCase();
        var supplierName = String(item?.nha_cung_cap_id?.ten_ncc || '').toLowerCase();
        return supplierName.indexOf(supplierNeedle) >= 0 || supplierCode.indexOf(supplierNeedle) >= 0;
      });
    }

    var slipIds = importSlips.map(function(s) { return s._id; });
    var detailRows = [];
    if (slipIds.length > 0) {
      detailRows = await CTPhieuNhap.find({ phieu_nhap_id: { $in: slipIds } })
        .populate({ path: 'hang_hoa_id', select: 'ma_hang ten_hang quan_ly_theo_lo' })
        .populate({ path: 'don_vi_tinh_id', select: 'ten_don_vi' })
        .populate({ path: 'lo_hang_id', select: 'ma_lo ten_lo han_su_dung so_luong_ban_dau so_luong_con_lai' })
        .sort({ created_at: 1 })
        .lean();
    }
    var detailsBySlip = detailRows.reduce(function(map, row) {
      var key = String(row.phieu_nhap_id);
      if (!map[key]) map[key] = [];
      map[key].push(row);
      return map;
    }, {});

    var thuChiBySlip = {};
    if (mongoose.models.PhieuThuChi && slipIds.length > 0) {
      var thuChiRows = await mongoose.models.PhieuThuChi.find({ phieu_nhap_id: { $in: slipIds } })
        .populate({ path: 'nguoi_tao_id', select: 'ho_ten email' })
        .sort({ ngay_thu_chi: -1, created_at: -1 })
        .lean();
      thuChiBySlip = thuChiRows.reduce(function(map, row) {
        var key = String(row.phieu_nhap_id);
        if (!map[key]) map[key] = [];
        map[key].push(row);
        return map;
      }, {});
    }

    importSlips = importSlips.map(function(slip) {
      var key = String(slip._id);
      var rows = detailsBySlip[key] || [];
      var paymentRows = (thuChiBySlip[key] || []).map(function(x) {
        return {
          ma_phieu: x.ma_phieu || x.ma_thu_chi || '--',
          thoi_gian: x.ngay_thu_chi || x.created_at,
          nguoi_tao: x?.nguoi_tao_id?.ho_ten || x?.nguoi_tao_id?.email || '--',
          phuong_thuc: paymentMethodLabel(x.phuong_thuc_thanh_toan || x.phuong_thuc || slip.phuong_thuc_thanh_toan),
          trang_thai: 'Đã thanh toán',
          tien_chi: Number(x.so_tien || x.gia_tri || 0)
        };
      });
      if (paymentRows.length === 0 && Number(slip.da_tra_ncc || 0) > 0) {
        paymentRows.push({
          ma_phieu: 'TT' + String(slip.ma_phieu_nhap || ''),
          thoi_gian: slip.ngay_nhap || slip.created_at,
          nguoi_tao: slip?.nguoi_tao_id?.ho_ten || slip?.nguoi_tao_id?.email || '--',
          phuong_thuc: paymentMethodLabel(slip.phuong_thuc_thanh_toan),
          trang_thai: 'Đã thanh toán',
          tien_chi: Number(slip.da_tra_ncc || 0)
        });
      }
      var tongMatHang = rows.length;
      var tongSoLuong = rows.reduce(function(sum, r) { return sum + Number(r.so_luong || 0); }, 0);
      return Object.assign({}, slip, {
        detail_rows: rows,
        payment_rows: paymentRows,
        detail_summary: {
          tong_mat_hang: tongMatHang,
          tong_so_luong: tongSoLuong
        }
      });
    });

    var suppliers = await NhaCungCap.find(
      storeId && mongoose.Types.ObjectId.isValid(storeId) ? { cua_hang_id: storeId } : {}
    )
      .sort({ ten_ncc: 1 })
      .lean();
    if (suppliers.length === 0 && storeId && mongoose.Types.ObjectId.isValid(storeId)) {
      suppliers = await NhaCungCap.find({})
        .sort({ ten_ncc: 1 })
        .lean();
    }

    res.render('nhap-hang/index', {
      title: 'Nhập hàng',
      pageTitle: 'Nhập hàng',
      activeMenu: 'mua-hang',
      user: req.user,
      flash: req.query || {},
      filter: filter,
      suppliers: suppliers,
      importSlips: importSlips,
      formatDate: formatDate,
      statusLabel: statusLabel,
      paymentMethodLabel: paymentMethodLabel
    });
  } catch (error) {
    next(error);
  }
};

function normalizeItemsPayload(raw) {
  if (!raw) return [];
  var parsed = null;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      parsed = null;
    }
  } else {
    parsed = raw;
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map(function(x) {
      var lineDiscountType = String(x?.kieu_giam_gia_dong || 'vnd').trim();
      if (['vnd', 'percent'].indexOf(lineDiscountType) < 0) lineDiscountType = 'vnd';
      return {
        hang_hoa_id: String(x?.hang_hoa_id || '').trim(),
        so_luong: Number(x?.so_luong || 0),
        don_gia: Number(x?.don_gia || 0),
        giam_gia_dong: Number(x?.giam_gia_dong != null ? x?.giam_gia_dong : x?.giam_gia || 0),
        kieu_giam_gia_dong: lineDiscountType,
        lo_info: x?.lo_info && typeof x.lo_info === 'object'
          ? {
            ma_lo: String(x.lo_info.ma_lo || '').trim(),
            ten_lo: String(x.lo_info.ten_lo || '').trim(),
            ngay_nhap: String(x.lo_info.ngay_nhap || '').trim(),
            ngay_thu_hoach: String(x.lo_info.ngay_thu_hoach || '').trim(),
            han_su_dung: String(x.lo_info.han_su_dung || '').trim(),
            so_luong_lo: Number(x.lo_info.so_luong_lo || 0),
            ghi_chu: String(x.lo_info.ghi_chu || '').trim()
          }
          : null
      };
    })
    .filter(function(x) {
      return mongoose.Types.ObjectId.isValid(x.hang_hoa_id)
        && Number.isFinite(x.so_luong)
        && x.so_luong > 0
        && Number.isFinite(x.don_gia)
        && x.don_gia >= 0;
    })
    .map(function(x) {
      x.so_luong = Math.floor(x.so_luong);
      if (!Number.isFinite(x.don_gia) || x.don_gia < 0) x.don_gia = 0;
      if (!Number.isFinite(x.giam_gia_dong) || x.giam_gia_dong < 0) x.giam_gia_dong = 0;
      if (x.kieu_giam_gia_dong === 'percent' && x.giam_gia_dong > 100) x.giam_gia_dong = 100;
      if (x.lo_info) {
        if (!Number.isFinite(x.lo_info.so_luong_lo) || x.lo_info.so_luong_lo < 0) x.lo_info.so_luong_lo = 0;
        x.lo_info.so_luong_lo = Math.floor(x.lo_info.so_luong_lo);
      }
      return x;
    });
}

function parseDateOnly(value) {
  var raw = String(value || '').trim();
  if (!raw) return undefined;
  var d = new Date(raw);
  if (Number.isNaN(d.getTime())) return undefined;
  return d;
}

function calcLineTotal(item) {
  var soLuong = Number(item?.so_luong || 0);
  var donGia = Number(item?.don_gia || 0);
  var base = soLuong * donGia;
  if (!Number.isFinite(base) || base <= 0) return 0;
  var discountValue = Number(item?.giam_gia_dong || 0);
  if (!Number.isFinite(discountValue) || discountValue < 0) discountValue = 0;
  var discountType = String(item?.kieu_giam_gia_dong || 'vnd');
  var discountAmount = discountType === 'percent' ? (base * Math.min(discountValue, 100) / 100) : discountValue;
  return Math.max(0, Math.floor(base - discountAmount));
}

function computeTotals(items, giamGiaPhieu, kieuGiamGiaPhieu) {
  var tongTienHang = items.reduce(function(sum, it) {
    var line = calcLineTotal(it);
    return sum + (Number.isFinite(line) ? line : 0);
  }, 0);
  tongTienHang = Math.max(0, Math.floor(tongTienHang));
  var giam = Number(giamGiaPhieu || 0);
  if (!Number.isFinite(giam) || giam < 0) giam = 0;
  var discountType = ['vnd', 'percent'].indexOf(String(kieuGiamGiaPhieu || '').trim()) >= 0 ? String(kieuGiamGiaPhieu).trim() : 'vnd';
  if (discountType === 'percent' && giam > 100) giam = 100;
  giam = Math.floor(giam);
  var giamTheoTien = discountType === 'percent'
    ? Math.floor((tongTienHang * giam) / 100)
    : giam;
  var tongTien = Math.max(0, tongTienHang - giamTheoTien);
  return { tongTienHang: tongTienHang, giamGia: giam, tongTien: tongTien };
}

function parseMoneyInput(raw) {
  if (raw == null) return 0;
  var normalized = String(raw).replace(/\./g, '').replace(/,/g, '').trim();
  var n = Number(normalized);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

async function loadPurchaseWithItems(id, storeId) {
  if (!mongoose.Types.ObjectId.isValid(String(id || ''))) return null;
  var filter = { _id: id };
  if (storeId && mongoose.Types.ObjectId.isValid(storeId)) filter.cua_hang_id = storeId;
  var ticket = await PhieuNhap.findOne(filter)
    .populate({ path: 'cua_hang_id', select: 'ten_cua_hang ma_cua_hang dia_chi dia_chi_gui_hang sdt email' })
    .populate({ path: 'nha_cung_cap_id', select: 'ma_ncc ten_ncc ten_cong_ty ma_so_thue sdt email ghi_chu tong_no tong_mua' })
    .populate({ path: 'nguoi_tao_id', select: 'ho_ten email' })
    .populate({ path: 'kho_id', select: 'ten_kho ma_kho' });
  if (!ticket) return null;
  var items = await CTPhieuNhap.find({ phieu_nhap_id: ticket._id })
    .populate({ path: 'hang_hoa_id', select: 'ma_hang ten_hang quan_ly_theo_lo' })
    .populate({ path: 'don_vi_tinh_id', select: 'ten_don_vi ma_don_vi' })
    .populate({ path: 'lo_hang_id', select: 'ma_lo ten_lo han_su_dung so_luong_con_lai' })
    .sort({ created_at: 1 });
  return { ticket: ticket, items: items };
}

async function assertCanRollbackPurchase(ticket, items) {
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    var qty = Number(item.so_luong || 0);
    if (qty <= 0) continue;
    var productId = item.hang_hoa_id?._id || item.hang_hoa_id;
    var lotId = item.lo_hang_id?._id || item.lo_hang_id;
    var inventory = await TonKho.findOne({
      kho_id: ticket.kho_id,
      hang_hoa_id: productId
    }).lean();
    if (!inventory || Number(inventory.so_luong || 0) < qty) {
      throw new Error('Tồn kho không đủ để rollback phiếu nhập');
    }
    if (lotId) {
      var lotInventory = await TonKhoLo.findOne({
        kho_id: ticket.kho_id,
        hang_hoa_id: productId,
        lo_hang_id: lotId
      }).lean();
      if (!lotInventory || Number(lotInventory.so_luong || 0) < qty) {
        throw new Error('Tồn kho theo lô không đủ để rollback phiếu nhập');
      }
    }
  }
}

async function rollbackPurchaseStock(ticket, items, userId) {
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    var qty = Number(item.so_luong || 0);
    if (qty <= 0) continue;
    var productId = item.hang_hoa_id?._id || item.hang_hoa_id;
    var lotId = item.lo_hang_id?._id || item.lo_hang_id;
    var updatedInv = await TonKho.findOneAndUpdate(
      { kho_id: ticket.kho_id, hang_hoa_id: productId },
      { $inc: { so_luong: -qty } },
      { new: true }
    ).lean();

    if (lotId) {
      await TonKhoLo.findOneAndUpdate(
        { kho_id: ticket.kho_id, hang_hoa_id: productId, lo_hang_id: lotId },
        { $inc: { so_luong: -qty } },
        { new: true }
      );
      await LoHang.findByIdAndUpdate(lotId, {
        $inc: { so_luong_con_lai: -qty }
      });
    }

    await LichSuKho.create({
      cua_hang_id: ticket.cua_hang_id,
      kho_id: ticket.kho_id,
      hang_hoa_id: productId,
      lo_hang_id: lotId || undefined,
      nguoi_tao_id: userId || undefined,
      loai_phieu: 'dieu_chinh',
      ma_phieu: ticket.ma_phieu_nhap,
      so_luong_thay_doi: -qty,
      ton_kho_sau: Number(updatedInv?.so_luong || 0),
      ghi_chu: 'Hủy phiếu nhập ' + ticket.ma_phieu_nhap,
      ngay: new Date()
    });
  }
}

function csvEscape(value) {
  return '"' + String(value ?? '').replace(/"/g, '""') + '"';
}

exports.createPage = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    var warehouses = await Kho.find(
      storeId && mongoose.Types.ObjectId.isValid(storeId) ? { cua_hang_id: storeId } : {}
    )
      .sort({ ten_kho: 1, ma_kho: 1 })
      .lean();
    if (warehouses.length === 0 && storeId && mongoose.Types.ObjectId.isValid(storeId)) {
      var suffix = String(Date.now()).slice(-5);
      var createdWarehouse = await Kho.create({
        cua_hang_id: storeId,
        ma_kho: 'KHO' + suffix,
        ten_kho: 'Kho tổng'
      });
      warehouses = [createdWarehouse];
    }

    var suppliers = await NhaCungCap.find(
      storeId && mongoose.Types.ObjectId.isValid(storeId) ? { cua_hang_id: storeId } : {}
    )
      .sort({ ten_ncc: 1, ma_ncc: 1 })
      .lean();
    if (suppliers.length === 0 && storeId && mongoose.Types.ObjectId.isValid(storeId)) {
      suppliers = await NhaCungCap.find({})
        .sort({ ten_ncc: 1, ma_ncc: 1 })
        .lean();
    }
    var groups = await NhomHang.find(
      storeId && mongoose.Types.ObjectId.isValid(storeId) ? { cua_hang_id: storeId, trang_thai: 'active' } : { trang_thai: 'active' }
    )
      .sort({ ten_nhom: 1 })
      .lean();
    var units = await DonViTinh.find(
      storeId && mongoose.Types.ObjectId.isValid(storeId) ? { cua_hang_id: storeId, trang_thai: 'active' } : { trang_thai: 'active' }
    )
      .sort({ ten_don_vi: 1 })
      .lean();
    var cashBooks = await SoQuy.find(
      storeId && mongoose.Types.ObjectId.isValid(storeId) ? { cua_hang_id: storeId, trang_thai: 'active' } : { trang_thai: 'active' }
    )
      .sort({ ten_so_quy: 1 })
      .lean();

    var productQuery = storeId && mongoose.Types.ObjectId.isValid(storeId)
      ? { cua_hang_id: storeId, trang_thai: 'active' }
      : { trang_thai: 'active' };
    var products = await HangHoa.find(productQuery)
      .sort({ ten_hang: 1, ma_hang: 1 })
      .select('ma_hang ten_hang gia_nhap_cuoi gia_von don_vi_tinh_id nha_cung_cap_id quan_ly_theo_lo')
      .lean();
    if (products.length === 0 && productQuery.cua_hang_id) {
      // Fallback to global active products when current store has none.
      products = await HangHoa.find({ trang_thai: 'active' })
        .sort({ ten_hang: 1, ma_hang: 1 })
        .select('ma_hang ten_hang gia_nhap_cuoi gia_von don_vi_tinh_id nha_cung_cap_id quan_ly_theo_lo')
        .lean();
    }

    res.render('nhap-hang/create', {
      title: 'Nhập hàng',
      pageTitle: 'Nhập hàng',
      activeMenu: 'mua-hang',
      user: req.user,
      flash: req.query || {},
      suppliers: suppliers,
      warehouses: warehouses,
      products: products,
      groups: groups,
      units: units,
      cashBooks: cashBooks
    });
  } catch (error) {
    next(error);
  }
};

exports.apiSupplierProducts = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    var supplierId = String(req.params.id || '').trim();
    if (!mongoose.Types.ObjectId.isValid(supplierId)) {
      return res.status(400).json({ success: false, message: 'nha_cung_cap_id không hợp lệ' });
    }
    var keyword = String(req.query.keyword || '').trim();
    var query = {
      trang_thai: 'active',
      nha_cung_cap_id: supplierId
    };
    if (storeId && mongoose.Types.ObjectId.isValid(storeId)) query.cua_hang_id = storeId;
    if (keyword) {
      query.$or = [
        { ma_hang: { $regex: keyword, $options: 'i' } },
        { ten_hang: { $regex: keyword, $options: 'i' } }
      ];
    }
    var items = await HangHoa.find(query)
      .populate({ path: 'don_vi_tinh_id', select: 'ten_don_vi' })
      .populate({ path: 'nhom_hang_id', select: 'ten_nhom' })
      .sort({ ten_hang: 1, ma_hang: 1 })
      .select('ma_hang ten_hang don_vi_tinh_id nhom_hang_id gia_nhap_cuoi gia_von trang_thai quan_ly_theo_lo loai_gia gia_co_dinh')
      .lean();
    if (items.length === 0 && query.cua_hang_id) {
      var fallbackQuery = {
        trang_thai: 'active',
        nha_cung_cap_id: supplierId
      };
      if (keyword) {
        fallbackQuery.$or = [
          { ma_hang: { $regex: keyword, $options: 'i' } },
          { ten_hang: { $regex: keyword, $options: 'i' } }
        ];
      }
      items = await HangHoa.find(fallbackQuery)
        .populate({ path: 'don_vi_tinh_id', select: 'ten_don_vi' })
        .populate({ path: 'nhom_hang_id', select: 'ten_nhom' })
        .sort({ ten_hang: 1, ma_hang: 1 })
        .select('ma_hang ten_hang don_vi_tinh_id nhom_hang_id gia_nhap_cuoi gia_von trang_thai quan_ly_theo_lo loai_gia gia_co_dinh')
        .lean();
    }
    if (items.length === 0) {
      var allActiveQuery = { trang_thai: 'active' };
      if (storeId && mongoose.Types.ObjectId.isValid(storeId)) allActiveQuery.cua_hang_id = storeId;
      if (keyword) {
        allActiveQuery.$or = [
          { ma_hang: { $regex: keyword, $options: 'i' } },
          { ten_hang: { $regex: keyword, $options: 'i' } }
        ];
      }
      items = await HangHoa.find(allActiveQuery)
        .populate({ path: 'don_vi_tinh_id', select: 'ten_don_vi' })
        .populate({ path: 'nhom_hang_id', select: 'ten_nhom ten_nhom_hang' })
        .sort({ ten_hang: 1, ma_hang: 1 })
        .select('ma_hang ten_hang don_vi_tinh_id nhom_hang_id nha_cung_cap_id gia_nhap_cuoi gia_von trang_thai quan_ly_theo_lo loai_gia gia_co_dinh')
        .limit(100)
        .lean();
      if (items.length === 0 && allActiveQuery.cua_hang_id) {
        delete allActiveQuery.cua_hang_id;
        items = await HangHoa.find(allActiveQuery)
          .populate({ path: 'don_vi_tinh_id', select: 'ten_don_vi' })
          .populate({ path: 'nhom_hang_id', select: 'ten_nhom ten_nhom_hang' })
          .sort({ ten_hang: 1, ma_hang: 1 })
          .select('ma_hang ten_hang don_vi_tinh_id nhom_hang_id nha_cung_cap_id gia_nhap_cuoi gia_von trang_thai quan_ly_theo_lo loai_gia gia_co_dinh')
          .limit(100)
          .lean();
      }
    }
    return res.json({ success: true, items: items });
  } catch (error) {
    next(error);
  }
};

exports.quickCreateProduct = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    var body = req.body || {};
    var supplierId = String(body.nha_cung_cap_id || '').trim();
    if (!mongoose.Types.ObjectId.isValid(supplierId)) {
      return res.status(400).json({ success: false, message: 'Vui lòng chọn nhà cung cấp trước' });
    }
    var tenHang = String(body.ten_hang || '').trim();
    if (!tenHang) return res.status(400).json({ success: false, message: 'Tên hàng là bắt buộc' });

    var maHang = String(body.ma_hang || '').trim();
    if (!maHang) maHang = await makeProductCode();

    var donViTinhId = String(body.don_vi_tinh_id || '').trim();
    var nhomHangId = String(body.nhom_hang_id || '').trim();
    var loaiGia = String(body.loai_gia || 'thi_truong').trim();
    if (['thi_truong', 'co_dinh'].indexOf(loaiGia) < 0) loaiGia = 'thi_truong';

    var payload = {
      cua_hang_id: storeId || undefined,
      nha_cung_cap_id: supplierId,
      nguoi_tao_id: req.user && req.user._id ? req.user._id : undefined,
      ma_hang: maHang,
      ten_hang: tenHang,
      don_vi_tinh_id: mongoose.Types.ObjectId.isValid(donViTinhId) ? donViTinhId : undefined,
      nhom_hang_id: mongoose.Types.ObjectId.isValid(nhomHangId) ? nhomHangId : undefined,
      gia_von: Math.max(0, Number(body.gia_von || 0)),
      gia_nhap_cuoi: Math.max(0, Number(body.gia_nhap_cuoi || 0)),
      loai_gia: loaiGia,
      gia_co_dinh: Math.max(0, Number(body.gia_co_dinh || 0)),
      quan_ly_theo_lo: Boolean(body.quan_ly_theo_lo),
      trang_thai: 'active'
    };

    var created = await HangHoa.create(payload);
    var item = await HangHoa.findById(created._id)
      .populate({ path: 'don_vi_tinh_id', select: 'ten_don_vi' })
      .populate({ path: 'nhom_hang_id', select: 'ten_nhom' })
      .lean();
    return res.json({ success: true, item: item });
  } catch (error) {
    if (error && error.code === 11000) {
      return res.status(400).json({ success: false, message: 'Mã hàng đã tồn tại' });
    }
    next(error);
  }
};

exports.quickUpdateProduct = async function(req, res, next) {
  try {
    var productId = String(req.params.id || '').trim();
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ success: false, message: 'ID hàng hóa không hợp lệ' });
    }
    var body = req.body || {};
    var update = {
      ten_hang: String(body.ten_hang || '').trim(),
      gia_von: Math.max(0, Number(body.gia_von || 0)),
      gia_nhap_cuoi: Math.max(0, Number(body.gia_nhap_cuoi || 0)),
      loai_gia: ['thi_truong', 'co_dinh'].indexOf(String(body.loai_gia || '')) >= 0 ? String(body.loai_gia) : 'thi_truong',
      gia_co_dinh: Math.max(0, Number(body.gia_co_dinh || 0)),
      quan_ly_theo_lo: Boolean(body.quan_ly_theo_lo),
      trang_thai: ['active', 'inactive'].indexOf(String(body.trang_thai || '')) >= 0 ? String(body.trang_thai) : 'active'
    };
    if (!update.ten_hang) return res.status(400).json({ success: false, message: 'Tên hàng là bắt buộc' });

    var donViTinhId = String(body.don_vi_tinh_id || '').trim();
    var nhomHangId = String(body.nhom_hang_id || '').trim();
    update.don_vi_tinh_id = mongoose.Types.ObjectId.isValid(donViTinhId) ? donViTinhId : undefined;
    update.nhom_hang_id = mongoose.Types.ObjectId.isValid(nhomHangId) ? nhomHangId : undefined;

    await HangHoa.updateOne({ _id: productId }, { $set: update });
    var item = await HangHoa.findById(productId)
      .populate({ path: 'don_vi_tinh_id', select: 'ten_don_vi' })
      .populate({ path: 'nhom_hang_id', select: 'ten_nhom' })
      .lean();
    return res.json({ success: true, item: item });
  } catch (error) {
    next(error);
  }
};

exports.inactiveProduct = async function(req, res, next) {
  try {
    var productId = String(req.params.id || '').trim();
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ success: false, message: 'ID hàng hóa không hợp lệ' });
    }
    await HangHoa.updateOne({ _id: productId }, { $set: { trang_thai: 'inactive' } });
    return res.json({ success: true });
  } catch (error) {
    next(error);
  }
};

exports.apiHangHoa = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    var keyword = String(req.query.keyword || '').trim();
    var supplierId = String(req.query.nha_cung_cap_id || '').trim();
    var hasSupplierFilter = mongoose.Types.ObjectId.isValid(supplierId);

    var query = { trang_thai: 'active' };
    if (storeId && mongoose.Types.ObjectId.isValid(storeId)) {
      query.cua_hang_id = storeId;
    }
    if (keyword) {
      query.$or = [
        { ma_hang: { $regex: keyword, $options: 'i' } },
        { ten_hang: { $regex: keyword, $options: 'i' } }
      ];
    }

    var products = await HangHoa.find(query)
      .populate({ path: 'don_vi_tinh_id', select: 'ten_don_vi' })
      .select('ma_hang ten_hang gia_nhap_cuoi gia_von don_vi_tinh_id nha_cung_cap_id quan_ly_theo_lo')
      .lean();
    if (products.length === 0 && query.cua_hang_id) {
      var fallbackQuery = { trang_thai: 'active' };
      if (keyword) {
        fallbackQuery.$or = [
          { ma_hang: { $regex: keyword, $options: 'i' } },
          { ten_hang: { $regex: keyword, $options: 'i' } }
        ];
      }
      products = await HangHoa.find(fallbackQuery)
        .populate({ path: 'don_vi_tinh_id', select: 'ten_don_vi' })
        .select('ma_hang ten_hang gia_nhap_cuoi gia_von don_vi_tinh_id nha_cung_cap_id quan_ly_theo_lo')
        .lean();
    }

    products.sort(function(a, b) {
      if (!hasSupplierFilter) {
        var aCode = String(a?.ma_hang || '');
        var bCode = String(b?.ma_hang || '');
        return aCode.localeCompare(bCode, 'vi');
      }
      var aPriority = String(a?.nha_cung_cap_id || '') === supplierId ? 0 : 1;
      var bPriority = String(b?.nha_cung_cap_id || '') === supplierId ? 0 : 1;
      if (aPriority !== bPriority) return aPriority - bPriority;
      var aCode2 = String(a?.ma_hang || '');
      var bCode2 = String(b?.ma_hang || '');
      return aCode2.localeCompare(bCode2, 'vi');
    });

    var items = products.slice(0, 100).map(function(p) {
      return {
        _id: p._id,
        ma_hang: p.ma_hang || '',
        ten_hang: p.ten_hang || '',
        don_vi_tinh: p?.don_vi_tinh_id?.ten_don_vi || 'cái',
        gia_nhap_cuoi: Number(p.gia_nhap_cuoi || 0),
        gia_von: Number(p.gia_von || 0),
        nha_cung_cap_id: p.nha_cung_cap_id || null,
        quan_ly_theo_lo: Boolean(p.quan_ly_theo_lo)
      };
    });

    return res.json({ success: true, items: items });
  } catch (error) {
    next(error);
  }
};

exports.apiProductLots = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    var productId = String(req.params.id || '').trim();
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ success: false, message: 'hang_hoa_id khong hop le' });
    }
    var query = { hang_hoa_id: productId, trang_thai: { $ne: 'huy' } };
    if (storeId && mongoose.Types.ObjectId.isValid(storeId)) query.cua_hang_id = storeId;
    if (mongoose.Types.ObjectId.isValid(String(req.query.kho_id || ''))) query.kho_id = String(req.query.kho_id);
    var items = await LoHang.find(query)
      .sort({ han_su_dung: 1, ngay_nhap: -1 })
      .select('ma_lo ten_lo ngay_san_xuat ngay_thu_hoach han_su_dung so_luong_ban_dau so_luong_con_lai don_gia_nhap gia_von trang_thai kho_id')
      .lean();
    return res.json({ success: true, items: items });
  } catch (error) {
    next(error);
  }
};

exports.createSubmit = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId || !mongoose.Types.ObjectId.isValid(storeId)) {
      return res.redirect('/nhap-hang?error=invalid_store');
    }
    await purchaseService.createPurchase(Object.assign({}, req.body || {}, {
      cua_hang_id: storeId,
      nguoi_tao_id: req.user && req.user._id ? req.user._id : undefined
    }));
    return res.redirect('/nhap-hang?success=created');
  } catch (error) {
    return res.redirect('/nhap-hang/create?error=' + encodeURIComponent(error.message || 'create_failed'));
  }
};
exports.detail = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    var loaded = await loadPurchaseWithItems(req.params.id, storeId);
    if (!loaded) return res.status(404).json({ success: false, message: 'Không tìm thấy phiếu nhập' });
    return res.json({
      success: true,
      data: {
        ticket: loaded.ticket.toObject ? loaded.ticket.toObject() : loaded.ticket,
        items: loaded.items.map(function(item) { return item.toObject ? item.toObject() : item; })
      }
    });
  } catch (error) {
    next(error);
  }
};

exports.save = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    var loaded = await loadPurchaseWithItems(req.params.id, storeId);
    if (!loaded) return res.status(404).json({ success: false, message: 'Không tìm thấy phiếu nhập' });
    if (loaded.ticket.trang_thai === 'cancelled') {
      return res.status(400).json({ success: false, message: 'Phiếu đã hủy, không thể lưu' });
    }
    var ghiChu = String(req.body?.ghi_chu || '').trim();
    await PhieuNhap.updateOne({ _id: loaded.ticket._id }, { $set: { ghi_chu: ghiChu } });
    return res.json({ success: true, message: 'Đã lưu thông tin phiếu nhập' });
  } catch (error) {
    next(error);
  }
};

exports.cancel = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    await purchaseService.cancelPurchase(req.params.id, storeId, req.user && req.user._id);
    return res.json({ success: true, message: 'Đã hủy phiếu nhập' });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message || 'Không hủy được phiếu nhập' });
  }
};

exports.copy = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    var loaded = await loadPurchaseWithItems(req.params.id, storeId);
    if (!loaded) return res.status(404).json({ success: false, message: 'Không tìm thấy phiếu nhập' });
    var source = loaded.ticket;
    var maPhieu = await makePhieuNhapCode();
    var copied = await PhieuNhap.create({
      cua_hang_id: source.cua_hang_id,
      kho_id: source.kho_id?._id || source.kho_id,
      nha_cung_cap_id: source.nha_cung_cap_id?._id || source.nha_cung_cap_id || undefined,
      nguoi_tao_id: req.user && req.user._id ? req.user._id : undefined,
      ma_phieu_nhap: maPhieu,
      ngay_nhap: new Date(),
      tong_tien_hang: source.tong_tien_hang || 0,
      giam_gia: source.giam_gia || 0,
      kieu_giam_gia: source.kieu_giam_gia || 'vnd',
      tong_tien: source.tong_tien || 0,
      can_tra_ncc: source.can_tra_ncc || 0,
      da_tra_ncc: 0,
      con_no_ncc: source.can_tra_ncc || source.tong_tien || 0,
      phuong_thuc_thanh_toan: 'cong_no',
      trang_thai: 'draft',
      ghi_chu: 'Sao chép từ ' + source.ma_phieu_nhap
    });

    var rows = loaded.items.map(function(item) {
      return {
        phieu_nhap_id: copied._id,
        hang_hoa_id: item.hang_hoa_id?._id || item.hang_hoa_id,
        don_vi_tinh_id: item.don_vi_tinh_id?._id || item.don_vi_tinh_id || undefined,
        so_luong: Number(item.so_luong || 0),
        don_gia_nhap: Number(item.don_gia_nhap || 0),
        giam_gia_dong: Number(item.giam_gia_dong || 0),
        kieu_giam_gia_dong: item.kieu_giam_gia_dong || 'vnd',
        thanh_tien: Number(item.thanh_tien || 0),
        ghi_chu: item.ghi_chu || ''
      };
    });
    if (rows.length) await CTPhieuNhap.insertMany(rows);
    return res.json({ success: true, message: 'Đã sao chép phiếu nhập', id: copied._id, ma_phieu_nhap: maPhieu });
  } catch (error) {
    next(error);
  }
};

async function buildPurchasePrintData(req, title) {
  var storeId = await resolveStoreId(req);
  var loaded = await loadPurchaseWithItems(req.params.id, storeId);
  if (!loaded) return null;
  var store = loaded.ticket.cua_hang_id || null;
  if (store && store._id) store = store.toObject ? store.toObject() : store;
  if (!store && loaded.ticket.cua_hang_id) store = await CuaHang.findById(loaded.ticket.cua_hang_id).lean();
  var supplierId = loaded.ticket.nha_cung_cap_id && (loaded.ticket.nha_cung_cap_id._id || loaded.ticket.nha_cung_cap_id);
  var supplierAddress = null;
  if (supplierId) {
    supplierAddress = await DiaChiNcc.findOne({ nha_cung_cap_id: supplierId })
      .sort({ mac_dinh: -1, created_at: -1 })
      .lean();
  }
  return {
    title: title,
    activeMenu: 'mua-hang',
    user: req.user,
    store: store,
    supplierAddress: supplierAddress,
    ticket: loaded.ticket,
    items: loaded.items,
    formatDate: formatDate
  };
}

async function renderPurchasePrint(req, res, next, viewName, title) {
  try {
    var data = await buildPurchasePrintData(req, title);
    if (!data) return res.status(404).send('Khong tim thay phieu nhap');
    return res.render(viewName, data);
  } catch (error) {
    next(error);
  }
}

function safePdfName(prefix, ticket) {
  var code = String(ticket && ticket.ma_phieu_nhap ? ticket.ma_phieu_nhap : 'phieu-nhap')
    .replace(/[^\w.-]+/g, '-');
  return prefix + '-' + code + '.pdf';
}

async function renderPurchasePdf(req, res, next, viewName, title, filenamePrefix) {
  try {
    var data = await buildPurchasePrintData(req, title);
    if (!data) return res.status(404).send('Khong tim thay phieu nhap');
    var viewPath = path.join(__dirname, '..', 'views', viewName + '.ejs');
    var html = await pdfService.renderViewToHtml(viewPath, data);
    var buffer = await pdfService.generatePdfFromHtml(html, {
      format: 'A4',
      printBackground: true,
      margin: {
        top: '10mm',
        right: '10mm',
        bottom: '10mm',
        left: '10mm'
      }
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="' + safePdfName(filenamePrefix, data.ticket) + '"');
    return res.send(Buffer.from(buffer));
  } catch (error) {
    next(error);
  }
}

exports.printPurchase = function(req, res, next) {
  return renderPurchasePrint(req, res, next, 'nhap-hang/print-phieu-nhap', 'In phieu nhap hang');
};

exports.printBangKe02Tndn = function(req, res, next) {
  return renderPurchasePrint(req, res, next, 'nhap-hang/bang-ke-02-tndn', 'Bang ke 02/TNDN');
};

exports.printContract = function(req, res, next) {
  return renderPurchasePrint(req, res, next, 'nhap-hang/hd-mua-ban-nguyen-tac', 'HD mua ban nguyen tac');
};

exports.printPhieuNhapPdf = function(req, res, next) {
  return renderPurchasePdf(req, res, next, 'nhap-hang/print-phieu-nhap', 'In phieu nhap hang', 'phieu-nhap');
};

exports.printBangKe02TndnPdf = function(req, res, next) {
  return renderPurchasePdf(req, res, next, 'nhap-hang/bang-ke-02-tndn', 'Bang ke 02/TNDN', 'bang-ke-02-tndn');
};

exports.printHdMuaBanNguyenTacPdf = function(req, res, next) {
  return renderPurchasePdf(req, res, next, 'nhap-hang/hd-mua-ban-nguyen-tac', 'HD mua ban nguyen tac', 'hd-mua-ban-nguyen-tac');
};

exports.exportOneCsv = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    var loaded = await loadPurchaseWithItems(req.params.id, storeId);
    if (!loaded) return res.status(404).send('Không tìm thấy phiếu nhập');
    var ticket = loaded.ticket;
    var rows = [
      ['ma_phieu_nhap', ticket.ma_phieu_nhap || ''],
      ['nha_cung_cap', ticket.nha_cung_cap_id?.ten_ncc || ''],
      ['kho', ticket.kho_id?.ten_kho || ticket.kho_id?.ma_kho || ''],
      ['ngay_nhap', ticket.ngay_nhap ? ticket.ngay_nhap.toISOString() : ''],
      ['tong_tien_hang', ticket.tong_tien_hang || 0],
      ['can_tra_ncc', ticket.can_tra_ncc || ticket.tong_tien || 0],
      ['da_tra_ncc', ticket.da_tra_ncc || 0],
      ['con_no_ncc', ticket.con_no_ncc || 0],
      [],
      ['ma_hang', 'ten_hang', 'so_luong', 'don_gia_nhap', 'giam_gia', 'thanh_tien']
    ];
    loaded.items.forEach(function(item) {
      rows.push([
        item.hang_hoa_id?.ma_hang || '',
        item.hang_hoa_id?.ten_hang || '',
        item.so_luong || 0,
        item.don_gia_nhap || 0,
        item.giam_gia_dong || 0,
        item.thanh_tien || 0
      ]);
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="' + (ticket.ma_phieu_nhap || 'phieu-nhap') + '.csv"');
    return res.send('\uFEFF' + rows.map(function(row) {
      return row.map(csvEscape).join(',');
    }).join('\n'));
  } catch (error) {
    next(error);
  }
};

// Excel export matching the KiotViet-style table
exports.exportOneExcel = async function(req, res, next) {
  try {
    const ExcelJS = require('exceljs');
    const storeId = await resolveStoreId(req);
    const loaded = await loadPurchaseWithItems(req.params.id, storeId);
    if (!loaded) return res.status(404).send('Không tìm thấy phiếu nhập');
    const ticket = loaded.ticket;
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Chi tiết phiếu nhập');

    // Define columns (A–J)
    worksheet.columns = [
      { header: 'Mã hàng', key: 'ma_hang', width: 16 },
      { header: 'Tên hàng', key: 'ten_hang', width: 22 },
      { header: 'Đơn vị tính', key: 'don_vi_tinh', width: 14 },
      { header: 'Đơn giá', key: 'don_gia', width: 14 },
      { header: 'Giảm giá', key: 'giam_gia', width: 12 },
      { header: 'Giảm giá', key: 'giam_gia2', width: 12 },
      { header: 'Số lượng', key: 'so_luong', width: 12 },
      { header: 'Giá nhập', key: 'gia_nhap', width: 14 },
      { header: 'Thành tiền', key: 'thanh_tien', width: 16 },
      { header: 'Giá vốn', key: 'gia_von', width: 14 }
    ];

    // Header row styling – dark blue background, white bold text
    var headerRow = worksheet.getRow(1);
    headerRow.eachCell(function(cell) {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF4472C4' }
      };
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FF305496' } },
        bottom: { style: 'thin', color: { argb: 'FF305496' } },
        left: { style: 'thin', color: { argb: 'FF305496' } },
        right: { style: 'thin', color: { argb: 'FF305496' } }
      };
    });
    headerRow.height = 20;

    // Enable auto-filter on header
    worksheet.autoFilter = { from: 'A1', to: 'J1' };

    // Add data rows
    loaded.items.forEach(function(item) {
      var maHang = item.hang_hoa_id?.ma_hang || '';
      var tenHang = item.hang_hoa_id?.ten_hang || '';
      var donVi = item.don_vi_tinh_id?.ten_don_vi || '';
      var donGia = Number(item.don_gia_nhap || 0);
      var giamGia = Number(item.giam_gia_dong || 0);
      var soLuong = Number(item.so_luong || 0);
      // Giá nhập: from lot if available, otherwise from line don_gia_nhap
      var giaNhap = (item.lo_hang_id && item.lo_hang_id.don_gia_nhap != null)
        ? Number(item.lo_hang_id.don_gia_nhap)
        : donGia;
      var thanhTien = Number(item.thanh_tien || 0);
      // Giá vốn: from lot if available, otherwise from product gia_von
      var giaVon = (item.lo_hang_id && item.lo_hang_id.gia_von != null)
        ? Number(item.lo_hang_id.gia_von)
        : Number(item.hang_hoa_id?.gia_von || 0);

      var row = worksheet.addRow({
        ma_hang: maHang,
        ten_hang: tenHang,
        don_vi_tinh: donVi,
        don_gia: donGia,
        giam_gia: giamGia,
        giam_gia2: giamGia,
        so_luong: soLuong,
        gia_nhap: giaNhap,
        thanh_tien: thanhTien,
        gia_von: giaVon
      });

      // Thin border for data cells
      row.eachCell(function(cell) {
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFD9E2F3' } },
          bottom: { style: 'thin', color: { argb: 'FFD9E2F3' } },
          left: { style: 'thin', color: { argb: 'FFD9E2F3' } },
          right: { style: 'thin', color: { argb: 'FFD9E2F3' } }
        };
      });
    });

    // Number format (1 decimal as shown in screenshot: 0.0, 100.0, 13.0)
    var numericCols = ['don_gia', 'giam_gia', 'giam_gia2', 'so_luong', 'gia_nhap', 'thanh_tien', 'gia_von'];
    numericCols.forEach(function(col) {
      worksheet.getColumn(col).numFmt = '#,##0.0';
    });

    var filename = 'phieu-nhap-' + (ticket.ma_phieu_nhap || 'unknown') + '.xlsx';
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    next(error);
  }
};

exports.traHangNhapPage = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    var returns = await mongoose.models.PhieuTraHangNhap.find(storeId ? { cua_hang_id: storeId } : {})
      .populate('nha_cung_cap_id')
      .populate('phieu_nhap_id')
      .sort({ ngay_tra: -1 })
      .lean();

    var suppliers = await mongoose.models.NhaCungCap.find(storeId ? { cua_hang_id: storeId } : {}).lean();
    var receipts = await mongoose.models.PhieuNhap.find(storeId ? { cua_hang_id: storeId, trang_thai: 'completed' } : { trang_thai: 'completed' }).lean();
    var products = await mongoose.models.HangHoa.find(storeId ? { cua_hang_id: storeId, trang_thai: 'active' } : { trang_thai: 'active' }).lean();

    res.render('nhap-hang/tra-hang-nhap', {
      title: 'Trả hàng nhập',
      activeMenu: 'mua-hang',
      user: req.user,
      returns: returns,
      suppliers: suppliers,
      receipts: receipts,
      products: products
    });
  } catch (error) {
    next(error);
  }
};

exports.traHangNhapSubmit = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    var body = req.body || {};
    var items = body.items || [];

    if (!items || items.length === 0) return res.json({ success: false, message: 'Chưa có hàng hóa cần trả' });

    var last = await mongoose.models.PhieuTraHangNhap.findOne({ ma_phieu_tra_nhap: /^PTH\d+$/ }).sort({ ma_phieu_tra_nhap: -1 }).lean();
    var nextNumber = last ? Number(String(last.ma_phieu_tra_nhap).replace(/\D/g, '')) + 1 : 1;
    var maPhieu = 'PTH' + String(nextNumber).padStart(6, '0');

    var tongTienTra = items.reduce(function(s, i) {
      return s + (Number(i.so_luong || 0) * Number(i.don_gia || 0));
    }, 0);

    var nccId = String(body.nha_cung_cap_id || '').trim();
    if (!mongoose.Types.ObjectId.isValid(nccId)) nccId = undefined;

    var pnId = String(body.phieu_nhap_id || '').trim();
    if (!mongoose.Types.ObjectId.isValid(pnId)) pnId = undefined;

    var pth = await mongoose.models.PhieuTraHangNhap.create({
      cua_hang_id: storeId,
      ma_phieu_tra_nhap: maPhieu,
      nha_cung_cap_id: nccId,
      phieu_nhap_id: pnId,
      tong_tien_tra: tongTienTra,
      ly_do: String(body.ly_do || ''),
      ghi_chu: String(body.ghi_chu || ''),
      nguoi_tao_id: req.user ? req.user._id : undefined
    });

    var ctRows = items.map(function(it) {
      return {
        phieu_tra_nhap_id: pth._id,
        hang_hoa_id: it.hang_hoa_id,
        so_luong: Number(it.so_luong || 0),
        don_gia: Number(it.don_gia || 0),
        thanh_tien: Number(it.so_luong || 0) * Number(it.don_gia || 0)
      };
    });
    await mongoose.models.CtPhieuTraHangNhap.insertMany(ctRows);

    var kho = await mongoose.models.Kho.findOne(storeId ? { cua_hang_id: storeId } : {}).lean();
    if (kho) {
      for (var i = 0; i < ctRows.length; i++) {
        var row = ctRows[i];
        if (row.so_luong > 0) {
          var updatedInv = await mongoose.models.TonKho.findOneAndUpdate(
            { cua_hang_id: storeId, kho_id: kho._id, hang_hoa_id: row.hang_hoa_id },
            { $inc: { so_luong: -row.so_luong } },
            { upsert: true, new: true }
          ).lean();
          await mongoose.models.LichSuKho.create({
            cua_hang_id: storeId,
            kho_id: kho._id,
            hang_hoa_id: row.hang_hoa_id,
            nguoi_tao_id: req.user ? req.user._id : undefined,
            loai_phieu: 'xuat_huy',
            ma_phieu: maPhieu,
            so_luong_thay_doi: -row.so_luong,
            ton_kho_sau: Number(updatedInv?.so_luong || 0),
            ghi_chu: 'Trả hàng nhập'
          });
        }
      }
    }

    res.json({ success: true, pth });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
};

