const mongoose = require('mongoose');
const ExcelJS = require('exceljs');
const {
  CuaHang,
  Kho,
  NguoiDung,
  NhaCungCap,
  HangHoa,
  DonViTinh,
  TonKho,
  TonKhoLo,
  LoHang,
  PhieuNhap,
  CTPhieuNhap,
  PhieuTraHangNhap,
  CTPhieuTraHangNhap,
  CongNoNhaCungCap,
  SoQuy,
  PhieuThuChi
} = require('../models/kiot.model');
const { truTonKho, congTonKho } = require('../services/kho.service');
const { taoPhieuThuChi, ensureDefaultSoQuy } = require('../services/soQuy.service');

const RETURN_IMPORT_STATUS_MAP = {
  draft: 'Phiếu tạm',
  completed: 'Đã trả hàng',
  cancelled: 'Đã hủy'
};

const RETURN_IMPORT_EXPORT_COLUMNS = [
  { header: 'Mã trả hàng nhập', key: 'ma_phieu_tra_nhap' },
  { header: 'Thời gian trả', key: 'thoi_gian_tra' },
  { header: 'Nhà cung cấp', key: 'nha_cung_cap' },
  { header: 'Mã phiếu nhập', key: 'ma_phieu_nhap' },
  { header: 'Kho', key: 'kho' },
  { header: 'Người tạo', key: 'nguoi_tao' },
  { header: 'Người trả', key: 'nguoi_tra' },
  { header: 'Tổng tiền hàng', key: 'tong_tien_hang', style: { numFmt: '#,##0' } },
  { header: 'Giảm giá', key: 'giam_gia', style: { numFmt: '#,##0.##' } },
  { header: 'NCC cần trả', key: 'ncc_can_tra', style: { numFmt: '#,##0' } },
  { header: 'NCC đã trả', key: 'ncc_da_tra', style: { numFmt: '#,##0' } },
  { header: 'Tính vào công nợ', key: 'tinh_vao_cong_no' },
  { header: 'Tổng tiền trả', key: 'tong_tien_tra', style: { numFmt: '#,##0' } },
  { header: 'Lý do', key: 'ly_do' },
  { header: 'Ghi chú', key: 'ghi_chu' },
  { header: 'Trạng thái', key: 'trang_thai' },
  { header: 'Mã hàng', key: 'ma_hang' },
  { header: 'Tên hàng', key: 'ten_hang' },
  { header: 'Thương hiệu', key: 'thuong_hieu' },
  { header: 'Đơn vị tính', key: 'don_vi_tinh' },
  { header: 'Lô hàng', key: 'lo_hang' },
  { header: 'Số lượng trả', key: 'so_luong_tra', style: { numFmt: '#,##0.##' } },
  { header: 'Đơn giá', key: 'don_gia', style: { numFmt: '#,##0' } },
  { header: 'Giá nhập', key: 'gia_nhap', style: { numFmt: '#,##0' } },
  { header: 'Giá trả lại', key: 'gia_tra_lai', style: { numFmt: '#,##0' } },
  { header: 'Thành tiền', key: 'thanh_tien', style: { numFmt: '#,##0' } },
  { header: 'Ghi chú dòng', key: 'ghi_chu_dong' }
];

function isObjectId(value) {
  return mongoose.Types.ObjectId.isValid(String(value || '').trim());
}

async function resolveStoreId(req) {
  const sessionStoreId = req && req.session ? String(req.session.cua_hang_id || '').trim() : '';
  if (isObjectId(sessionStoreId)) return sessionStoreId;
  const userStoreId = req && req.user ? String(req.user.cua_hang_id || '').trim() : '';
  if (isObjectId(userStoreId)) return userStoreId;
  const activeStore = await CuaHang.findOne({ trang_thai: 'active' }).sort({ created_at: 1 }).lean();
  return activeStore ? String(activeStore._id) : '';
}

function parseMoney(raw) {
  if (raw == null) return 0;
  const value = Number(String(raw).replace(/\./g, '').replace(/,/g, '').trim());
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

function parseItems(raw) {
  let parsed = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch (_) {
      parsed = [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.map(item => ({
    hang_hoa_id: String(item.hang_hoa_id || '').trim(),
    lo_hang_id: String(item.lo_hang_id || '').trim(),
    phieu_nhap_id: String(item.phieu_nhap_id || '').trim(),
    ct_phieu_nhap_id: String(item.ct_phieu_nhap_id || '').trim(),
    gia_tri_thuoc_tinh_id: String(item.gia_tri_thuoc_tinh_id || '').trim(),
    so_luong: Number(item.so_luong || 0),
    gia_nhap: parseMoney(item.gia_nhap || item.don_gia || item.don_gia_nhap || 0),
    gia_tra_lai: parseMoney(item.gia_tra_lai || item.don_gia || item.don_gia_nhap || 0),
    ghi_chu: String(item.ghi_chu || '').trim()
  })).filter(item => isObjectId(item.hang_hoa_id));
}

function computeTotals(items, discountValue, discountType) {
  const tongTienHang = items.reduce((sum, item) => {
    const line = Math.max(0, Number(item.so_luong || 0) * Number(item.gia_tra_lai || 0));
    return sum + line;
  }, 0);
  let giamGia = Number(discountValue || 0);
  if (!Number.isFinite(giamGia) || giamGia < 0) giamGia = 0;
  if (discountType === 'percent') giamGia = Math.min(100, giamGia);
  const discountAmount = discountType === 'percent'
    ? Math.floor(tongTienHang * giamGia / 100)
    : Math.min(Math.floor(giamGia), tongTienHang);
  const nccCanTra = Math.max(0, Math.floor(tongTienHang - discountAmount));
  return {
    tong_tien_hang: Math.floor(tongTienHang),
    giam_gia: Math.floor(giamGia),
    ncc_can_tra: nccCanTra,
    tong_tien_tra: nccCanTra
  };
}

async function makeReturnCode() {
  const last = await PhieuTraHangNhap.findOne({ ma_phieu_tra_nhap: /^THN\d+$/ })
    .sort({ ma_phieu_tra_nhap: -1 })
    .lean();
  const next = last && last.ma_phieu_tra_nhap
    ? Number(String(last.ma_phieu_tra_nhap).replace(/\D/g, '')) + 1
    : 1;
  return 'THN' + String(next).padStart(6, '0');
}

function startOfMonth() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
}

function endOfDay(value) {
  const d = new Date(value);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

function formatDate(value) {
  if (!value) return '--';
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
  return 'Đã trả hàng';
}

function formatExportDate(value) {
  if (!value) return '';
  return new Date(value).toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

function getUserName(user) {
  return user ? (user.ho_ten || user.username || user.email || '') : '';
}

function getLotName(lot) {
  return lot ? (lot.ma_lo || lot.ten_lo || '') : '';
}

function buildExportRow(ticket, detail) {
  const product = detail && detail.hang_hoa_id ? detail.hang_hoa_id : {};
  const detailUnit = detail && detail.don_vi_tinh_id ? detail.don_vi_tinh_id : null;
  const productUnit = product.don_vi_tinh_id || null;
  return {
    ma_phieu_tra_nhap: ticket.ma_phieu_tra_nhap || '',
    thoi_gian_tra: formatExportDate(ticket.ngay_tra || ticket.created_at),
    nha_cung_cap: ticket.nha_cung_cap_id ? (ticket.nha_cung_cap_id.ten_ncc || ticket.nha_cung_cap_id.ma_ncc || '') : '',
    ma_phieu_nhap: ticket.phieu_nhap_id ? (ticket.phieu_nhap_id.ma_phieu_nhap || '') : '',
    kho: ticket.kho_id ? (ticket.kho_id.ten_kho || ticket.kho_id.ma_kho || '') : '',
    nguoi_tao: getUserName(ticket.nguoi_tao_id),
    nguoi_tra: getUserName(ticket.nguoi_tra_id),
    tong_tien_hang: Number(ticket.tong_tien_hang || 0),
    giam_gia: Number(ticket.giam_gia || 0),
    ncc_can_tra: Number(ticket.ncc_can_tra || 0),
    ncc_da_tra: Number(ticket.ncc_da_tra || 0),
    tinh_vao_cong_no: ticket.tinh_vao_cong_no ? 'Có' : 'Không',
    tong_tien_tra: Number(ticket.tong_tien_tra || 0),
    ly_do: ticket.ly_do || '',
    ghi_chu: ticket.ghi_chu || '',
    trang_thai: RETURN_IMPORT_STATUS_MAP[ticket.trang_thai] || ticket.trang_thai || '',
    ma_hang: product.ma_hang || '',
    ten_hang: product.ten_hang || '',
    thuong_hieu: product.thuong_hieu_id ? product.thuong_hieu_id.ten_thuong_hieu : '',
    don_vi_tinh: detailUnit
      ? (detailUnit.ten_don_vi || detailUnit.ma_don_vi || '')
      : (productUnit ? (productUnit.ten_don_vi || productUnit.ma_don_vi || '') : ''),
    lo_hang: getLotName(detail && detail.lo_hang_id),
    so_luong_tra: detail ? Number(detail.so_luong || 0) : 0,
    don_gia: detail ? Number(detail.don_gia || 0) : 0,
    gia_nhap: detail ? Number(detail.gia_nhap || 0) : 0,
    gia_tra_lai: detail ? Number(detail.gia_tra_lai || 0) : 0,
    thanh_tien: detail ? Number(detail.thanh_tien || 0) : 0,
    ghi_chu_dong: detail ? (detail.ghi_chu || '') : ''
  };
}

function applyWorksheetFormat(worksheet) {
  const headerRow = worksheet.getRow(1);
  headerRow.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FF111827' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAF3FF' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFD8E8FB' } },
      bottom: { style: 'thin', color: { argb: 'FFD8E8FB' } },
      left: { style: 'thin', color: { argb: 'FFD8E8FB' } },
      right: { style: 'thin', color: { argb: 'FFD8E8FB' } }
    };
  });
  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: RETURN_IMPORT_EXPORT_COLUMNS.length }
  };
  worksheet.views = [{ state: 'frozen', ySplit: 1 }];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    row.eachCell(cell => {
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        right: { style: 'thin', color: { argb: 'FFE5E7EB' } }
      };
      cell.alignment = { vertical: 'middle' };
    });
  });
  worksheet.columns.forEach(column => {
    let maxLength = String(column.header || '').length;
    column.eachCell({ includeEmpty: true }, cell => {
      const value = cell.value == null ? '' : String(cell.value);
      maxLength = Math.max(maxLength, value.length);
    });
    column.width = Math.min(Math.max(maxLength + 2, 12), 36);
  });
}

