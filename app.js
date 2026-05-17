require('dotenv').config();
var createError = require('http-errors');
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
var session = require('express-session');
var passport = require('./config/passport');
var { CuaHang, LoHang } = require('./models/kiot.model');

var indexRouter = require('./routes/index');
var authRouter = require('./routes/auth');
var profileRouter = require('./routes/profile');
var cuaHangRouter = require('./routes/cuaHang');
var hangHoaRouter = require('./routes/hangHoa');
var nhaCungCapRouter = require('./routes/nhaCungCap');
var cauHinhRouter = require('./routes/cauHinh');
var { isAuthenticated } = require('./middlewares/auth.middleware');
var nhapHangRouter = require('./routes/nhapHang');
var nhapHangController = require('./controllers/nhapHang.controller');
var hangHoaController = require('./controllers/hangHoa.controller');
var traHangNhapController = require('./controllers/traHangNhap.controller');
var kiemKhoRouter = require('./routes/kiemKho');
var banHangRouter = require('./routes/banHang');
var donHangRouter = require('./routes/donHang');
var soQuyRouter = require('./routes/soQuy');
var baoCaoRouter = require('./routes/baoCao');
var khachHangRouter = require('./routes/khachHang');
var xuatDungNoiBoRouter = require('./routes/xuatDungNoiBo');
var xuatHuyRouter = require('./routes/xuatHuy');
var stockVoucherRouter = require('./routes/stockVoucher');
var xuatHuyController = require('./controllers/xuatHuy.controller');
var apiKhoRouter = require('./routes/apiKho');
var traHangNhapRouter = require('./routes/traHangNhap');

var app = express();

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'fallback_secret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false } // in production use true with https
}));

app.use(passport.initialize());
app.use(passport.session());

