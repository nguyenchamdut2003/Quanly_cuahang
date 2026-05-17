var path = require('path');
var pdfService = require('../services/pdf.service');
var {
  CuaHang,
  DoanhNghiep,
  DonHang,
  CTDonHang,
  HoaDonBanHang,
  CTHoaDonBanHang,
  PhieuTraHang,
  CTPhieuTraHang,
  PhieuTraHangNhap,
  CTPhieuTraHangNhap,
  PhieuKiemKho,
  CTPhieuKiemKho,
  PhieuXuatHuy,
  CTXuatHuy,
  PhieuXuatNoiBo,
  CTXuatNoiBo,
  PhanBoHang,
  CTPhanBoHang,
  LichSuKho
} = require('../models/kiot.model');

function isObjectId(value) {
  return /^[0-9a-fA-F]{24}$/.test(String(value || ''));
}

function asPlain(doc) {
  return doc && doc.toObject ? doc.toObject() : doc;
}

function userName(user) {
  return user ? (user.ho_ten || user.username || user.email || '') : '';
}

function lotName(lot) {
  return lot ? (lot.ma_lo || lot.ten_lo || '') : '';
}

function attrName(attr) {
  if (!attr) return '';
  var group = attr.thuoc_tinh_id ? (attr.thuoc_tinh_id.ten_thuoc_tinh || attr.thuoc_tinh_id.ma_thuoc_tinh || '') : '';
  var value = attr.ten_gia_tri || attr.ma_gia_tri || '';
  return group && value ? (group + ': ' + value) : value;
}

function rowBase(row, options) {
  options = options || {};
  var product = row.hang_hoa_id || {};
  var qty = Number(options.qty != null ? options.qty : row.so_luong || 0);
  var price = Number(options.price != null ? options.price : row.don_gia || row.don_gia_ban || row.gia_tra_lai || row.gia_von || 0);
  var total = Number(options.total != null ? options.total : row.thanh_tien || (qty * price) || 0);
  return {
    ma_hang: product.ma_hang || '',
    ten_hang: product.ten_hang || '',
    thuoc_tinh: attrName(row.gia_tri_thuoc_tinh_id),
    lo: lotName(row.lo_hang_id),
    so_luong: qty,
    don_gia: price,
    thanh_tien: total,
    ghi_chu: options.note || row.ghi_chu || row.nguyen_nhan_lech || ''
  };
}

async function loadBusiness(store) {
  var business = await DoanhNghiep.findOne({ trang_thai: 'active' }).sort({ updated_at: -1, created_at: -1 }).lean();
  if (!business) business = await DoanhNghiep.findOne({}).sort({ updated_at: -1, created_at: -1 }).lean();
  if (business) return business;
  if (store) {
    return {
      ten_doanh_nghiep: store.ten_cua_hang,
      dia_chi: store.dia_chi || store.dia_chi_gui_hang,
      sdt: store.sdt,
      email: store.email,
      ma_so_thue: store.ma_so_thue
    };
  }
  return {};
}

async function loadSale(id) {
  var ticket = await DonHang.findById(id)
    .populate('cua_hang_id')
    .populate('kho_id')
    .populate('khach_hang_id')
    .populate('nguoi_tao_id')
    .lean();
  if (!ticket) return null;
  var items = await CTDonHang.find({ don_hang_id: ticket._id })
    .populate('hang_hoa_id')
    .populate('lo_hang_id')
    .lean();
  return {
    title: 'Phiếu xuất kho bán hàng',
    heading: 'PHIẾU XUẤT KHO BÁN HÀNG',
    movement: 'Xuất kho',
    code: ticket.ma_don_hang,
    date: ticket.ngay_giao_thuc_te || ticket.ngay_dat || ticket.created_at,
    warehouse: ticket.kho_id,
    store: ticket.cua_hang_id,
    creator: ticket.nguoi_tao_id,
    partnerLabel: 'Khách hàng',
    partnerText: ticket.khach_hang_id ? (ticket.khach_hang_id.ten_khach_hang || ticket.khach_hang_id.ma_khach_hang || '') : 'Khách lẻ',
    note: ticket.ghi_chu,
    totals: {
      quantity: items.reduce(function(sum, row) { return sum + Number(row.so_luong_da_giao || row.so_luong_xac_nhan || row.so_luong_dat || row.so_luong || 0); }, 0),
      value: Number(ticket.tong_thanh_toan || ticket.tong_tien || 0)
    },
    items: items.map(function(row) {
      var qty = Number(row.so_luong_da_giao || row.so_luong_xac_nhan || row.so_luong_dat || row.so_luong || 0);
      return rowBase(row, { qty: qty, price: row.don_gia_ban, total: row.thanh_tien });
    })
  };
}