async function buildListFilter(req, storeId) {
  const query = {};
  if (isObjectId(storeId)) query.cua_hang_id = storeId;
  const q = String(req.query.q || '').trim();
  if (q) query.ma_phieu_tra_nhap = { $regex: q, $options: 'i' };

  const statuses = Array.isArray(req.query.trang_thai)
    ? req.query.trang_thai
    : (req.query.trang_thai ? [req.query.trang_thai] : []);
  const cleanStatuses = statuses.filter(x => ['draft', 'completed', 'cancelled'].includes(x));
  if (cleanStatuses.length) query.trang_thai = { $in: cleanStatuses };

  const timeType = String(req.query.time_type || '').trim();
  const dateFrom = String(req.query.date_from || '').trim();
  const dateTo = String(req.query.date_to || '').trim();
  if (timeType === 'this_month') {
    query.ngay_tra = { $gte: startOfMonth(), $lte: endOfDay(new Date()) };
  } else if (dateFrom || dateTo) {
    query.ngay_tra = {};
    if (dateFrom) query.ngay_tra.$gte = new Date(dateFrom + 'T00:00:00');
    if (dateTo) query.ngay_tra.$lte = endOfDay(dateTo + 'T00:00:00');
  }

  if (isObjectId(req.query.nguoi_tao)) query.nguoi_tao_id = req.query.nguoi_tao;
  if (isObjectId(req.query.nguoi_tra)) query.nguoi_tra_id = req.query.nguoi_tra;
  return query;
}

async function loadExportReturns(filter) {
  const returns = await PhieuTraHangNhap.find(filter)
    .populate({ path: 'nha_cung_cap_id', select: 'ma_ncc ten_ncc' })
    .populate({ path: 'phieu_nhap_id', select: 'ma_phieu_nhap' })
    .populate({ path: 'kho_id', select: 'ma_kho ten_kho' })
    .populate({ path: 'nguoi_tao_id', select: 'ho_ten username email' })
    .populate({ path: 'nguoi_tra_id', select: 'ho_ten username email' })
    .sort({ ngay_tra: -1, created_at: -1 });
  const returnIds = returns.map(row => row._id);
  const details = returnIds.length
    ? await CTPhieuTraHangNhap.find({ phieu_tra_nhap_id: { $in: returnIds } })
      .populate({
        path: 'hang_hoa_id',
        populate: [
          { path: 'thuong_hieu_id' },
          { path: 'don_vi_tinh_id' }
        ]
      })
      .populate({ path: 'don_vi_tinh_id', select: 'ma_don_vi ten_don_vi' })
      .populate({ path: 'lo_hang_id', select: 'ma_lo ten_lo' })
      .sort({ created_at: 1 })
    : [];
  const detailMap = details.reduce((map, detail) => {
    const key = String(detail.phieu_tra_nhap_id);
    if (!map[key]) map[key] = [];
    map[key].push(detail);
    return map;
  }, {});
  return { returns, detailMap };
}

async function sendReturnImportWorkbook(res, filename, returns, detailMap) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Trả hàng nhập');
  worksheet.columns = RETURN_IMPORT_EXPORT_COLUMNS;

  returns.forEach(ticket => {
    const details = detailMap[String(ticket._id)] || [];
    if (!details.length) {
      worksheet.addRow(buildExportRow(ticket, null));
      return;
    }
    details.forEach(detail => worksheet.addRow(buildExportRow(ticket, detail)));
  });

  applyWorksheetFormat(worksheet);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
  await workbook.xlsx.write(res);
  res.end();
}

async function loadCreateData(storeId) {
  const storeFilter = isObjectId(storeId) ? { cua_hang_id: storeId } : {};
  let [warehouses, suppliers, users, units, products, lots, inventories, lotInventories, receipts] = await Promise.all([
    Kho.find(storeFilter).sort({ ten_kho: 1, ma_kho: 1 }).lean(),
    NhaCungCap.find(storeFilter).sort({ ten_ncc: 1, ma_ncc: 1 }).lean(),
    NguoiDung.find(storeFilter).sort({ ho_ten: 1, email: 1 }).lean(),
    DonViTinh.find(Object.assign({}, storeFilter, { trang_thai: 'active' })).sort({ ten_don_vi: 1 }).lean(),
    HangHoa.find(Object.assign({}, storeFilter, { trang_thai: 'active' }))
      .select('ma_hang ten_hang gia_nhap_cuoi gia_von don_vi_tinh_id nha_cung_cap_id quan_ly_theo_lo')
      .sort({ ma_hang: 1, ten_hang: 1 })
      .lean(),
    LoHang.find(Object.assign({}, storeFilter, { trang_thai: { $ne: 'huy' }, so_luong_con_lai: { $gt: 0 } }))
      .sort({ han_su_dung: 1, ngay_nhap: 1 })
      .lean(),
    TonKho.find(storeFilter).lean(),
    TonKhoLo.find(Object.assign({}, storeFilter, { so_luong: { $gt: 0 } })).lean(),
    PhieuNhap.find(Object.assign({}, storeFilter, { trang_thai: 'completed' }))
      .select('ma_phieu_nhap nha_cung_cap_id kho_id')
      .sort({ ngay_nhap: -1, created_at: -1 })
      .lean()
  ]);

  if (!products.length && isObjectId(storeId)) {
    products = await HangHoa.find({ trang_thai: 'active' })
      .select('ma_hang ten_hang gia_nhap_cuoi gia_von don_vi_tinh_id nha_cung_cap_id quan_ly_theo_lo')
      .sort({ ma_hang: 1, ten_hang: 1 })
      .lean();
  }

  const unitMap = units.reduce((map, unit) => {
    map[String(unit._id)] = unit.ten_don_vi || unit.ma_don_vi || '';
    return map;
  }, {});
  const invMap = inventories.reduce((map, row) => {
    map[String(row.kho_id) + ':' + String(row.hang_hoa_id)] = Number(row.so_luong || 0);
    return map;
  }, {});
  const lotInvMap = lotInventories.reduce((map, row) => {
    map[String(row.lo_hang_id)] = Number(row.so_luong || 0);
    return map;
  }, {});
  const lotMapByProduct = lots.reduce((map, lot) => {
    const key = String(lot.hang_hoa_id);
    if (!map[key]) map[key] = [];
    map[key].push({
      _id: String(lot._id),
      ma_lo: lot.ma_lo || '',
      ten_lo: lot.ten_lo || '',
      kho_id: String(lot.kho_id || ''),
      so_luong: lotInvMap[String(lot._id)] || Number(lot.so_luong_con_lai || 0),
      han_su_dung: lot.han_su_dung || null
    });
    return map;
  }, {});

  const productOptions = products.map(product => ({
    _id: String(product._id),
    ma_hang: product.ma_hang || '',
    ten_hang: product.ten_hang || '',
    don_vi_tinh_id: product.don_vi_tinh_id ? String(product.don_vi_tinh_id) : '',
    don_vi_tinh: unitMap[String(product.don_vi_tinh_id)] || '',
    nha_cung_cap_id: product.nha_cung_cap_id ? String(product.nha_cung_cap_id) : '',
    gia_nhap: Number(product.gia_nhap_cuoi || product.gia_von || 0),
    quan_ly_theo_lo: Boolean(product.quan_ly_theo_lo),
    ton_kho_by_kho: warehouses.reduce((map, warehouse) => {
      map[String(warehouse._id)] = invMap[String(warehouse._id) + ':' + String(product._id)] || 0;
      return map;
    }, {}),
    lots: lotMapByProduct[String(product._id)] || []
  }));

  return { warehouses, suppliers, users, productOptions, receipts };
}

