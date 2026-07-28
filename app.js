require('dotenv').config();
var createError = require('http-errors');
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
var session = require('express-session');
var passport = require('./config/passport');
var { CuaHang } = require('./models/kiot.model');
var { dbWriteRequestContext } = require('./utils/dbWriteLogger');

var healthRouter = require('./routes/health');
var indexRouter = require('./routes/index');
var authRouter = require('./routes/auth');
var profileRouter = require('./routes/profile');
var cuaHangRouter = require('./routes/cuaHang');
var hangHoaRouter = require('./routes/hangHoa');
var vatChuaRouter = require('./routes/vatChua');
var nhaCungCapRouter = require('./routes/nhaCungCap');
var nhapHangRouter = require('./routes/nhapHang');
var kiemKhoRouter = require('./routes/kiemKho');
var banHangRouter = require('./routes/banHang');
var donHangRouter = require('./routes/donHang');
var soQuyRouter = require('./routes/soQuy');
var baoCaoRouter = require('./routes/baoCao');
var khachHangRouter = require('./routes/khachHang');
var xuatDungNoiBoRouter = require('./routes/xuatDungNoiBo');
var xuatHuyRouter = require('./routes/xuatHuy');
var stockVoucherRouter = require('./routes/stockVoucher');
var apiHangHoaNhapRouter = require('./routes/apiHangHoaNhap');
var apiNhaCungCapNhapRouter = require('./routes/apiNhaCungCapNhap');
var apiNhapHangRouter = require('./routes/apiNhapHang');
var apiKhoNghiepVuRouter = require('./routes/apiKhoNghiepVu');
var apiPhieuNhapRouter = require('./routes/apiPhieuNhap');
var apiXuatHuyRouter = require('./routes/apiXuatHuy');
var phieuNhapPrintRouter = require('./routes/phieuNhapPrint');
var thuocTinhApiRouter = require('./routes/thuocTinhApi');
var apiKhoRouter = require('./routes/apiKho');
var apiAddressRouter = require('./routes/apiAddress');
var traHangNhapRouter = require('./routes/traHangNhap');
var phongBanRouter = require('./routes/phongBan');
var apiPhongBanRouter = require('./routes/apiPhongBan');
var chucDanhRouter = require('./routes/chucDanh');
var apiChucDanhRouter = require('./routes/apiChucDanh');
var nhanVienRouter = require('./routes/nhanVien');
var apiNhanVienRouter = require('./routes/apiNhanVien');
var caLamViecRouter = require('./routes/caLamViec');
var apiCaLamViecRouter = require('./routes/apiCaLamViec');
var ngayLamNghiRouter = require('./routes/ngayLamNghi');
var apiNgayLamViecCuaHangRouter = require('./routes/apiNgayLamViecCuaHang');
var apiNgayLeTetRouter = require('./routes/apiNgayLeTet');
var lichLamViecRouter = require('./routes/lichLamViec');
var apiLichLamViecRouter = require('./routes/apiLichLamViec');
var chamCongRouter = require('./routes/chamCong');
var chamcongMoiRouter = require('./routes/chamcongMoi');
var apiChamCongRouter = require('./routes/apiChamCong');
var bangLuongRouter = require('./routes/bangLuong');
var apiBangLuongRouter = require('./routes/apiBangLuong');
var apiSoQuyRouter = require('./routes/apiSoQuy');
var thietLapNhanVienRouter = require('./routes/thietLapNhanVien');
var thungRacRouter = require('./routes/thungRac');
var shortcutRouter = require('./routes/shortcut');
var systemRouter = require('./routes/system');
var { isPerformanceEnabled } = require('./utils/performance.util');

var app = express();

function isStaticAssetRequestPath(requestPath) {
  return /\.(css|js|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|map)$/i.test(requestPath || '');
}

function isHeaderStoreDataRequired(req) {
  var requestPath = String(req.path || '');
  return requestPath.indexOf('/cua-hang/api/') !== 0
    && requestPath.indexOf('/api/address/') !== 0;
}

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

app.use(function(req, res, next) {
  var render = res.render;
  res.render = function() {
    res.set('Content-Type', 'text/html; charset=utf-8');
    return render.apply(res, arguments);
  };
  next();
});

app.use(logger('dev', {
  skip: function(req) {
    return isStaticAssetRequestPath(req.path);
  }
}));
app.use(dbWriteRequestContext);
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'fallback_secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production'
  }
}));

app.use(passport.initialize());
app.use(passport.session());

