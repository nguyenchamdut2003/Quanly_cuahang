var express = require('express');
var router = express.Router();
const {
  HoaDonBanHang,
  CTHoaDonBanHang,
  PhieuTraHang,
  PhieuNhap,
  DonHang,
  KhachHang,
  HangHoa,
  NhaCungCap,
  VanDon
} = require('../models/kiot.model');

function startOfDay(date = new Date()) {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
}

function endOfDay(date = new Date()) {
  const value = new Date(date);
  value.setHours(23, 59, 59, 999);
  return value;
}

function startOfMonth(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
}

function startOfYear(date = new Date()) {
  return new Date(date.getFullYear(), 0, 1);
}

function endOfYear(date = new Date()) {
  return new Date(date.getFullYear(), 11, 31, 23, 59, 59, 999);
}

async function buildRevenueChartData() {
  const now = new Date();
  const monthStart = startOfMonth(now);
  const monthEnd = endOfMonth(now);
  const yearStart = startOfYear(now);
  const yearEnd = endOfYear(now);
  const firstChartYear = now.getFullYear() - 4;
  const multiYearStart = new Date(firstChartYear, 0, 1);

  const [
    dailySales,
    dailyReturns,
    monthlySales,
    monthlyReturns,
    yearlySales,
    yearlyReturns
  ] = await Promise.all([
    HoaDonBanHang.aggregate([
      { $match: { ngay_ban: { $gte: monthStart, $lte: monthEnd } } },
      { $group: { _id: { $dayOfMonth: '$ngay_ban' }, total: { $sum: '$thanh_toan' } } }
    ]),
    PhieuTraHang.aggregate([
      { $match: { ngay_tra: { $gte: monthStart, $lte: monthEnd } } },
      { $group: { _id: { $dayOfMonth: '$ngay_tra' }, total: { $sum: '$tong_tien_tra' } } }
    ]),
    HoaDonBanHang.aggregate([
      { $match: { ngay_ban: { $gte: yearStart, $lte: yearEnd } } },
      { $group: { _id: { $month: '$ngay_ban' }, total: { $sum: '$thanh_toan' } } }
    ]),
    PhieuTraHang.aggregate([
      { $match: { ngay_tra: { $gte: yearStart, $lte: yearEnd } } },
      { $group: { _id: { $month: '$ngay_tra' }, total: { $sum: '$tong_tien_tra' } } }
    ]),
    HoaDonBanHang.aggregate([
      { $match: { ngay_ban: { $gte: multiYearStart, $lte: yearEnd } } },
      { $group: { _id: { $year: '$ngay_ban' }, total: { $sum: '$thanh_toan' } } }
    ]),
    PhieuTraHang.aggregate([
      { $match: { ngay_tra: { $gte: multiYearStart, $lte: yearEnd } } },
      { $group: { _id: { $year: '$ngay_tra' }, total: { $sum: '$tong_tien_tra' } } }
    ])
  ]);

  const toMap = rows => new Map(rows.map(item => [Number(item._id), Number(item.total || 0)]));
  const makeValues = (keys, salesRows, returnRows) => {
    const salesMap = toMap(salesRows);
    const returnMap = toMap(returnRows);
    return keys.map(key => Math.max((salesMap.get(key) || 0) - (returnMap.get(key) || 0), 0));
  };
  const withTotal = (labels, values) => ({
    labels,
    values,
    total: values.reduce((sum, value) => sum + value, 0)
  });

  const daysInMonth = monthEnd.getDate();
  const dayKeys = Array.from({ length: daysInMonth }, (_, index) => index + 1);
  const monthKeys = Array.from({ length: 12 }, (_, index) => index + 1);
  const yearKeys = Array.from({ length: 5 }, (_, index) => firstChartYear + index);

  const dayValues = makeValues(dayKeys, dailySales, dailyReturns);
  const monthValues = makeValues(monthKeys, monthlySales, monthlyReturns);
  const yearValues = makeValues(yearKeys, yearlySales, yearlyReturns);

  return {
    day: withTotal(dayKeys.map(day => String(day).padStart(2, '0')), dayValues),
    month: withTotal(monthKeys.map(month => `T${String(month).padStart(2, '0')}`), monthValues),
    year: withTotal(yearKeys.map(String), yearValues)
  };
}

function relativeTime(date) {
  if (!date) return '';
  const diff = Date.now() - new Date(date).getTime();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return 'vừa xong';
  if (diff < hour) return `${Math.floor(diff / minute)} phút trước`;
  if (diff < day) return `${Math.floor(diff / hour)} giờ trước`;
  return `${Math.floor(diff / day)} ngày trước`;
}