async function validateReturnItems(params) {
  const { items, storeId, khoId, phieuNhapId, returnId, ignorePhieuTraNhapIds } = params;
  const ignoreSet = new Set((ignorePhieuTraNhapIds || []).filter(id => isObjectId(id)).map(id => String(id)));
  if (!items.length) throw new Error('Vui lòng chọn ít nhất một hàng hóa cần trả');
  if (!isObjectId(khoId)) throw new Error('Vui lòng chọn kho trả hàng');

  const purchase = isObjectId(phieuNhapId)
    ? await PhieuNhap.findById(phieuNhapId).select('_id nha_cung_cap_id kho_id').lean()
    : null;
  if (isObjectId(phieuNhapId) && !purchase) {
    throw new Error('Phiếu nhập gốc không hợp lệ');
  }

  const productIds = items.map(item => item.hang_hoa_id);
  const products = await HangHoa.find({ _id: { $in: productIds } })
    .select('_id ten_hang don_vi_tinh_id quan_ly_theo_lo')
    .lean();
  const productMap = products.reduce((map, product) => {
    map[String(product._id)] = product;
    return map;
  }, {});

  const normalized = [];
  for (const item of items) {
    const product = productMap[item.hang_hoa_id];
    if (!product) throw new Error('Hàng hóa không hợp lệ');
    if (!Number.isFinite(item.so_luong) || item.so_luong <= 0) {
      throw new Error('Số lượng trả phải lớn hơn 0');
    }
    item.so_luong = Math.floor(item.so_luong);
    if (item.so_luong <= 0) throw new Error('Số lượng trả phải lớn hơn 0');
    if (!Number.isFinite(item.gia_tra_lai) || item.gia_tra_lai < 0) item.gia_tra_lai = 0;
    if (!Number.isFinite(item.gia_nhap) || item.gia_nhap < 0) item.gia_nhap = item.gia_tra_lai;

    const inventory = await TonKho.findOne({ kho_id: khoId, hang_hoa_id: item.hang_hoa_id }).lean();
    if (!inventory || Number(inventory.so_luong || 0) < item.so_luong) {
      throw new Error('Không cho trả vượt tồn kho hiện tại');
    }

    let lotId = isObjectId(item.lo_hang_id) ? item.lo_hang_id : '';
    if (product.quan_ly_theo_lo) {
      if (lotId) {
        const lotInventory = await TonKhoLo.findOne({ kho_id: khoId, hang_hoa_id: item.hang_hoa_id, lo_hang_id: lotId }).lean();
        const lot = await LoHang.findById(lotId).lean();
        if (!lotInventory || Number(lotInventory.so_luong || 0) < item.so_luong || !lot || Number(lot.so_luong_con_lai || 0) < item.so_luong) {
          throw new Error('Không cho tồn kho/lô âm');
        }
      } else {
        const availableLots = await TonKhoLo.find({ kho_id: khoId, hang_hoa_id: item.hang_hoa_id, so_luong: { $gt: 0 } })
          .populate('lo_hang_id')
          .lean();
        const availableQty = availableLots.reduce((sum, row) => sum + Number(row.so_luong || 0), 0);
        if (availableQty < item.so_luong) throw new Error('Tồn kho theo lô không đủ để tự chọn FEFO');
      }
    } else {
      lotId = '';
    }

    normalized.push({
      phieu_nhap_id: isObjectId(item.phieu_nhap_id) ? item.phieu_nhap_id : (isObjectId(phieuNhapId) ? phieuNhapId : undefined),
      ct_phieu_nhap_id: isObjectId(item.ct_phieu_nhap_id) ? item.ct_phieu_nhap_id : undefined,
      hang_hoa_id: item.hang_hoa_id,
      lo_hang_id: lotId || undefined,
      gia_tri_thuoc_tinh_id: isObjectId(item.gia_tri_thuoc_tinh_id) ? item.gia_tri_thuoc_tinh_id : undefined,
      don_vi_tinh_id: product.don_vi_tinh_id || undefined,
      so_luong: item.so_luong,
      don_gia: item.gia_tra_lai,
      gia_nhap: item.gia_nhap,
      gia_tra_lai: item.gia_tra_lai,
      thanh_tien: Math.floor(item.so_luong * item.gia_tra_lai),
      ghi_chu: item.ghi_chu || ''
    });
  }

  if (isObjectId(phieuNhapId)) {
    const purchaseDetails = await CTPhieuNhap.find({ phieu_nhap_id: phieuNhapId }).lean();
    const currentReturnFilter = { phieu_nhap_id: phieuNhapId };
    if (ignoreSet.size) {
      currentReturnFilter.phieu_tra_nhap_id = { $nin: Array.from(ignoreSet) };
    } else if (returnId && isObjectId(returnId)) {
      currentReturnFilter.phieu_tra_nhap_id = { $ne: returnId };
    }
    const completedReturns = await CTPhieuTraHangNhap.find(currentReturnFilter)
      .populate({ path: 'phieu_tra_nhap_id', select: 'trang_thai' })
      .lean();

    const imported = {};
    const importedByProduct = {};
    purchaseDetails.forEach(row => {
      const key = String(row.hang_hoa_id) + ':' + String(row.lo_hang_id || '');
      imported[key] = (imported[key] || 0) + Number(row.so_luong || 0);
      const productKey = String(row.hang_hoa_id);
      importedByProduct[productKey] = (importedByProduct[productKey] || 0) + Number(row.so_luong || 0);
    });
    const returned = {};
    const returnedByProduct = {};
    completedReturns.forEach(row => {
      const ptId0 = row.phieu_tra_nhap_id && (row.phieu_tra_nhap_id._id || row.phieu_tra_nhap_id);
      if (ptId0 && ignoreSet.has(String(ptId0))) return;
      if (row.phieu_tra_nhap_id && row.phieu_tra_nhap_id.trang_thai === 'cancelled') return;
      const key = String(row.hang_hoa_id) + ':' + String(row.lo_hang_id || '');
      returned[key] = (returned[key] || 0) + Number(row.so_luong || 0);
      const productKey = String(row.hang_hoa_id);
      returnedByProduct[productKey] = (returnedByProduct[productKey] || 0) + Number(row.so_luong || 0);
    });
    const requested = {};
    const requestedByProduct = {};
    normalized.forEach(row => {
      const key = String(row.hang_hoa_id) + ':' + String(row.lo_hang_id || '');
      requested[key] = (requested[key] || 0) + Number(row.so_luong || 0);
      const productKey = String(row.hang_hoa_id);
      requestedByProduct[productKey] = (requestedByProduct[productKey] || 0) + Number(row.so_luong || 0);
    });
    Object.keys(requested).forEach(key => {
      const parts = key.split(':');
      if (!parts[1]) return;
      const canReturn = Number(imported[key] || 0) - Number(returned[key] || 0);
      if (requested[key] > canReturn) {
        throw new Error('Không cho trả vượt số lượng đã nhập còn có thể trả');
      }
    });
    Object.keys(requestedByProduct).forEach(key => {
      const canReturn = Number(importedByProduct[key] || 0) - Number(returnedByProduct[key] || 0);
      if (requestedByProduct[key] > canReturn) {
        throw new Error('Không cho trả vượt số lượng đã nhập còn có thể trả');
      }
    });

    const detailMap = purchaseDetails.reduce((map, row) => {
      map[String(row._id)] = row;
      return map;
    }, {});
    const returnedByDetail = {};
    completedReturns.forEach(row => {
      const ptId2 = row.phieu_tra_nhap_id && (row.phieu_tra_nhap_id._id || row.phieu_tra_nhap_id);
      if (ptId2 && ignoreSet.has(String(ptId2))) return;
      if (row.phieu_tra_nhap_id && row.phieu_tra_nhap_id.trang_thai === 'cancelled') return;
      if (!row.ct_phieu_nhap_id) return;
      const key = String(row.ct_phieu_nhap_id);
      returnedByDetail[key] = (returnedByDetail[key] || 0) + Number(row.so_luong || 0);
    });
    const requestedByDetail = {};
    normalized.forEach(row => {
      if (!row.ct_phieu_nhap_id) throw new Error('Dòng trả hàng thiếu chi tiết phiếu nhập gốc');
      const key = String(row.ct_phieu_nhap_id);
      const detail = detailMap[key];
      if (!detail) throw new Error('Chi tiết phiếu nhập gốc không hợp lệ');
      if (String(detail.hang_hoa_id) !== String(row.hang_hoa_id)) {
        throw new Error('Hàng trả không khớp với phiếu nhập gốc');
      }
      if (String(detail.lo_hang_id || '') !== String(row.lo_hang_id || '')) {
        throw new Error('Lô hàng trả không khớp với phiếu nhập gốc');
      }
      requestedByDetail[key] = (requestedByDetail[key] || 0) + Number(row.so_luong || 0);
    });
    Object.keys(requestedByDetail).forEach(key => {
      const detail = detailMap[key];
      const canReturn = Number(detail.so_luong || 0) - Number(returnedByDetail[key] || 0);
      if (requestedByDetail[key] > canReturn) {
        throw new Error('Không cho trả vượt số lượng còn có thể trả của dòng phiếu nhập');
      }
    });
  }

  return normalized;
}