app.get('/healthz', function(req, res) {
  res.status(200).json({ status: 'ok' });
});

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
      purchase: '/nhap-hang/' + safeId,
      phieu_nhap: '/nhap-hang/' + safeId,
      order: '/don-hang/' + safeId,
      don_hang: '/don-hang/' + safeId,
      invoice: '/hoa-don/' + safeId,
      hoa_don: '/hoa-don/' + safeId,
      lot: '/lo-hang/' + safeId,
      lo_hang: '/lo-hang/' + safeId,
      shipment: '/don-hang/van-don/' + safeId,
      van_don: '/don-hang/van-don/' + safeId,
      receipt: '/so-quy/phieu-thu-chi/' + safeId,
      phieu_thu_chi: '/so-quy/phieu-thu-chi/' + safeId,
      warehouse: '/cua-hang?kho=' + encodeURIComponent(safeId),
      kho: '/cua-hang?kho=' + encodeURIComponent(safeId),
      cashbook: '/so-quy?so_quy_id=' + encodeURIComponent(safeId),
      so_quy: '/so-quy?so_quy_id=' + encodeURIComponent(safeId)
    };
    return map[type] || '';
  };
  res.locals.refLink = function(type, doc, text, attrs) {
    var id = doc && doc._id ? doc._id : doc;
    var label = String(text || (doc && (doc.ma_hang || doc.ma_ncc || doc.ma_khach_hang || doc.ma_phieu_nhap || doc.ma_don_hang || doc.ma_hoa_don || doc.ma_lo || doc.ma_van_don || doc.ma_phieu || doc.ma_kho || doc.ten_so_quy)) || '--');
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

app.use('/', indexRouter);
app.use('/auth', authRouter);
app.use('/profile', profileRouter);
app.use('/cua-hang', cuaHangRouter);
app.use('/cau-hinh', cauHinhRouter);
app.use('/hang-hoa', hangHoaRouter);
app.use('/nha-cung-cap', nhaCungCapRouter);
app.use('/nhap-hang', nhapHangRouter);
app.use('/tra-hang-nhap', traHangNhapRouter);
app.use('/kiem-kho', kiemKhoRouter);
app.use('/ban-hang', banHangRouter);

// APIs for nhapHang feature
app.get('/api/hang-hoa', isAuthenticated, nhapHangController.apiHangHoa);
app.get('/api/nha-cung-cap/:id/hang-hoa', isAuthenticated, nhapHangController.apiSupplierProducts);
app.get('/api/hang-hoa/:id/lo-hang', isAuthenticated, nhapHangController.apiProductLots);
app.get('/thuoc-tinh', isAuthenticated, hangHoaController.apiAttributes);
app.post('/thuoc-tinh', isAuthenticated, hangHoaController.apiCreateAttribute);
app.put('/thuoc-tinh/:id', isAuthenticated, hangHoaController.apiUpdateAttribute);
app.delete('/thuoc-tinh/:id', isAuthenticated, hangHoaController.apiDeleteAttribute);
app.get('/gia-tri-thuoc-tinh', isAuthenticated, hangHoaController.apiAttributeValues);
app.post('/gia-tri-thuoc-tinh', isAuthenticated, hangHoaController.apiCreateAttributeValue);
app.put('/gia-tri-thuoc-tinh/:id', isAuthenticated, hangHoaController.apiUpdateAttributeValue);
app.delete('/gia-tri-thuoc-tinh/:id', isAuthenticated, hangHoaController.apiDeleteAttributeValue);
app.get('/hang-hoa/:id/thuoc-tinh', isAuthenticated, hangHoaController.apiProductAttributes);
app.get('/phieu-nhap/:id/in', isAuthenticated, nhapHangController.printPurchase);
app.get('/phieu-nhap/:id/in/pdf', isAuthenticated, nhapHangController.printPhieuNhapPdf);
app.get('/phieu-nhap/:id/in-tong-hop', isAuthenticated, nhapHangController.printPurchaseBundle);
app.get('/phieu-nhap/:id/bang-ke-02-tndn', isAuthenticated, nhapHangController.printBangKe02Tndn);
app.get('/phieu-nhap/:id/bang-ke-02-tndn/pdf', isAuthenticated, nhapHangController.printBangKe02TndnPdf);
app.get('/phieu-nhap/:id/hd-mua-ban-nguyen-tac', isAuthenticated, nhapHangController.printContract);
app.get('/phieu-nhap/:id/hd-mua-ban-nguyen-tac/pdf', isAuthenticated, nhapHangController.printHdMuaBanNguyenTacPdf);
app.get('/api/phieu-nhap', isAuthenticated, traHangNhapController.apiPurchasesByWarehouse);
app.get('/api/phieu-nhap/con-hang-xuat-huy', isAuthenticated, xuatHuyController.apiPurchasesWithStock);
app.get('/api/kho/:khoId/phieu-nhap', isAuthenticated, traHangNhapController.apiPurchasesByWarehouse);
app.get('/api/phieu-nhap/:id/chi-tiet-tra-hang', isAuthenticated, traHangNhapController.apiPurchaseReturnDetail);
app.get('/api/phieu-nhap/:id/chi-tiet-xuat-huy', isAuthenticated, xuatHuyController.apiPurchaseDestroyDetail);
app.get('/api/kho/:khoId/hang-xuat-huy', isAuthenticated, xuatHuyController.apiWarehouseProducts);
app.post('/api/hang-hoa/quick-create', isAuthenticated, nhapHangController.quickCreateProduct);
app.post('/api/hang-hoa/:id/quick-update', isAuthenticated, nhapHangController.quickUpdateProduct);
app.put('/api/hang-hoa/:id/quick-update', isAuthenticated, nhapHangController.quickUpdateProduct);
app.post('/api/hang-hoa/:id/inactive', isAuthenticated, nhapHangController.inactiveProduct);

app.use('/api', apiKhoRouter);
app.use('/api/don-hang', donHangRouter);
app.use('/don-hang', donHangRouter);
app.use('/so-quy', soQuyRouter);
app.use('/bao-cao', baoCaoRouter);
app.use('/khach-hang', khachHangRouter);
app.use('/chung-tu-kho', stockVoucherRouter);
app.use('/xuat-dung-noi-bo', xuatDungNoiBoRouter);
app.use('/xuat-huy', xuatHuyRouter);

app.get('/hoa-don/:id', isAuthenticated, function(req, res) {
  res.redirect('/don-hang/hoa-don?invoice=' + encodeURIComponent(req.params.id));
});

app.get('/lo-hang/:id', isAuthenticated, async function(req, res, next) {
  try {
    var lot = await LoHang.findById(req.params.id).select('hang_hoa_id').lean();
    var target = lot && lot.hang_hoa_id
      ? '/hang-hoa?lot=' + encodeURIComponent(req.params.id) + '#p-' + String(lot.hang_hoa_id)
      : '/hang-hoa?lot=' + encodeURIComponent(req.params.id);
    res.redirect(target);
  } catch (error) {
    next(error);
  }
});

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