if (isPerformanceEnabled()) {
  app.use(function requestTiming(req, res, next) {
    var startedAt = process.hrtime.bigint();

    res.on('finish', function() {
      var durationMs = Number(process.hrtime.bigint() - startedAt) / 1000000;
      var isStaticAsset = isStaticAssetRequestPath(req.path);

      if (isStaticAsset) return;

      var level = durationMs >= 2000
        ? 'VERY SLOW'
        : durationMs >= 1000
          ? 'SLOW'
          : durationMs >= 500
            ? 'WARN'
            : 'OK';

      console.log(
        '[' + level + '] ' + req.method + ' ' + req.originalUrl +
        ' | ' + res.statusCode +
        ' | ' + durationMs.toFixed(2) + ' ms'
      );
    });

    next();
  });
}

app.use('/healthz', healthRouter);

app.use(function(req, res, next) {
  res.locals.originalUrl = req.originalUrl || '/';
  res.locals.refUrl = function(type, id) {
    var safeId = String(id || '').trim();
    if (!safeId) return '';
    var map = {
      product: '/hang-hoa/' + safeId,
      hang_hoa: '/hang-hoa/' + safeId,
      supplier: '/nha-cung-cap/' + safeId,
      nha_cung_cap: '/nha-cung-cap/' + safeId,
      customer: '/khach-hang/' + safeId,
      khach_hang: '/khach-hang/' + safeId,
      purchase: '/nhap-hang?purchase=' + encodeURIComponent(safeId),
      phieu_nhap: '/nhap-hang?purchase=' + encodeURIComponent(safeId),
      order: '/don-hang?order=' + encodeURIComponent(safeId),
      don_hang: '/don-hang?order=' + encodeURIComponent(safeId),
      invoice: '/don-hang/hoa-don?invoice=' + encodeURIComponent(safeId),
      hoa_don: '/don-hang/hoa-don?invoice=' + encodeURIComponent(safeId),
      customer_return: '/don-hang/tra-hang/' + safeId,
      phieu_tra_hang: '/don-hang/tra-hang/' + safeId,
      supplier_return: '/tra-hang-nhap/' + safeId,
      phieu_tra_hang_nhap: '/tra-hang-nhap/' + safeId,
      stock_check: '/kiem-kho/' + safeId + '/export.csv',
      phieu_kiem_kho: '/kiem-kho/' + safeId + '/export.csv',
      stock_disposal: '/xuat-huy/' + safeId,
      phieu_xuat_huy: '/xuat-huy/' + safeId,
      internal_issue: '/xuat-dung-noi-bo/' + safeId + '/export.xlsx',
      phieu_xuat_noi_bo: '/xuat-dung-noi-bo/' + safeId + '/export.xlsx',
      lot: '/lo-hang/' + safeId,
      lo_hang: '/lo-hang/' + safeId,
      shipment: '/don-hang/van-don/' + safeId,
      van_don: '/don-hang/van-don/' + safeId,
      receipt: '/so-quy/phieu-thu-chi/' + safeId,
      phieu_thu_chi: '/so-quy/phieu-thu-chi/' + safeId,
      warehouse: '/cua-hang?kho=' + encodeURIComponent(safeId),
      kho: '/cua-hang?kho=' + encodeURIComponent(safeId),
      cashbook: '/so-quy?so_quy_id=' + encodeURIComponent(safeId),
      so_quy: '/so-quy?so_quy_id=' + encodeURIComponent(safeId),
      payroll: '/bang-luong/' + safeId,
      bang_luong: '/bang-luong/' + safeId,
      chamcong_payroll: '/chamcongmoi?tab=payroll-paid&bang_luong=' + encodeURIComponent(safeId),
      chamcongmoi_bang_luong: '/chamcongmoi?tab=payroll-paid&bang_luong=' + encodeURIComponent(safeId),
      nhap_vat_chua: '/vat-chua?nhap_vat_chua=' + encodeURIComponent(safeId)
    };
    return map[type] || '';
  };
  res.locals.refLink = function(type, doc, text, attrs) {
    var id = doc && doc._id ? doc._id : doc;
    var label = String(text || (doc && (doc.ma_hang || doc.ma_ncc || doc.ma_khach_hang || doc.ma_phieu_nhap || doc.ma_nhap_vat_chua || doc.ma_don_hang || doc.ma_hoa_don || doc.ma_lo || doc.ma_van_don || doc.ma_phieu || doc.ma_bang_luong || doc.ma_kho || doc.ten_so_quy)) || '--');
    var escape = function(value) {
      return String(value).replace(/[&<>"']/g, function(char) {
        return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char];
      });
    };
    var href = res.locals.refUrl(type, id);
    if (!href) return escape(label);
    return '<a class="ref-link" href="' + escape(href) + '"' + (attrs ? ' ' + attrs : '') + '>' + escape(label) + '</a>';
  };
  next();
});