async function persistDetails(returnId, rows) {
  await CTPhieuTraHangNhap.deleteMany({ phieu_tra_nhap_id: returnId });
  if (!rows.length) return [];
  return CTPhieuTraHangNhap.insertMany(rows.map(row => Object.assign({}, row, { phieu_tra_nhap_id: returnId })));
}

async function completeInventory(returnDoc, rows, userId) {
  for (const row of rows) {
    await truTonKho({
      kho_id: returnDoc.kho_id,
      hang_hoa_id: row.hang_hoa_id,
      lo_hang_id: row.lo_hang_id,
      so_luong: row.so_luong,
      gia_von: row.gia_tra_lai || row.gia_nhap || row.don_gia || 0,
      nguoi_tao_id: userId,
      loai_phieu: 'tra_hang_nhap',
      ma_phieu: returnDoc.ma_phieu_tra_nhap,
      ghi_chu: returnDoc.ghi_chu || 'Trả hàng nhập'
    });
  }
}

async function applySupplierDebt(returnDoc) {
  if (!returnDoc.tinh_vao_cong_no || !returnDoc.nha_cung_cap_id) return;
  const amount = Math.max(0, Number(returnDoc.ncc_can_tra || 0) - Number(returnDoc.ncc_da_tra || 0));
  if (amount <= 0) return;
  await CongNoNhaCungCap.create({
    cua_hang_id: returnDoc.cua_hang_id,
    nha_cung_cap_id: returnDoc.nha_cung_cap_id,
    phieu_nhap_id: returnDoc.phieu_nhap_id || undefined,
    phieu_tra_nhap_id: returnDoc._id,
    so_tien: amount,
    loai: 'giam_no',
    ghi_chu: 'Giảm nợ từ phiếu trả hàng nhập ' + returnDoc.ma_phieu_tra_nhap,
    ngay: returnDoc.ngay_tra || new Date()
  });
  const supplier = await NhaCungCap.findById(returnDoc.nha_cung_cap_id).select('tong_no').lean();
  if (supplier && typeof supplier.tong_no === 'number') {
    await NhaCungCap.updateOne(
      { _id: returnDoc.nha_cung_cap_id },
      { $inc: { tong_no: -amount } }
    );
  }
}

async function createSupplierRefundReceipt(returnDoc, userId) {
  if (!returnDoc.nha_cung_cap_id) return;
  const amount = Number(returnDoc.ncc_da_tra || 0);
  if (!Number.isFinite(amount) || amount <= 0) return;
  const existed = await mongoose.models.PhieuThuChi.findOne({
    phieu_tra_hang_nhap_id: returnDoc._id,
    loai_phieu: 'thu'
  }).lean();
  if (existed) return;
  const cashBook = await ensureDefaultSoQuy(returnDoc.cua_hang_id);
  await taoPhieuThuChi({
    loai_phieu: 'thu',
    loai_thu_chi: 'NCC hoan tien tra hang nhap',
    gia_tri: amount,
    so_quy_id: cashBook._id,
    cua_hang_id: returnDoc.cua_hang_id,
    nguoi_tao_id: userId,
    nha_cung_cap_id: returnDoc.nha_cung_cap_id,
    phieu_nhap_id: returnDoc.phieu_nhap_id || undefined,
    phieu_tra_hang_nhap_id: returnDoc._id,
    ma_chung_tu_goc: returnDoc.ma_phieu_tra_nhap,
    nhom_doi_tuong: 'nha_cung_cap',
    phuong_thuc_thanh_toan: 'tien_mat',
    hach_toan: returnDoc.tinh_vao_cong_no
  });
}

/** Hoàn tác tồn kho, công nợ, phiếu thu khi hủy phiếu đã hoàn thành */
async function rollbackReturnImportEffects(returnDoc, userId) {
  if (!returnDoc || String(returnDoc.trang_thai) !== 'completed') return;
  const rows = await CTPhieuTraHangNhap.find({ phieu_tra_nhap_id: returnDoc._id }).lean();
  for (const row of rows) {
    await congTonKho({
      kho_id: returnDoc.kho_id,
      hang_hoa_id: row.hang_hoa_id,
      lo_hang_id: row.lo_hang_id,
      so_luong: row.so_luong,
      gia_von: row.gia_tra_lai || row.gia_nhap || row.don_gia || 0,
      nguoi_tao_id: userId,
      loai_phieu: 'dieu_chinh',
      ma_phieu: String(returnDoc.ma_phieu_tra_nhap || ''),
      ghi_chu: 'Hoàn tồn kho — hủy phiếu trả hàng nhập'
    });
  }

  const receipts = await PhieuThuChi.find({ phieu_tra_hang_nhap_id: returnDoc._id }).lean();
  for (const rec of receipts) {
    const linked = await CongNoNhaCungCap.find({ phieu_thu_chi_id: rec._id }).lean();
    for (const c of linked) {
      if (!c.nha_cung_cap_id) continue;
      const st = Number(c.so_tien || 0);
      if (c.loai === 'giam_no') {
        await NhaCungCap.updateOne({ _id: c.nha_cung_cap_id }, { $inc: { tong_no: st } });
      } else if (c.loai === 'thanh_toan') {
        await NhaCungCap.updateOne({ _id: c.nha_cung_cap_id }, { $inc: { tong_no: -st } });
      }
    }
    await CongNoNhaCungCap.deleteMany({ phieu_thu_chi_id: rec._id });
    const amt = Number(rec.gia_tri || 0);
    if (rec.loai_phieu === 'thu' && rec.so_quy_id && amt > 0) {
      await SoQuy.findByIdAndUpdate(rec.so_quy_id, { $inc: { so_du: -amt } });
    }
    await PhieuThuChi.findByIdAndDelete(rec._id);
  }

  const standalone = await CongNoNhaCungCap.find({
    phieu_tra_nhap_id: returnDoc._id,
    $or: [{ phieu_thu_chi_id: { $exists: false } }, { phieu_thu_chi_id: null }]
  }).lean();
  for (const c of standalone) {
    if (c.loai === 'giam_no' && c.nha_cung_cap_id) {
      await NhaCungCap.updateOne({ _id: c.nha_cung_cap_id }, { $inc: { tong_no: Number(c.so_tien || 0) } });
    }
  }
  await CongNoNhaCungCap.deleteMany({
    phieu_tra_nhap_id: returnDoc._id,
    $or: [{ phieu_thu_chi_id: { $exists: false } }, { phieu_thu_chi_id: null }]
  });
}

