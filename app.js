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
var phieuNhapRouter = require('./routes/phieuNhap');
var kiemKhoRouter = require('./routes/kiemKho');
var banHangRouter = require('./routes/banHang');
var donHangRouter = require('./routes/donHang');
var soQuyRouter = require('./routes/soQuy');
var baoCaoRouter = require('./routes/baoCao');
var khachHangRouter = require('./routes/khachHang');
var xuatDungNoiBoRouter = require('./routes/xuatDungNoiBo');

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
app.use('/phieu-nhap', phieuNhapRouter);
app.use('/kiem-kho', kiemKhoRouter);
app.use('/ban-hang', banHangRouter);
app.use('/don-hang', donHangRouter);
app.use('/so-quy', soQuyRouter);
app.use('/bao-cao', baoCaoRouter);
app.use('/khach-hang', khachHangRouter);
app.use('/xuat-dung-noi-bo', xuatDungNoiBoRouter);

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