async function loadRetailInvoice(id) {
  var invoice = await HoaDonBanHang.findById(id)
    .populate('cua_hang_id')
    .populate('kho_id')
    .populate('khach_hang_id')
    .populate('nguoi_ban_id')
    .lean();
  if (!invoice) return null;
  var items = await CTHoaDonBanHang.find({ hoa_don_id: invoice._id })
    .populate('hang_hoa_id')
    .populate('lo_hang_id')
    .lean();
  return {
    title: 'Hóa đơn bán hàng',
    heading: 'HÓA ĐƠN BÁN HÀNG',
    movement: 'Bán hàng',
    code: invoice.ma_hoa_don,
    date: invoice.ngay_ban || invoice.created_at,
    warehouse: invoice.kho_id,
    store: invoice.cua_hang_id,
    creator: invoice.nguoi_ban_id,
    partnerLabel: 'Khách hàng',
    partnerText: invoice.khach_hang_id ? (invoice.khach_hang_id.ten_khach_hang || invoice.khach_hang_id.ma_khach_hang || '') : 'Khách lẻ',
    note: invoice.ghi_chu,
    totals: {
      quantity: items.reduce(function(sum, row) { return sum + Number(row.so_luong || 0); }, 0),
      value: Number(invoice.thanh_toan || invoice.tong_tien || 0)
    },
    items: items.map(function(row) {
      return rowBase(row, { qty: row.so_luong, price: row.don_gia, total: row.thanh_tien });
    })
  };
}

async function loadSalesReturn(id) {
  var ticket = await PhieuTraHang.findById(id)
    .populate('cua_hang_id')
    .populate('kho_id')
    .populate('khach_hang_id')
    .populate('hoa_don_id')
    .populate('nguoi_tao_id')
    .lean();
  if (!ticket) return null;
  var items = await CTPhieuTraHang.find({ phieu_tra_hang_id: ticket._id })
    .populate('hang_hoa_id')
    .populate('lo_hang_id')
    .lean();
  var returnItems = items.filter(function(row) { return row.loai_dong !== 'hang_doi'; });
  return {
    title: 'Phiếu nhập kho hàng trả',
    heading: 'PHIẾU NHẬP KHO HÀNG TRẢ',
    movement: 'Nhập kho',
    code: ticket.ma_phieu_tra,
    date: ticket.ngay_tra || ticket.created_at,
    warehouse: ticket.kho_id,
    store: ticket.cua_hang_id,
    creator: ticket.nguoi_tao_id,
    partnerLabel: 'Khách hàng',
    partnerText: ticket.khach_hang_id ? (ticket.khach_hang_id.ten_khach_hang || ticket.khach_hang_id.ma_khach_hang || '') : 'Khách lẻ',
    sourceLabel: 'Hóa đơn',
    sourceText: ticket.hoa_don_id ? ticket.hoa_don_id.ma_hoa_don : '',
    note: ticket.ghi_chu || ticket.ly_do,
    totals: {
      quantity: returnItems.reduce(function(sum, row) { return sum + Number(row.so_luong || 0); }, 0),
      value: Number(ticket.tong_tien_hang_tra || ticket.tong_tien_tra || 0)
    },
    items: items.map(function(row) {
      return rowBase(row, { note: row.loai_dong === 'hang_doi' ? 'Xuất kho hàng đổi' : (row.ghi_chu || 'Nhập kho hàng trả') });
    })
  };
}