function slugReturnExportFilename(ma) {
  var s = String(ma || 'phieu').trim().replace(/[/\\?%*:|"<>]/g, '-').replace(/\s+/g, '-');
  s = s.replace(/-+/g, '-').replace(/^-|-$/g, '');
  return s || 'phieu';
}

async function sendSingleReturnDetailWorkbook(res, ticket, details) {
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Chi tiết');
  var rowIdx = 1;
  function addPair(label, value) {
    ws.getCell(rowIdx, 1).value = label;
    ws.getCell(rowIdx, 2).value = value == null ? '' : value;
    rowIdx += 1;
  }
  addPair('Mã phiếu trả hàng nhập', ticket.ma_phieu_tra_nhap || '');
  addPair('Trạng thái', RETURN_IMPORT_STATUS_MAP[ticket.trang_thai] || ticket.trang_thai || '');
  addPair('Ngày trả', formatExportDate(ticket.ngay_tra || ticket.created_at));
  addPair('Nhà cung cấp', ticket.nha_cung_cap_id ? (ticket.nha_cung_cap_id.ten_ncc || ticket.nha_cung_cap_id.ma_ncc || '') : '');
  addPair('Kho', ticket.kho_id ? (ticket.kho_id.ten_kho || ticket.kho_id.ma_kho || '') : '');
  addPair('Phiếu nhập gốc', ticket.phieu_nhap_id ? (ticket.phieu_nhap_id.ma_phieu_nhap || '') : '');
  addPair('Người tạo', getUserName(ticket.nguoi_tao_id));
  addPair('Người trả', getUserName(ticket.nguoi_tra_id));
  addPair('Lý do', ticket.ly_do || '');
  addPair('Ghi chú', ticket.ghi_chu || '');
  rowIdx += 1;
  addPair('--- Chi tiết hàng ---', '');
  var hdr = ['Mã hàng', 'Tên hàng', 'Lô', 'Số lượng', 'Đơn giá', 'Giá nhập', 'Giá trả lại', 'Thành tiền', 'Ghi chú dòng'];
  hdr.forEach(function(h, i) {
    ws.getCell(rowIdx, i + 1).value = h;
  });
  rowIdx += 1;
  (details || []).forEach(function(d) {
    var p = d.hang_hoa_id || {};
    var lot = d.lo_hang_id || {};
    ws.getCell(rowIdx, 1).value = p.ma_hang || '';
    ws.getCell(rowIdx, 2).value = p.ten_hang || '';
    ws.getCell(rowIdx, 3).value = getLotName(lot);
    ws.getCell(rowIdx, 4).value = Number(d.so_luong || 0);
    ws.getCell(rowIdx, 5).value = Number(d.don_gia || 0);
    ws.getCell(rowIdx, 6).value = Number(d.gia_nhap || 0);
    ws.getCell(rowIdx, 7).value = Number(d.gia_tra_lai || 0);
    ws.getCell(rowIdx, 8).value = Number(d.thanh_tien || 0);
    ws.getCell(rowIdx, 9).value = d.ghi_chu || '';
    rowIdx += 1;
  });
  rowIdx += 1;
  addPair('Số lượng mặt hàng', details ? details.length : 0);
  addPair('Tổng tiền hàng', Number(ticket.tong_tien_hang || 0));
  addPair('Giảm giá', ticket.kieu_giam_gia === 'percent' ? String(ticket.giam_gia || 0) + '%' : Number(ticket.giam_gia || 0));
  addPair('NCC cần trả', Number(ticket.ncc_can_tra || 0));
  addPair('NCC đã trả', Number(ticket.ncc_da_tra || 0));
  addPair('Tổng tiền trả', Number(ticket.tong_tien_tra || 0));

  ws.getColumn(1).width = 22;
  ws.getColumn(2).width = 36;
  for (var c = 1; c <= 9; c++) {
    ws.getColumn(c).width = Math.max(ws.getColumn(c).width || 12, 14);
  }

  var fname = 'phieu-tra-hang-nhap-' + slugReturnExportFilename(ticket.ma_phieu_tra_nhap) + '.xlsx';
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="' + fname + '"');
  await workbook.xlsx.write(res);
  res.end();
}

exports.index = async function(req, res, next) {
  try {
    const storeId = await resolveStoreId(req);
    const query = await buildListFilter(req, storeId);
    const [returns, users] = await Promise.all([
      PhieuTraHangNhap.find(query)
        .populate({ path: 'nha_cung_cap_id', select: 'ma_ncc ten_ncc' })
        .populate({ path: 'kho_id', select: 'ma_kho ten_kho' })
        .populate({ path: 'phieu_nhap_id', select: 'ma_phieu_nhap' })
        .populate({ path: 'nguoi_tao_id', select: 'ho_ten email' })
        .populate({ path: 'nguoi_tra_id', select: 'ho_ten email' })
        .sort({ ngay_tra: -1, created_at: -1 })
        .lean(),
      NguoiDung.find(isObjectId(storeId) ? { cua_hang_id: storeId } : {}).sort({ ho_ten: 1, email: 1 }).lean()
    ]);

    const returnIds = returns.map(row => row._id);
    let detailRows = [];
    if (returnIds.length) {
      detailRows = await CTPhieuTraHangNhap.find({ phieu_tra_nhap_id: { $in: returnIds } })
        .populate({ path: 'hang_hoa_id', select: 'ma_hang ten_hang' })
        .populate({ path: 'don_vi_tinh_id', select: 'ma_don_vi ten_don_vi' })
        .populate({ path: 'lo_hang_id', select: 'ma_lo ten_lo' })
        .sort({ created_at: 1 })
        .lean();
    }
    const detailsByReturn = detailRows.reduce((map, row) => {
      const key = String(row.phieu_tra_nhap_id);
      if (!map[key]) map[key] = [];
      map[key].push(row);
      return map;
    }, {});
    returns.forEach(row => {
      row.detail_rows = detailsByReturn[String(row._id)] || [];
      row.detail_summary = {
        tong_mat_hang: row.detail_rows.length,
        tong_so_luong: row.detail_rows.reduce((sum, item) => sum + Number(item.so_luong || 0), 0)
      };
    });

    res.render('tra-hang-nhap/index', {
      title: 'Trả hàng nhập',
      activeMenu: 'mua-hang',
      user: req.user,
      returns,
      users,
      filters: req.query || {},
      formatDate,
      statusLabel
    });
  } catch (error) {
    next(error);
  }
};

exports.createPage = async function(req, res, next) {
  try {
    const storeId = await resolveStoreId(req);
    const data = await loadCreateData(storeId);
    const nextCode = await makeReturnCode();
    const copyFromId = String(req.query?.copy_from || '').trim();
    let copyDraft = null;
    let copyFromError = '';
    if (isObjectId(copyFromId)) {
      copyDraft = await loadReturnCopyDraft(req, storeId, copyFromId);
      if (!copyDraft) {
        copyFromError = 'Không tải được phiếu để sao chép, phiếu không có chi tiết, hoặc thiếu kho.';
      }
    }
    const selectedPurchaseId = copyDraft && copyDraft.phieu_nhap_id
      ? String(copyDraft.phieu_nhap_id)
      : String(req.query?.phieu_nhap_id || '').trim();
    const selectedPurchase = !copyDraft && isObjectId(selectedPurchaseId)
      ? await PhieuNhap.findById(selectedPurchaseId).select('_id kho_id nha_cung_cap_id').lean()
      : null;
    const copyDraftJson = copyDraft ? JSON.stringify(copyDraft).replace(/</g, '\\u003c') : '';
    res.render('tra-hang-nhap/create', {
      title: 'Trả hàng nhập',
      activeMenu: 'mua-hang',
      user: req.user,
      nextCode,
      todayValue: new Date().toISOString().slice(0, 16),
      warehouses: data.warehouses,
      suppliers: data.suppliers,
      users: data.users,
      productsJson: JSON.stringify(data.productOptions),
      receipts: data.receipts,
      selectedPurchaseId: copyDraft && copyDraft.phieu_nhap_id ? String(copyDraft.phieu_nhap_id) : (selectedPurchase ? String(selectedPurchase._id) : ''),
      selectedPurchaseKhoId: copyDraft && copyDraft.kho_id ? String(copyDraft.kho_id) : (selectedPurchase ? String(selectedPurchase.kho_id || '') : ''),
      selectedPurchaseSupplierId: copyDraft && copyDraft.nha_cung_cap && copyDraft.nha_cung_cap._id
        ? String(copyDraft.nha_cung_cap._id)
        : (selectedPurchase ? String(selectedPurchase.nha_cung_cap_id || '') : ''),
      copyDraftJson,
      copyFromError
    });
  } catch (error) {
    next(error);
  }
};

async function buildPurchaseReturnGridItems(purchase, storeId, requestedKhoId, options = {}) {
  void storeId;
  void requestedKhoId;
  const ignoreReturnIds = new Set((options.ignorePhieuTraNhapIds || []).filter(id => isObjectId(id)).map(id => String(id)));
  const details = await CTPhieuNhap.find({ phieu_nhap_id: purchase._id })
    .populate({ path: 'hang_hoa_id', select: 'ma_hang ten_hang don_vi_tinh_id quan_ly_theo_lo' })
    .populate({ path: 'don_vi_tinh_id', select: 'ma_don_vi ten_don_vi' })
    .populate({ path: 'lo_hang_id', select: 'ma_lo ten_lo so_luong_con_lai han_su_dung' })
    .populate({ path: 'gia_tri_thuoc_tinh_id', select: 'ten_gia_tri ma_gia_tri' })
    .sort({ created_at: 1 })
    .lean();

  const returnRows = await CTPhieuTraHangNhap.find({ phieu_nhap_id: purchase._id })
    .populate({ path: 'phieu_tra_nhap_id', select: 'trang_thai' })
    .lean();
  const returnedByDetail = {};
  returnRows.forEach(row => {
    if (row.phieu_tra_nhap_id && row.phieu_tra_nhap_id.trang_thai === 'cancelled') return;
    const retId = row.phieu_tra_nhap_id && (row.phieu_tra_nhap_id._id || row.phieu_tra_nhap_id);
    if (retId && ignoreReturnIds.has(String(retId))) return;
    if (!row.ct_phieu_nhap_id) return;
    const key = String(row.ct_phieu_nhap_id);
    returnedByDetail[key] = (returnedByDetail[key] || 0) + Number(row.so_luong || 0);
  });

  const khoRef = purchase.kho_id && purchase.kho_id._id ? purchase.kho_id._id : purchase.kho_id;
  const inventoryRows = await TonKho.find({
    kho_id: khoRef,
    hang_hoa_id: { $in: details.map(r => r.hang_hoa_id && r.hang_hoa_id._id).filter(Boolean) }
  }).lean();
  const inventoryByProduct = inventoryRows.reduce((map, row) => {
    map[String(row.hang_hoa_id)] = Number(row.so_luong || 0);
    return map;
  }, {});

  const lotIds = details.map(row => row.lo_hang_id && row.lo_hang_id._id).filter(Boolean);
  const lotInventoryRows = lotIds.length
    ? await TonKhoLo.find({ kho_id: khoRef, lo_hang_id: { $in: lotIds } }).lean()
    : [];
  const inventoryByLot = lotInventoryRows.reduce((map, row) => {
    map[String(row.lo_hang_id)] = Number(row.so_luong || 0);
    return map;
  }, {});

  return details.map(row => {
    const detailId = String(row._id);
    const importedQty = Number(row.so_luong || 0);
    const returnedQty = Number(returnedByDetail[detailId] || 0);
    const canReturnByPurchase = Math.max(0, importedQty - returnedQty);
    const productId = row.hang_hoa_id && row.hang_hoa_id._id ? String(row.hang_hoa_id._id) : String(row.hang_hoa_id || '');
    const lotId = row.lo_hang_id && row.lo_hang_id._id ? String(row.lo_hang_id._id) : '';
    const currentStock = lotId
      ? Number(inventoryByLot[lotId] || 0)
      : Number(inventoryByProduct[productId] || 0);
    let tenHang = row.hang_hoa_id ? (row.hang_hoa_id.ten_hang || '') : '';
    let giaTriThuocTinhId = '';
    if (row.gia_tri_thuoc_tinh_id) {
      const g = row.gia_tri_thuoc_tinh_id;
      giaTriThuocTinhId = g._id ? String(g._id) : String(row.gia_tri_thuoc_tinh_id);
      const gl = (g.ten_gia_tri || g.ma_gia_tri || '').trim();
      if (gl) tenHang = tenHang ? `${tenHang} · ${gl}` : gl;
    }
    return {
      ct_phieu_nhap_id: detailId,
      phieu_nhap_id: String(purchase._id),
      hang_hoa_id: productId,
      ma_hang: row.hang_hoa_id ? (row.hang_hoa_id.ma_hang || '') : '',
      ten_hang: tenHang,
      gia_tri_thuoc_tinh_id: giaTriThuocTinhId,
      don_vi_tinh_id: row.don_vi_tinh_id ? String(row.don_vi_tinh_id._id || row.don_vi_tinh_id) : '',
      don_vi_tinh: row.don_vi_tinh_id ? (row.don_vi_tinh_id.ten_don_vi || row.don_vi_tinh_id.ma_don_vi || '') : '',
      quan_ly_theo_lo: Boolean(row.hang_hoa_id && row.hang_hoa_id.quan_ly_theo_lo),
      lo_hang_id: lotId,
      ma_lo: row.lo_hang_id ? (row.lo_hang_id.ma_lo || row.lo_hang_id.ten_lo || '') : '',
      ten_lo: row.lo_hang_id ? (row.lo_hang_id.ten_lo || '') : '',
      so_luong_nhap: importedQty,
      tong_so_luong_da_tra: returnedQty,
      so_luong_con_co_the_tra: canReturnByPurchase,
      ton_kho_hien_tai: currentStock,
      so_luong_toi_da_tra: Math.min(canReturnByPurchase, currentStock),
      so_luong: 0,
      gia_nhap: Number(row.don_gia_nhap || row.don_gia || 0),
      gia_tra_lai: Number(row.don_gia_nhap || row.don_gia || 0),
      thanh_tien: 0,
      ghi_chu: ''
    };
  });
}

async function buildGridItemFromReturnLine(line, khoId, storeId) {
  void storeId;
  const hangId = line.hang_hoa_id && line.hang_hoa_id._id ? String(line.hang_hoa_id._id) : String(line.hang_hoa_id || '');
  if (!isObjectId(hangId) || !isObjectId(khoId)) return null;
  const product = line.hang_hoa_id && line.hang_hoa_id._id
    ? line.hang_hoa_id
    : await HangHoa.findById(hangId).select('ma_hang ten_hang don_vi_tinh_id quan_ly_theo_lo').lean();
  if (!product) return null;

  let tenHang = product.ten_hang || '';
  let giaTriId = '';
  if (line.ct_phieu_nhap_id) {
    const ctPn = await CTPhieuNhap.findById(line.ct_phieu_nhap_id)
      .populate({ path: 'gia_tri_thuoc_tinh_id', select: 'ten_gia_tri ma_gia_tri' })
      .lean();
    if (ctPn && ctPn.gia_tri_thuoc_tinh_id) {
      const g = ctPn.gia_tri_thuoc_tinh_id;
      giaTriId = g._id ? String(g._id) : String(ctPn.gia_tri_thuoc_tinh_id);
      const gl = (g.ten_gia_tri || g.ma_gia_tri || '').trim();
      if (gl) tenHang = tenHang ? `${tenHang} · ${gl}` : gl;
    }
  }

  const lotId = line.lo_hang_id && line.lo_hang_id._id ? String(line.lo_hang_id._id) : (line.lo_hang_id ? String(line.lo_hang_id) : '');
  const inv = await TonKho.findOne({ kho_id: khoId, hang_hoa_id: hangId }).lean();
  const ton = Number(inv && inv.so_luong || 0);
  let tonLo = ton;
  if (product.quan_ly_theo_lo && lotId) {
    const tl = await TonKhoLo.findOne({ kho_id: khoId, hang_hoa_id: hangId, lo_hang_id: lotId }).lean();
    tonLo = Number(tl && tl.so_luong || 0);
  }

  let donViTinh = '';
  let donViId = '';
  if (line.don_vi_tinh_id && line.don_vi_tinh_id._id) {
    donViId = String(line.don_vi_tinh_id._id);
    donViTinh = line.don_vi_tinh_id.ten_don_vi || line.don_vi_tinh_id.ma_don_vi || '';
  } else if (product.don_vi_tinh_id) {
    donViId = String(product.don_vi_tinh_id);
    const u = await DonViTinh.findById(product.don_vi_tinh_id).select('ma_don_vi ten_don_vi').lean();
    if (u) donViTinh = u.ten_don_vi || u.ma_don_vi || '';
  }

  return {
    ct_phieu_nhap_id: line.ct_phieu_nhap_id ? String(line.ct_phieu_nhap_id) : '',
    phieu_nhap_id: line.phieu_nhap_id ? String(line.phieu_nhap_id) : '',
    hang_hoa_id: hangId,
    ma_hang: product.ma_hang || '',
    ten_hang: tenHang,
    don_vi_tinh_id: donViId,
    don_vi_tinh: donViTinh,
    quan_ly_theo_lo: Boolean(product.quan_ly_theo_lo),
    lo_hang_id: lotId,
    ma_lo: line.lo_hang_id ? (line.lo_hang_id.ma_lo || line.lo_hang_id.ten_lo || '') : '',
    ten_lo: line.lo_hang_id ? (line.lo_hang_id.ten_lo || '') : '',
    gia_tri_thuoc_tinh_id: giaTriId,
    so_luong_nhap: 0,
    tong_so_luong_da_tra: 0,
    so_luong_con_co_the_tra: tonLo,
    ton_kho_hien_tai: tonLo,
    so_luong_toi_da_tra: tonLo,
    so_luong: 0,
    gia_nhap: Number(line.gia_nhap || 0),
    gia_tra_lai: Number(line.gia_tra_lai || line.don_gia || 0),
    ghi_chu: String(line.ghi_chu || '').trim(),
    thanh_tien: 0
  };
}

async function buildReturnLinesOnlyGridItems(lines, khoId) {
  if (!isObjectId(khoId)) return [];
  const out = [];
  for (const line of lines) {
    const row = await buildGridItemFromReturnLine(line, khoId, '');
    if (!row) continue;
    const copiedQty = Math.floor(Number(line.so_luong || 0));
    const maxTra = Number(row.so_luong_toi_da_tra != null ? row.so_luong_toi_da_tra : row.so_luong_con_co_the_tra || 0);
    row.so_luong = Math.min(Math.max(0, copiedQty), Math.max(0, maxTra));
    row.gia_nhap = Number(line.gia_nhap || row.gia_nhap || 0);
    row.gia_tra_lai = Number(line.gia_tra_lai || line.don_gia || row.gia_tra_lai || 0);
    row.ghi_chu = String(line.ghi_chu || '').trim();
    out.push(row);
  }
  return out;
}

async function loadReturnCopyDraft(req, storeId, copyFromId) {
  if (!isObjectId(copyFromId) || !isObjectId(storeId)) return null;
  const source = await PhieuTraHangNhap.findOne({ _id: copyFromId, cua_hang_id: storeId })
    .populate({ path: 'nha_cung_cap_id', select: 'ma_ncc ten_ncc' })
    .lean();
  if (!source) return null;

  const lines = await CTPhieuTraHangNhap.find({ phieu_tra_nhap_id: source._id })
    .populate({ path: 'hang_hoa_id', select: 'ma_hang ten_hang don_vi_tinh_id quan_ly_theo_lo' })
    .populate({ path: 'lo_hang_id', select: 'ma_lo ten_lo' })
    .populate({ path: 'don_vi_tinh_id', select: 'ma_don_vi ten_don_vi' })
    .sort({ created_at: 1 })
    .lean();

  if (!lines.length) return null;

  const khoId = source.kho_id ? String(source.kho_id) : '';
  const phieuNhapId = source.phieu_nhap_id ? String(source.phieu_nhap_id) : '';

  let gridItems = [];

  if (isObjectId(phieuNhapId) && isObjectId(khoId)) {
    const purchaseFilter = { _id: phieuNhapId, kho_id: khoId };
    if (isObjectId(storeId)) purchaseFilter.cua_hang_id = storeId;
    const purchase = await PhieuNhap.findOne(purchaseFilter)
      .populate({ path: 'nha_cung_cap_id', select: 'ma_ncc ten_ncc' })
      .populate({ path: 'kho_id', select: 'ma_kho ten_kho' })
      .lean();
    if (purchase) {
      const baseItems = await buildPurchaseReturnGridItems(purchase, storeId, khoId, {
        ignorePhieuTraNhapIds: [String(copyFromId)]
      });
      const byCt = {};
      baseItems.forEach(row => {
        if (row.ct_phieu_nhap_id) byCt[String(row.ct_phieu_nhap_id)] = row;
      });
      for (const line of lines) {
        const ctId = line.ct_phieu_nhap_id ? String(line.ct_phieu_nhap_id) : '';
        let row = ctId && byCt[ctId] ? Object.assign({}, byCt[ctId]) : await buildGridItemFromReturnLine(line, khoId, storeId);
        if (!row) continue;
        const copiedQty = Math.floor(Number(line.so_luong || 0));
        const maxTra = Number(row.so_luong_toi_da_tra != null ? row.so_luong_toi_da_tra : row.so_luong_con_co_the_tra || 0);
        row.so_luong = Math.min(Math.max(0, copiedQty), Math.max(0, maxTra));
        row.gia_nhap = Number(line.gia_nhap || row.gia_nhap || 0);
        row.gia_tra_lai = Number(line.gia_tra_lai || line.don_gia || row.gia_tra_lai || 0);
        row.ghi_chu = String(line.ghi_chu || '').trim();
        gridItems.push(row);
      }
    } else {
      gridItems = await buildReturnLinesOnlyGridItems(lines, khoId);
    }
  } else if (isObjectId(khoId)) {
    gridItems = await buildReturnLinesOnlyGridItems(lines, khoId);
  } else {
    return null;
  }

  const supplier = source.nha_cung_cap_id && source.nha_cung_cap_id._id
    ? {
      _id: String(source.nha_cung_cap_id._id),
      ma_ncc: source.nha_cung_cap_id.ma_ncc || '',
      ten_ncc: source.nha_cung_cap_id.ten_ncc || ''
    }
    : null;

  return {
    kho_id: khoId,
    phieu_nhap_id: phieuNhapId,
    nha_cung_cap: supplier,
    giam_gia: Number(source.giam_gia || 0),
    kieu_giam_gia: source.kieu_giam_gia === 'percent' ? 'percent' : 'vnd',
    ghi_chu: String(source.ghi_chu || ''),
    tinh_vao_cong_no: source.tinh_vao_cong_no !== false,
    require_phieu_nhap: Boolean(phieuNhapId),
    items: gridItems
  };
}

exports.apiPurchaseReturnDetail = async function(req, res) {
  try {
    const storeId = await resolveStoreId(req);
    const purchaseId = String(req.params.id || '').trim();
    if (!isObjectId(purchaseId)) {
      return res.status(400).json({ success: false, message: 'Phiếu nhập không hợp lệ' });
    }

    const purchaseFilter = { _id: purchaseId };
    if (isObjectId(storeId)) purchaseFilter.cua_hang_id = storeId;
    const requestedKhoId = String(req.query.kho_id || '').trim();
    if (isObjectId(requestedKhoId)) purchaseFilter.kho_id = requestedKhoId;
    const purchase = await PhieuNhap.findOne(purchaseFilter)
      .populate({ path: 'nha_cung_cap_id', select: 'ma_ncc ten_ncc' })
      .populate({ path: 'kho_id', select: 'ma_kho ten_kho' })
      .lean();
    if (!purchase) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy phiếu nhập' });
    }

    const items = await buildPurchaseReturnGridItems(purchase, storeId, requestedKhoId, {});

    const supplier = purchase.nha_cung_cap_id
      ? {
        _id: String(purchase.nha_cung_cap_id._id || purchase.nha_cung_cap_id),
        ma_ncc: purchase.nha_cung_cap_id.ma_ncc || '',
        ten_ncc: purchase.nha_cung_cap_id.ten_ncc || ''
      }
      : null;

    return res.json({
      success: true,
      data: {
        phieu_nhap: {
          _id: String(purchase._id),
          ma_phieu_nhap: purchase.ma_phieu_nhap || '',
          kho_id: purchase.kho_id && purchase.kho_id._id ? String(purchase.kho_id._id) : String(purchase.kho_id || ''),
          kho: purchase.kho_id || null,
          nha_cung_cap_id: supplier ? supplier._id : '',
          nha_cung_cap: supplier
        },
        nha_cung_cap: supplier,
        items: items,
        chi_tiet: items
      }
    });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message || 'Không thể tải chi tiết phiếu nhập' });
  }
};

