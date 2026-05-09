require('dotenv').config();
var createError = require('http-errors');
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
var session = require('express-session');
var passport = require('./config/passport');
var { CuaHang } = require('./models/kiot.model');

var indexRouter = require('./routes/index');
var authRouter = require('./routes/auth');
var profileRouter = require('./routes/profile');
var cuaHangRouter = require('./routes/cuaHang');
var hangHoaRouter = require('./routes/hangHoa');
var nhaCungCapRouter = require('./routes/nhaCungCap');
var { isAuthenticated } = require('./middlewares/auth.middleware');
var nhapHangRouter = require('./routes/nhapHang');
var nhapHangController = require('./controllers/nhapHang.controller');
var traHangNhapController = require('./controllers/traHangNhap.controller');
var kiemKhoRouter = require('./routes/kiemKho');
var banHangRouter = require('./routes/banHang');
var donHangRouter = require('./routes/donHang');
var soQuyRouter = require('./routes/soQuy');
var baoCaoRouter = require('./routes/baoCao');
var khachHangRouter = require('./routes/khachHang');
var xuatDungNoiBoRouter = require('./routes/xuatDungNoiBo');
var xuatHuyRouter = require('./routes/xuatHuy');
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

// middleware to inject user and current store into views
app.use(async (req, res, next) => {
  res.locals.user = req.user || null;
  res.locals.currentStore = null;

  if (!req.user) {
    return next();
  }

  try {
    const store = req.user.cua_hang_id
      ? await CuaHang.findById(req.user.cua_hang_id)
      : await CuaHang.findOne({ trang_thai: 'active' }).sort({ created_at: 1 });

    res.locals.currentStore = store || null;
    next();
  } catch (error) {
    next(error);
  }
});

app.use('/', indexRouter);
app.use('/auth', authRouter);
app.use('/profile', profileRouter);
app.use('/cua-hang', cuaHangRouter);
app.use('/hang-hoa', hangHoaRouter);
app.use('/nha-cung-cap', nhaCungCapRouter);
app.use('/nhap-hang', nhapHangRouter);
app.use('/tra-hang-nhap', traHangNhapRouter);
app.use('/kiem-kho', kiemKhoRouter);
app.use('/ban-hang', banHangRouter);

// APIs for nhapHang feature
app.get('/api/hang-hoa', isAuthenticated, nhapHangController.apiHangHoa);
app.get('/api/nha-cung-cap/:id/hang-hoa', isAuthenticated, nhapHangController.apiSupplierProducts);
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
app.use('/xuat-dung-noi-bo', xuatDungNoiBoRouter);
app.use('/xuat-huy', xuatHuyRouter);

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