async function loadPurchaseReturn(id) {
  var ticket = await PhieuTraHangNhap.findById(id)
    .populate('cua_hang_id')
    .populate('kho_id')
    .populate('nha_cung_cap_id')
    .populate('phieu_nhap_id')
    .populate('nguoi_tao_id')
    .populate('nguoi_tra_id')
    .lean();
  if (!ticket) return null;
  var items = await CTPhieuTraHangNhap.find({ phieu_tra_nhap_id: ticket._id })
    .populate('hang_hoa_id')
    .populate('lo_hang_id')
    .populate('don_vi_tinh_id')
    .lean();
  return {
    title: 'Phiếu xuất trả nhà cung cấp',
    heading: 'PHIẾU XUẤT TRẢ NHÀ CUNG CẤP',
    movement: 'Xuất kho',
    code: ticket.ma_phieu_tra_nhap,
    date: ticket.ngay_tra || ticket.created_at,
    warehouse: ticket.kho_id,
    store: ticket.cua_hang_id,
    creator: ticket.nguoi_tra_id || ticket.nguoi_tao_id,
    partnerLabel: 'Nhà cung cấp',
    partnerText: ticket.nha_cung_cap_id ? (ticket.nha_cung_cap_id.ten_ncc || ticket.nha_cung_cap_id.ma_ncc || '') : '',
    sourceLabel: 'Phiếu nhập gốc',
    sourceText: ticket.phieu_nhap_id ? ticket.phieu_nhap_id.ma_phieu_nhap : '',
    note: ticket.ghi_chu,
    totals: {
      quantity: items.reduce(function(sum, row) { return sum + Number(row.so_luong || 0); }, 0),
      value: Number(ticket.tong_tien_hang || ticket.tong_tien_tra || 0)
    },
    items: items.map(function(row) {
      return rowBase(row, { price: row.gia_tra_lai || row.don_gia || row.gia_nhap, total: row.thanh_tien });
    })
  };
}

async function loadInventoryCheck(id) {
  var ticket = await PhieuKiemKho.findById(id)
    .populate('cua_hang_id')
    .populate('kho_id')
    .populate('nguoi_tao_id')
    .lean();
  if (!ticket) return null;
  var items = await CTPhieuKiemKho.find({ phieu_kiem_kho_id: ticket._id })
    .populate('hang_hoa_id')
    .populate('lo_hang_id')
    .lean();
  return {
    title: 'Phiếu kiểm kho / điều chỉnh kho',
    heading: 'PHIẾU KIỂM KHO / ĐIỀU CHỈNH KHO',
    movement: 'Kiểm kho',
    code: ticket.ma_kiem_kho,
    date: ticket.ngay_kiem || ticket.created_at,
    warehouse: ticket.kho_id,
    store: ticket.cua_hang_id,
    creator: ticket.nguoi_tao_id,
    note: ticket.ghi_chu,
    isInventoryCheck: true,
    totals: {
      quantity: Number(ticket.tong_so_luong_lech || 0),
      value: Number(ticket.tong_gia_tri_lech || 0)
    },
    items: items.map(function(row) {
      var product = row.hang_hoa_id || {};
      return {
        ma_hang: product.ma_hang || '',
        ten_hang: product.ten_hang || '',
        thuoc_tinh: '',
        lo: lotName(row.lo_hang_id),
        ton_he_thong: Number(row.ton_kho_he_thong || 0),
        ton_thuc_te: Number(row.so_luong_thuc_te || 0),
        chenh_lech: Number(row.so_luong_lech || 0),
        gia_tri_lech: Number(row.gia_tri_lech || 0),
        ghi_chu: row.nguyen_nhan_lech || ''
      };
    })
  };
}