exports.apiPurchasesByWarehouse = async function(req, res) {
  try {
    const storeId = await resolveStoreId(req);
    const khoId = String((req.params && req.params.khoId) || (req.query && req.query.kho_id) || '').trim();
    if (!isObjectId(khoId)) {
      return res.status(400).json({ success: false, message: 'Kho không hợp lệ' });
    }

    const filter = { kho_id: khoId, trang_thai: 'completed' };
    if (isObjectId(storeId)) filter.cua_hang_id = storeId;
    const purchases = await PhieuNhap.find(filter)
      .populate({ path: 'nha_cung_cap_id', select: 'ma_ncc ten_ncc' })
      .select('ma_phieu_nhap ngay_nhap created_at kho_id nha_cung_cap_id')
      .sort({ ngay_nhap: -1, created_at: -1 })
      .lean();

    const items = purchases.map(row => {
      const supplier = row.nha_cung_cap_id
        ? {
          _id: String(row.nha_cung_cap_id._id || row.nha_cung_cap_id),
          ma_ncc: row.nha_cung_cap_id.ma_ncc || '',
          ten_ncc: row.nha_cung_cap_id.ten_ncc || ''
        }
        : null;
      return {
        _id: String(row._id),
        ma_phieu_nhap: row.ma_phieu_nhap || '',
        ngay_nhap: row.ngay_nhap || row.created_at || null,
        kho_id: String(row.kho_id || ''),
        nha_cung_cap_id: supplier ? supplier._id : '',
        nha_cung_cap: supplier
      };
    });

    return res.json({ success: true, items });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message || 'Không thể tải phiếu nhập theo kho' });
  }
};

