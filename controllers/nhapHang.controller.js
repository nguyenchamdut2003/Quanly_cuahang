var mongoose = require('mongoose');
var { PhieuNhap, CTPhieuNhap, NhaCungCap, Kho, CuaHang, HangHoa, TonKho, TonKhoLo, LoHang, LichSuKho, CongNoNhaCungCap, NhomHang, DonViTinh } = require('../models/kiot.model');

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
  if (value === 'draft') return 'Phiếu tạm';
  if (value === 'cancelled') return 'Đã hủy';
  return 'Đã nhập hàng';
}

function paymentMethodLabel(value) {
  if (value === 'tien_mat') return 'Tiền mặt';
  if (value === 'chuyen_khoan') return 'Chuyển khoản';
  return 'Công nợ';
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
      units: units
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

exports.createSubmit = async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId || !mongoose.Types.ObjectId.isValid(storeId)) {
      return res.redirect('/nhap-hang?error=invalid_store');
    }

    var body = req.body || {};
    var submitMode = body.submitMode === 'completed' ? 'completed' : 'draft';

    var khoId = String(body.kho_id || '').trim();
    if (!khoId || !mongoose.Types.ObjectId.isValid(khoId)) {
      return res.redirect('/nhap-hang/create?error=missing_kho');
    }

    var items = normalizeItemsPayload(body.items_json);
    if (items.length === 0) {
      return res.redirect('/nhap-hang/create?error=empty_items');
    }

    var kieuGiamGiaPhieu = ['vnd', 'percent'].indexOf(String(body.kieu_giam_gia || '').trim()) >= 0 ? String(body.kieu_giam_gia).trim() : 'vnd';
    var giamGiaPhieuRaw = parseMoneyInput(body.giam_gia || 0);
    if (kieuGiamGiaPhieu === 'percent' && giamGiaPhieuRaw > 100) giamGiaPhieuRaw = 100;
    var totals = computeTotals(items, giamGiaPhieuRaw, kieuGiamGiaPhieu);
    var canTraNcc = Math.max(0, totals.tongTienHang - totals.giamGia);
    if (kieuGiamGiaPhieu === 'percent') {
      canTraNcc = totals.tongTien;
    }

    var phuongThuc = String(body.phuong_thuc_thanh_toan || 'cong_no').trim();
    if (['tien_mat', 'chuyen_khoan', 'cong_no'].indexOf(phuongThuc) < 0) phuongThuc = 'cong_no';

    var daTraRaw = parseMoneyInput(body.da_tra_ncc || 0);
    var daTra = daTraRaw > 0 ? daTraRaw : 0;
    if (phuongThuc === 'cong_no') daTra = 0;
    if (daTra > canTraNcc) daTra = canTraNcc;
    var conNoNcc = Math.max(0, canTraNcc - daTra);

    var supplierId = String(body.nha_cung_cap_id || '').trim();
    if (!mongoose.Types.ObjectId.isValid(supplierId)) supplierId = '';

    var ghiChu = String(body.ghi_chu || '').trim();

    var maPhieu = await makePhieuNhapCode();
    var ngayNhap = new Date();

    var phieu = await PhieuNhap.create({
      cua_hang_id: storeId,
      kho_id: khoId,
      nha_cung_cap_id: supplierId || undefined,
      nguoi_tao_id: req.user && req.user._id ? req.user._id : undefined,
      ma_phieu_nhap: maPhieu,
      ngay_nhap: ngayNhap,
      tong_tien_hang: totals.tongTienHang,
      giam_gia: totals.giamGia,
      kieu_giam_gia: kieuGiamGiaPhieu,
      tong_tien: canTraNcc,
      can_tra_ncc: canTraNcc,
      da_tra_ncc: daTra,
      con_no_ncc: conNoNcc,
      phuong_thuc_thanh_toan: phuongThuc,
      trang_thai: submitMode,
      ghi_chu: ghiChu
    });

    var productIds = items.map(function(x) { return x.hang_hoa_id; });
    var productDocs = await HangHoa.find({ _id: { $in: productIds } })
      .select('_id don_vi_tinh_id quan_ly_theo_lo')
      .lean();
    var productMap = productDocs.reduce(function(map, p) {
      map[String(p._id)] = p;
      return map;
    }, {});

    var ctRows = [];
    for (var c = 0; c < items.length; c++) {
      var it = items[c];
      var p = productMap[String(it.hang_hoa_id)] || {};
      var quanLyTheoLo = Boolean(p.quan_ly_theo_lo);
      var lotInfo = it.lo_info && typeof it.lo_info === 'object' ? it.lo_info : null;
      var soLuongNhap = Math.floor(Number(it.so_luong || 0));
      var soLuongLo = lotInfo ? Math.floor(Number(lotInfo.so_luong_lo || 0)) : 0;

      if (quanLyTheoLo && submitMode === 'completed') {
        if (!lotInfo || soLuongLo <= 0 || soLuongLo > soLuongNhap) {
          return res.redirect('/nhap-hang/create?error=missing_lot_info');
        }
      }
      if (quanLyTheoLo && lotInfo && soLuongLo > soLuongNhap) {
        soLuongLo = soLuongNhap;
      }

      var lineTotal = calcLineTotal(it);
      var ctDoc = await CTPhieuNhap.create({
        phieu_nhap_id: phieu._id,
        hang_hoa_id: it.hang_hoa_id,
        don_vi_tinh_id: p.don_vi_tinh_id || undefined,
        so_luong: soLuongNhap,
        don_gia_nhap: Math.floor(Number(it.don_gia || 0)),
        giam_gia_dong: Math.floor(Number(it.giam_gia_dong || 0)),
        kieu_giam_gia_dong: ['vnd', 'percent'].indexOf(String(it.kieu_giam_gia_dong || 'vnd')) >= 0 ? String(it.kieu_giam_gia_dong) : 'vnd',
        thanh_tien: lineTotal,
        ghi_chu: ''
      });

      var loHangId = null;
      if (quanLyTheoLo && lotInfo && soLuongLo > 0) {
        var maLo = String(lotInfo.ma_lo || '').trim();
        if (!maLo) maLo = await makeLoCode();
        var loHangDoc = await LoHang.create({
          cua_hang_id: storeId,
          kho_id: khoId,
          hang_hoa_id: it.hang_hoa_id,
          nha_cung_cap_id: supplierId || undefined,
          phieu_nhap_id: phieu._id,
          ct_phieu_nhap_id: ctDoc._id,
          ma_lo: maLo,
          ten_lo: String(lotInfo.ten_lo || '').trim() || undefined,
          ngay_nhap: parseDateOnly(lotInfo.ngay_nhap) || ngayNhap,
          ngay_thu_hoach: parseDateOnly(lotInfo.ngay_thu_hoach),
          han_su_dung: parseDateOnly(lotInfo.han_su_dung),
          so_luong_ban_dau: soLuongLo,
          so_luong_con_lai: soLuongLo,
          don_gia_nhap: Math.floor(Number(it.don_gia || 0)),
          gia_von: Math.floor(Number(it.don_gia || 0)),
          trang_thai: 'active',
          ghi_chu: String(lotInfo.ghi_chu || '').trim() || undefined
        });
        loHangId = loHangDoc._id;
        await CTPhieuNhap.updateOne({ _id: ctDoc._id }, { $set: { lo_hang_id: loHangId } });
      }

      ctRows.push({
        _id: ctDoc._id,
        phieu_nhap_id: phieu._id,
        hang_hoa_id: it.hang_hoa_id,
        don_vi_tinh_id: p.don_vi_tinh_id || undefined,
        so_luong: soLuongNhap,
        don_gia_nhap: Math.floor(Number(it.don_gia || 0)),
        giam_gia_dong: Math.floor(Number(it.giam_gia_dong || 0)),
        kieu_giam_gia_dong: ['vnd', 'percent'].indexOf(String(it.kieu_giam_gia_dong || 'vnd')) >= 0 ? String(it.kieu_giam_gia_dong) : 'vnd',
        thanh_tien: lineTotal,
        lo_hang_id: loHangId || undefined
      });
    }

    if (submitMode === 'completed') {
      var priceOps = [];
      for (var i = 0; i < ctRows.length; i++) {
        var row = ctRows[i];
        var updatedInv = await TonKho.findOneAndUpdate(
          { cua_hang_id: storeId, kho_id: khoId, hang_hoa_id: row.hang_hoa_id },
          { $inc: { so_luong: Number(row.so_luong || 0) } },
          { upsert: true, new: true }
        ).lean();

        if (row.lo_hang_id) {
          await TonKhoLo.findOneAndUpdate(
            {
              cua_hang_id: storeId,
              kho_id: khoId,
              hang_hoa_id: row.hang_hoa_id,
              lo_hang_id: row.lo_hang_id
            },
            {
              $inc: { so_luong: Number(row.so_luong || 0) },
              $set: { gia_von: Number(row.don_gia_nhap || 0) }
            },
            { upsert: true, new: true }
          ).lean();
        }

        var lichSuPayload = {
          cua_hang_id: storeId,
          kho_id: khoId,
          hang_hoa_id: row.hang_hoa_id,
          nguoi_tao_id: req.user && req.user._id ? req.user._id : undefined,
          loai_phieu: 'nhap_hang',
          ma_phieu: maPhieu,
          so_luong_thay_doi: Number(row.so_luong || 0),
          ton_kho_sau: Number(updatedInv?.so_luong || 0),
          ghi_chu: 'Nhập hàng'
        };
        if (LichSuKho && LichSuKho.schema && LichSuKho.schema.path('lo_hang_id') && row.lo_hang_id) {
          lichSuPayload.lo_hang_id = row.lo_hang_id;
        }
        await LichSuKho.create(lichSuPayload);

        priceOps.push({
          updateOne: {
            filter: { _id: row.hang_hoa_id },
            update: { $set: { gia_nhap_cuoi: Number(row.don_gia_nhap || 0) } }
          }
        });
      }

      if (priceOps.length > 0) {
        await HangHoa.bulkWrite(priceOps);
      }

      if (supplierId) {
        if (conNoNcc > 0) {
          await CongNoNhaCungCap.create({
            cua_hang_id: storeId,
            nha_cung_cap_id: supplierId,
            phieu_nhap_id: phieu._id,
            so_tien: conNoNcc,
            loai: 'tang_no',
            ghi_chu: 'Công nợ phát sinh từ phiếu nhập ' + maPhieu,
            ngay: ngayNhap
          });
        }

        var supplierDoc = await NhaCungCap.findById(supplierId)
          .select('tong_no tong_mua')
          .lean();
        if (supplierDoc) {
          var supplierInc = {};
          if (typeof supplierDoc.tong_mua === 'number') supplierInc.tong_mua = canTraNcc;
          if (conNoNcc > 0 && typeof supplierDoc.tong_no === 'number') supplierInc.tong_no = conNoNcc;
          if (Object.keys(supplierInc).length > 0) {
            await NhaCungCap.updateOne(
              { _id: supplierId },
              { $inc: supplierInc }
            );
          }
        }
      }
    }

    return res.redirect('/nhap-hang?success=created');
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