async function loadDestroy(id) {
  var ticket = await PhieuXuatHuy.findById(id)
    .populate('cua_hang_id')
    .populate('kho_id')
    .populate('nguoi_tao_id')
    .lean();
  if (!ticket) return null;
  var items = await CTXuatHuy.find({ phieu_xuat_huy_id: ticket._id }).populate('hang_hoa_id').populate('lo_hang_id').lean();
  return {
    title: 'Phiếu xuất hủy',
    heading: 'PHIẾU XUẤT HỦY',
    movement: 'Xuất kho',
    code: ticket.ma_xuat_huy,
    date: ticket.ngay_xuat || ticket.created_at,
    warehouse: ticket.kho_id,
    store: ticket.cua_hang_id,
    creator: ticket.nguoi_tao_id,
    reasonLabel: 'Lý do hủy',
    reasonText: ticket.ly_do_huy,
    note: ticket.ghi_chu,
    totals: { quantity: Number(ticket.tong_so_luong || 0), value: Number(ticket.tong_gia_tri || 0) },
    items: items.map(function(row) { return rowBase(row, { price: row.gia_von }); })
  };
}

async function loadInternalIssue(id) {
  var ticket = await PhieuXuatNoiBo.findById(id)
    .populate('cua_hang_id')
    .populate('kho_id')
    .populate('nguoi_tao_id')
    .lean();
  if (!ticket) return null;
  var items = await CTXuatNoiBo.find({ phieu_xuat_id: ticket._id }).populate('hang_hoa_id').populate('lo_hang_id').lean();
  return {
    title: 'Phiếu xuất kho nội bộ',
    heading: 'PHIẾU XUẤT KHO NỘI BỘ',
    movement: 'Xuất kho',
    code: ticket.ma_xuat_noi_bo,
    date: ticket.ngay_xuat || ticket.created_at,
    warehouse: ticket.kho_id,
    store: ticket.cua_hang_id,
    creator: ticket.nguoi_tao_id,
    partnerLabel: 'Người nhận',
    partnerText: ticket.nguoi_nhan || '',
    reasonLabel: 'Loại xuất',
    reasonText: ticket.loai_xuat || '',
    note: ticket.ghi_chu,
    totals: { quantity: Number(ticket.tong_so_luong || 0), value: Number(ticket.tong_gia_tri || 0) },
    items: items.map(function(row) { return rowBase(row, { price: row.gia_von }); })
  };
}

async function loadAllocation(id) {
  var ticket = await PhanBoHang.findById(id)
    .populate('cua_hang_id')
    .populate('kho_id')
    .populate('khach_hang_id')
    .populate('don_hang_id')
    .populate('nguoi_tao_id')
    .populate('nguoi_phan_bo_id')
    .lean();
  if (!ticket) return null;
  var items = await CTPhanBoHang.find({ phan_bo_hang_id: ticket._id }).populate('hang_hoa_id').populate('lo_hang_id').lean();
  return {
    title: 'Phiếu phân bổ / xuất phân bổ',
    heading: 'PHIẾU PHÂN BỔ / PHIẾU XUẤT PHÂN BỔ',
    movement: 'Xuất kho',
    code: ticket.ma_phan_bo,
    date: ticket.ngay_xac_nhan || ticket.created_at,
    warehouse: ticket.kho_id,
    store: ticket.cua_hang_id,
    creator: ticket.nguoi_phan_bo_id || ticket.nguoi_tao_id,
    partnerLabel: 'Khách hàng',
    partnerText: ticket.khach_hang_id ? (ticket.khach_hang_id.ten_khach_hang || ticket.khach_hang_id.ma_khach_hang || '') : '',
    sourceLabel: 'Đơn hàng',
    sourceText: ticket.don_hang_id ? ticket.don_hang_id.ma_don_hang : '',
    note: ticket.ghi_chu,
    totals: { quantity: Number(ticket.tong_so_luong || 0), value: Number(ticket.tong_thanh_tien || ticket.tong_tien_hang || 0) },
    items: items.map(function(row) { return rowBase(row, { price: row.don_gia_ban, total: row.thanh_tien }); })
  };
}