exports.createSubmit = async function(req, res, next) {
  try {
    const storeId = await resolveStoreId(req);
    if (!isObjectId(storeId)) return res.status(400).json({ success: false, message: 'Cửa hàng không hợp lệ' });

    const body = req.body || {};
    const submitMode = body.submitMode === 'completed' ? 'completed' : 'draft';
    const khoId = String(body.kho_id || '').trim();
    let supplierId = isObjectId(body.nha_cung_cap_id) ? String(body.nha_cung_cap_id) : '';
    const phieuNhapId = isObjectId(body.phieu_nhap_id) ? String(body.phieu_nhap_id) : '';
    if (phieuNhapId) {
      const purchase = await PhieuNhap.findById(phieuNhapId).select('nha_cung_cap_id kho_id').lean();
      if (!purchase) return res.status(400).json({ success: false, message: 'Phiếu nhập gốc không hợp lệ' });
      const purchaseSupplierId = purchase.nha_cung_cap_id ? String(purchase.nha_cung_cap_id) : '';
      if (supplierId && purchaseSupplierId && supplierId !== purchaseSupplierId) {
        return res.status(400).json({ success: false, message: 'Không cho chọn nhà cung cấp khác với phiếu nhập gốc' });
      }
      supplierId = purchaseSupplierId || supplierId;
    } else if (!supplierId) {
      return res.status(400).json({ success: false, message: 'Vui lòng chọn nhà cung cấp hoặc phiếu nhập gốc' });
    }
    const discountType = ['vnd', 'percent'].includes(String(body.kieu_giam_gia || '').trim()) ? String(body.kieu_giam_gia).trim() : 'vnd';
    const rawItems = parseItems(body.items_json || body.items);
    const detailRows = submitMode === 'completed'
      ? await validateReturnItems({ items: rawItems, storeId, khoId, phieuNhapId })
      : await validateReturnItems({ items: rawItems, storeId, khoId, phieuNhapId }).catch(error => {
        if (String(error.message || '').includes('tồn kho')) throw error;
        throw error;
      });
    const totals = computeTotals(detailRows, parseMoney(body.giam_gia || 0), discountType);
    const nccDaTra = Math.min(parseMoney(body.ncc_da_tra || 0), totals.ncc_can_tra);
    const maPhieu = String(body.ma_phieu_tra_nhap || '').trim() || await makeReturnCode();
    const returnDoc = await PhieuTraHangNhap.create({
      cua_hang_id: storeId,
      kho_id: khoId,
      ma_phieu_tra_nhap: maPhieu,
      ngay_tra: body.ngay_tra ? new Date(body.ngay_tra) : new Date(),
      nha_cung_cap_id: supplierId || undefined,
      phieu_nhap_id: phieuNhapId || undefined,
      tong_tien_hang: totals.tong_tien_hang,
      giam_gia: totals.giam_gia,
      kieu_giam_gia: discountType,
      ncc_can_tra: totals.ncc_can_tra,
      ncc_da_tra: nccDaTra,
      tinh_vao_cong_no: body.tinh_vao_cong_no !== 'false' && body.tinh_vao_cong_no !== false,
      tong_tien_tra: totals.tong_tien_tra,
      trang_thai: submitMode,
      ghi_chu: String(body.ghi_chu || '').trim(),
      nguoi_tao_id: req.user?._id,
      nguoi_tra_id: req.user?._id
    });
    await persistDetails(returnDoc._id, detailRows);

    if (submitMode === 'completed') {
      await completeInventory(returnDoc, detailRows, req.user?._id);
      await applySupplierDebt(returnDoc);
      await createSupplierRefundReceipt(returnDoc, req.user?._id);
    }

    return res.json({ success: true, redirect: '/tra-hang-nhap', id: returnDoc._id, ma_phieu_tra_nhap: maPhieu, print_url: '/chung-tu-kho/tra-hang-nhap/' + returnDoc._id });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message || 'Không thể lưu phiếu trả hàng nhập' });
  }
};