// middleware: danh sách cửa hàng active + cửa hàng đang hiển thị (user.cua_hang_id → session → mặc định đầu tiên)
app.use(async (req, res, next) => {
  res.locals.user = req.user || null;
  res.locals.currentStore = null;
  res.locals.availableStores = [];

  if (!req.user) {
    return next();
  }

  if (!isHeaderStoreDataRequired(req)) {
    return next();
  }

  try {
    const stores = await CuaHang.find({ trang_thai: 'active' })
      .sort({ ma_cua_hang: 1, created_at: 1 })
      .lean();
    res.locals.availableStores = stores;

    const activeIds = new Set(stores.map(function(s) { return String(s._id); }));
    const uid = req.user.cua_hang_id ? String(req.user.cua_hang_id._id || req.user.cua_hang_id) : '';
    const sid = req.session && req.session.cua_hang_id ? String(req.session.cua_hang_id) : '';

    var selectedId = '';
    if (uid && activeIds.has(uid)) selectedId = uid;
    else if (sid && activeIds.has(sid)) selectedId = sid;
    else if (stores.length) selectedId = String(stores[0]._id);

    if (sid && !activeIds.has(sid) && req.session) {
      delete req.session.cua_hang_id;
    }

    res.locals.currentStore = selectedId
      ? stores.find(function(s) { return String(s._id) === selectedId; }) || null
      : null;
    next();
  } catch (error) {
    next(error);
  }
});

app.use(function(req, res, next) {
  res.locals.trashCount = 0;
  next();
});

app.use('/', authRouter);
app.use('/', indexRouter);
app.use('/profile', profileRouter);
app.use('/cua-hang', cuaHangRouter);
app.use('/hang-hoa', hangHoaRouter);
app.use('/vat-chua', vatChuaRouter);
app.use('/nha-cung-cap', nhaCungCapRouter);
app.use('/nhap-hang', nhapHangRouter);
app.use('/tra-hang-nhap', traHangNhapRouter);
app.use('/kiem-kho', kiemKhoRouter);
app.use('/ban-hang', banHangRouter);

app.use('/api/hang-hoa', apiHangHoaNhapRouter);
app.use('/api/nha-cung-cap', apiNhaCungCapNhapRouter);
app.use('/', thuocTinhApiRouter);
app.use('/phieu-nhap', phieuNhapPrintRouter);
app.use('/api/phieu-nhap', apiPhieuNhapRouter);
app.use('/api/kho', apiKhoNghiepVuRouter);
app.use('/api/xuat-huy', apiXuatHuyRouter);
app.use('/api/nhap-hang', apiNhapHangRouter);

app.use('/api/so-quy', apiSoQuyRouter);
app.use('/api', apiKhoRouter);
app.use('/api/address', apiAddressRouter);
app.use('/api/don-hang', donHangRouter);
app.use('/don-hang', donHangRouter);
app.use('/so-quy', soQuyRouter);
app.use('/bao-cao', baoCaoRouter);
app.use('/api/phong-ban', apiPhongBanRouter);
app.use('/api/chuc-danh', apiChucDanhRouter);
app.use('/api/nhan-vien', apiNhanVienRouter);
app.use('/api/ca-lam-viec', apiCaLamViecRouter);
app.use('/api/ngay-lam-viec-cua-hang', apiNgayLamViecCuaHangRouter);
app.use('/api/ngay-le-tet', apiNgayLeTetRouter);
app.use('/api/lich-lam-viec', apiLichLamViecRouter);
app.use('/api/cham-cong', apiChamCongRouter);
app.use('/api/bang-luong', apiBangLuongRouter);
app.use('/phong-ban', phongBanRouter);
app.use('/chuc-danh', chucDanhRouter);
app.use('/ca-lam-viec', caLamViecRouter);
app.use('/ngay-lam-nghi', ngayLamNghiRouter);
app.use('/lich-lam-viec', lichLamViecRouter);
app.use('/chamcongmoi', chamcongMoiRouter);
app.use('/cham-cong', chamCongRouter);
app.use('/bang-luong', bangLuongRouter);
app.use('/thiet-lap-nhan-vien', thietLapNhanVienRouter);
app.use('/thung-rac', thungRacRouter);
app.use('/nhan-vien', nhanVienRouter);
app.use('/khach-hang', khachHangRouter);
app.use('/chung-tu-kho', stockVoucherRouter);
app.use('/xuat-dung-noi-bo', xuatDungNoiBoRouter);
app.use('/xuat-huy', xuatHuyRouter);
app.use('/system', systemRouter);
app.use('/', shortcutRouter);

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  next(createError(404));
});

// error handler
app.use(function(err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});

module.exports = app;