async function getDashboardData(user) {
  const todayStart = startOfDay();
  const todayEnd = endOfDay();
  const monthStart = startOfMonth();

  const [
    todaySales,
    todayReturns,
    chart,
    topProducts,
    topCustomers,
    invoices,
    purchases,
    orders,
    lowStockCount,
    shippingCount,
    customerCount,
    supplierCount
  ] = await Promise.all([
    HoaDonBanHang.aggregate([
      { $match: { ngay_ban: { $gte: todayStart, $lte: todayEnd } } },
      { $group: { _id: null, total: { $sum: '$thanh_toan' }, count: { $sum: 1 } } }
    ]),
    PhieuTraHang.aggregate([
      { $match: { ngay_tra: { $gte: todayStart, $lte: todayEnd } } },
      { $group: { _id: null, total: { $sum: '$tong_tien_tra' }, count: { $sum: 1 } } }
    ]),
    buildRevenueChartData(),
    CTHoaDonBanHang.aggregate([
      {
        $lookup: {
          from: 'hoa_don_ban_hang',
          localField: 'hoa_don_id',
          foreignField: '_id',
          as: 'invoice'
        }
      },
      { $unwind: '$invoice' },
      { $match: { 'invoice.ngay_ban': { $gte: monthStart } } },
      { $group: { _id: '$hang_hoa_id', quantity: { $sum: '$so_luong' }, revenue: { $sum: '$thanh_tien' } } },
      { $sort: { revenue: -1 } },
      { $limit: 10 },
      {
        $lookup: {
          from: 'hang_hoa',
          localField: '_id',
          foreignField: '_id',
          as: 'product'
        }
      },
      { $unwind: '$product' }
    ]),
    HoaDonBanHang.aggregate([
      { $match: { khach_hang_id: { $ne: null }, ngay_ban: { $gte: monthStart } } },
      { $group: { _id: '$khach_hang_id', total: { $sum: '$thanh_toan' }, count: { $sum: 1 } } },
      { $sort: { total: -1 } },
      { $limit: 10 },
      {
        $lookup: {
          from: 'khach_hang',
          localField: '_id',
          foreignField: '_id',
          as: 'customer'
        }
      },
      { $unwind: '$customer' }
    ]),
    HoaDonBanHang.find().populate('khach_hang_id').sort({ created_at: -1 }).limit(5),
    PhieuNhap.find().populate('nha_cung_cap_id').sort({ created_at: -1 }).limit(5),
    DonHang.find().populate('khach_hang_id').sort({ created_at: -1 }).limit(5),
    HangHoa.countDocuments({ trang_thai: 'active', $expr: { $lte: ['$ton_kho', '$dinh_muc_ton_thap'] } }),
    VanDon.countDocuments({ trang_thai: 'shipping' }),
    KhachHang.countDocuments({ trang_thai: { $ne: 'inactive' } }),
    NhaCungCap.countDocuments({ trang_thai: 'active' })
  ]);

  const todaySale = todaySales[0] || { total: 0, count: 0 };
  const todayReturn = todayReturns[0] || { total: 0, count: 0 };
  const netRevenue = Math.max((todaySale.total || 0) - (todayReturn.total || 0), 0);

  const activities = [
    ...invoices.map(item => ({
      type: 'sale',
      icon: 'fa-receipt',
      actor: user?.ho_ten || 'Admin',
      text: `vừa bán đơn hàng ${item.ma_hoa_don}`,
      value: item.thanh_toan || item.tong_tien || 0,
      time: item.created_at || item.ngay_ban
    })),
    ...purchases.map(item => ({
      type: 'purchase',
      icon: 'fa-box',
      actor: user?.ho_ten || 'Admin',
      text: `vừa nhập hàng ${item.ma_phieu_nhap}`,
      value: item.tong_tien || 0,
      time: item.created_at || item.ngay_nhap
    })),
    ...orders.map(item => ({
      type: 'order',
      icon: 'fa-bag-shopping',
      actor: user?.ho_ten || 'Admin',
      text: `vừa tạo đặt hàng ${item.ma_don_hang}`,
      value: item.tong_thanh_toan || item.tong_tien || 0,
      time: item.created_at || item.ngay_dat
    }))
  ].sort((a, b) => new Date(b.time || 0) - new Date(a.time || 0)).slice(0, 12)
    .map(item => ({ ...item, relative: relativeTime(item.time) }));

  return {
    todaySale,
    todayReturn,
    netRevenue,
    chart,
    topProducts: topProducts.map(item => ({
      code: item.product.ma_hang,
      name: item.product.ten_hang,
      quantity: item.quantity || 0,
      revenue: item.revenue || 0
    })),
    topCustomers: topCustomers.map(item => ({
      code: item.customer.ma_khach_hang,
      name: item.customer.ten_khach_hang,
      count: item.count || 0,
      total: item.total || 0
    })),
    activities,
    alerts: { lowStockCount, shippingCount, customerCount, supplierCount }
  };
}

router.get('/', async function(req, res, next) {
  try {
    if (!req.isAuthenticated()) {
      return res.render('login', { title: 'Đăng nhập', query: req.query || {} });
    }

    const dashboard = await getDashboardData(req.user);
    res.render('index', { title: 'Tổng quan - KiotViet ERP', user: req.user, dashboard });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