exports.detail = async function(req, res, next) {
  try {
    const ret = await PhieuTraHangNhap.findById(req.params.id)
      .populate('nha_cung_cap_id')
      .populate('phieu_nhap_id')
      .populate('kho_id')
      .populate('nguoi_tao_id')
      .populate('nguoi_tra_id')
      .lean();
    if (!ret) return res.status(404).json({ success: false, message: 'Không tìm thấy phiếu trả hàng nhập' });
    const items = await CTPhieuTraHangNhap.find({ phieu_tra_nhap_id: ret._id })
      .populate('hang_hoa_id')
      .populate('lo_hang_id')
      .populate('don_vi_tinh_id')
      .lean();
    return res.json({ success: true, data: { ticket: ret, items } });
  } catch (error) {
    next(error);
  }
};

exports.complete = async function(req, res) {
  try {
    const returnDoc = await PhieuTraHangNhap.findById(req.params.id);
    if (!returnDoc) return res.status(404).json({ success: false, message: 'Không tìm thấy phiếu trả hàng nhập' });
    if (returnDoc.trang_thai === 'cancelled') return res.status(400).json({ success: false, message: 'Phiếu đã hủy' });
    if (returnDoc.trang_thai === 'completed') return res.json({ success: true, message: 'Phiếu đã hoàn thành' });
    const rawRows = await CTPhieuTraHangNhap.find({ phieu_tra_nhap_id: returnDoc._id }).lean();
    const detailRows = await validateReturnItems({
      items: rawRows.map(row => ({
        hang_hoa_id: row.hang_hoa_id,
        lo_hang_id: row.lo_hang_id,
        phieu_nhap_id: row.phieu_nhap_id,
        ct_phieu_nhap_id: row.ct_phieu_nhap_id,
        so_luong: row.so_luong,
        gia_nhap: row.gia_nhap,
        gia_tra_lai: row.gia_tra_lai || row.don_gia,
        ghi_chu: row.ghi_chu
      })),
      storeId: returnDoc.cua_hang_id,
      khoId: returnDoc.kho_id,
      phieuNhapId: returnDoc.phieu_nhap_id,
      returnId: returnDoc._id
    });
    await completeInventory(returnDoc, detailRows, req.user?._id);
    returnDoc.trang_thai = 'completed';
    returnDoc.nguoi_tra_id = req.user?._id || returnDoc.nguoi_tra_id;
    await returnDoc.save();
    await applySupplierDebt(returnDoc);
    await createSupplierRefundReceipt(returnDoc, req.user?._id);
    return res.json({ success: true, message: 'Đã hoàn thành phiếu trả hàng nhập' });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message || 'Không thể hoàn thành phiếu' });
  }
};

exports.cancel = async function(req, res) {
  try {
    const returnDoc = await PhieuTraHangNhap.findById(req.params.id);
    if (!returnDoc) return res.status(404).json({ success: false, message: 'Không tìm thấy phiếu trả hàng nhập' });
    if (returnDoc.trang_thai === 'cancelled') {
      return res.status(400).json({ success: false, message: 'Phiếu đã hủy' });
    }
    if (returnDoc.trang_thai === 'completed') {
      await rollbackReturnImportEffects(returnDoc, req.user?._id);
    }
    returnDoc.trang_thai = 'cancelled';
    await returnDoc.save();
    return res.json({ success: true, message: 'Đã hủy phiếu trả hàng nhập' });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message || 'Không thể hủy phiếu' });
  }
};

exports.exportExcel = async function(req, res, next) {
  try {
    const storeId = await resolveStoreId(req);
    const query = await buildListFilter(req, storeId);
    const { returns, detailMap } = await loadExportReturns(query);
    await sendReturnImportWorkbook(res, 'tra-hang-nhap.xlsx', returns, detailMap);
  } catch (error) {
    next(error);
  }
};

exports.exportOneExcel = async function(req, res, next) {
  try {
    if (!isObjectId(req.params.id)) {
      return res.status(404).send('Không tìm thấy phiếu trả hàng nhập');
    }
    const storeId = await resolveStoreId(req);
    const query = { _id: req.params.id };
    if (isObjectId(storeId)) query.cua_hang_id = storeId;
    const ticket = await PhieuTraHangNhap.findOne(query)
      .populate({ path: 'nha_cung_cap_id', select: 'ma_ncc ten_ncc' })
      .populate({ path: 'kho_id', select: 'ma_kho ten_kho' })
      .populate({ path: 'phieu_nhap_id', select: 'ma_phieu_nhap' })
      .populate({ path: 'nguoi_tao_id', select: 'ho_ten email username' })
      .populate({ path: 'nguoi_tra_id', select: 'ho_ten email username' })
      .lean();
    if (!ticket) {
      return res.status(404).send('Không tìm thấy phiếu trả hàng nhập');
    }
    const details = await CTPhieuTraHangNhap.find({ phieu_tra_nhap_id: ticket._id })
      .populate({ path: 'hang_hoa_id', select: 'ma_hang ten_hang' })
      .populate({ path: 'lo_hang_id', select: 'ma_lo ten_lo' })
      .populate({ path: 'don_vi_tinh_id', select: 'ma_don_vi ten_don_vi' })
      .sort({ created_at: 1 })
      .lean();
    await sendSingleReturnDetailWorkbook(res, ticket, details);
  } catch (error) {
    next(error);
  }
};

exports.exportCsv = async function(req, res, next) {
  try {
    const storeId = await resolveStoreId(req);
    const query = await buildListFilter(req, storeId);
    const rows = await PhieuTraHangNhap.find(query)
      .populate({ path: 'nha_cung_cap_id', select: 'ma_ncc ten_ncc' })
      .sort({ ngay_tra: -1, created_at: -1 })
      .lean();
    const escape = value => '"' + String(value ?? '').replace(/"/g, '""') + '"';
    const csv = [
      ['ma_tra_hang_nhap', 'thoi_gian', 'nha_cung_cap', 'tong_tien_hang', 'giam_gia', 'ncc_can_tra', 'ncc_da_tra', 'trang_thai'],
      ...rows.map(row => [
        row.ma_phieu_tra_nhap || '',
        row.ngay_tra ? row.ngay_tra.toISOString() : '',
        row.nha_cung_cap_id?.ten_ncc || '',
        row.tong_tien_hang || 0,
        row.giam_gia || 0,
        row.ncc_can_tra || 0,
        row.ncc_da_tra || 0,
        row.trang_thai || ''
      ])
    ].map(row => row.map(escape).join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="tra-hang-nhap.csv"');
    res.send('\uFEFF' + csv);
  } catch (error) {
    next(error);
  }
};