async function loadManualAdjustment(id) {
  var row = await LichSuKho.findById(id)
    .populate('cua_hang_id')
    .populate('kho_id')
    .populate('hang_hoa_id')
    .populate('lo_hang_id')
    .populate('nguoi_tao_id')
    .populate({
      path: 'gia_tri_thuoc_tinh_id',
      populate: { path: 'thuoc_tinh_id', select: 'ten_thuoc_tinh ma_thuoc_tinh' }
    })
    .lean();
  if (!row || row.loai_phieu !== 'dieu_chinh') return null;
  var qty = Number(row.so_luong_thay_doi || 0);
  return {
    title: 'Phiếu điều chỉnh kho',
    heading: 'PHIẾU ĐIỀU CHỈNH KHO',
    movement: qty >= 0 ? 'Nhập kho' : 'Xuất kho',
    code: row.ma_phieu || String(row._id),
    date: row.ngay || row.created_at,
    warehouse: row.kho_id,
    store: row.cua_hang_id,
    creator: row.nguoi_tao_id,
    note: row.ghi_chu,
    totals: { quantity: qty, value: Number(row.gia_tri_thay_doi || 0) },
    items: [rowBase(row, {
      qty: qty,
      price: qty ? Math.abs(Number(row.gia_tri_thay_doi || 0) / qty) : 0,
      total: Number(row.gia_tri_thay_doi || 0),
      note: row.ghi_chu
    })]
  };
}

var LOADERS = {
  'ban-hang': loadSale,
  'hoa-don-ban': loadRetailInvoice,
  'tra-hang-ban': loadSalesReturn,
  'tra-hang-nhap': loadPurchaseReturn,
  'kiem-kho': loadInventoryCheck,
  'xuat-huy': loadDestroy,
  'xuat-noi-bo': loadInternalIssue,
  'phan-bo': loadAllocation,
  'dieu-chinh': loadManualAdjustment
};

async function buildVoucherData(req) {
  var type = String(req.params.type || '').trim();
  var id = String(req.params.id || '').trim();
  if (!LOADERS[type] || !isObjectId(id)) return null;
  var voucher = await LOADERS[type](id);
  if (!voucher) return null;
  var store = asPlain(voucher.store);
  if (!store && voucher.store) store = await CuaHang.findById(voucher.store).lean();
  voucher.store = store || {};
  voucher.business = await loadBusiness(voucher.store);
  voucher.type = type;
  voucher.id = id;
  voucher.embeddedPrint = String(req.query && req.query.embed || '') === '1';
  return {
    title: voucher.title,
    activeMenu: 'hang-hoa',
    user: req.user,
    voucher: voucher
  };
}

exports.print = async function(req, res, next) {
  try {
    var data = await buildVoucherData(req);
    if (!data) return res.status(404).send('Không tìm thấy chứng từ kho');
    return res.render('stock-voucher/print', data);
  } catch (error) {
    next(error);
  }
};

exports.pdf = async function(req, res, next) {
  try {
    var data = await buildVoucherData(req);
    if (!data) return res.status(404).send('Không tìm thấy chứng từ kho');
    var viewPath = path.join(__dirname, '..', 'views', 'stock-voucher', 'print.ejs');
    var html = await pdfService.renderViewToHtml(viewPath, data);
    var buffer = await pdfService.generatePdfFromHtml(html, {
      format: 'A4',
      printBackground: true,
      margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' }
    });
    var filename = (data.voucher.code || data.voucher.type || 'chung-tu-kho').replace(/[^\w.-]+/g, '-') + '.pdf';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
    return res.send(Buffer.from(buffer));
  } catch (error) {
    next(error);
  }
};
