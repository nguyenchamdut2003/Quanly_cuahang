const mongoose = require('mongoose');
const ExcelJS = require('exceljs');
const {
  CuaHang,
  Kho,
  NguoiDung,
  HangHoa,
  DonViTinh,
  TonKho,
  TonKhoLo,
  LoHang,
  PhieuNhap,
  CTPhieuNhap,
  PhieuXuatHuy,
  CTXuatHuy,
  TonKhoLoQuyCach
} = require('../models/kiot.model');
const {
  normalizeTenQuyCach,
  lotHasQuyCachStock,
  loadQuyCachTonForLot,
  applyXuatHuyLine,
  reverseXuatHuyLine,
  lotStockFilter
} = require('../services/xuatHuyStock.service');

const EXPORT_STATUS_MAP = {
  draft: 'Phiếu tạm',
  completed: 'Đã hủy hàng',
  cancelled: 'Đã hủy phiếu'
};

const XUAT_HUY_EXPORT_COLUMNS = [
  { header: 'Mã xuất hủy', key: 'ma_xuat_huy' },
  { header: 'Thời gian', key: 'thoi_gian' },
  { header: 'Kho xuất', key: 'kho_xuat' },
  { header: 'Người tạo', key: 'nguoi_tao' },
  { header: 'Lý do hủy', key: 'ly_do_huy' },
  { header: 'Tổng số lượng', key: 'tong_so_luong', style: { numFmt: '#,##0.##' } },
  { header: 'Tổng giá trị', key: 'tong_gia_tri', style: { numFmt: '#,##0' } },
  { header: 'Ghi chú', key: 'ghi_chu' },
  { header: 'Trạng thái', key: 'trang_thai' },
  { header: 'Mã hàng', key: 'ma_hang' },
  { header: 'Tên hàng', key: 'ten_hang' },
  { header: 'Thương hiệu', key: 'thuong_hieu' },
  { header: 'Đơn vị tính', key: 'don_vi_tinh' },
  { header: 'Lô hàng', key: 'lo_hang' },
  { header: 'Quy cách', key: 'quy_cach' },
  { header: 'Số lượng', key: 'so_luong', style: { numFmt: '#,##0.##' } },
  { header: 'Giá vốn', key: 'gia_von', style: { numFmt: '#,##0' } },
  { header: 'Thành tiền', key: 'thanh_tien', style: { numFmt: '#,##0' } }
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
  const value = Number(String(raw || '').replace(/\./g, '').replace(/,/g, '').trim());
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

function parseQuyCachItems(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map(item => ({
    ten_quy_cach: normalizeTenQuyCach(item.ten_quy_cach || item.ten_thuoc_tinh),
    so_luong: Math.floor(Number(item.so_luong || 0))
  })).filter(item => item.ten_quy_cach && item.so_luong > 0);
}

function parseItems(raw) {
  let parsed = raw;
  if (typeof raw === 'string') {
    try { parsed = JSON.parse(raw); } catch (_) { parsed = []; }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.map(item => ({
    hang_hoa_id: String(item.hang_hoa_id || '').trim(),
    lo_hang_id: String(item.lo_hang_id || '').trim(),
    ten_quy_cach: normalizeTenQuyCach(item.ten_quy_cach),
    quy_cach_items: parseQuyCachItems(item.quy_cach_items),
    so_luong: Number(item.so_luong || 0),
    gia_von: parseMoney(item.gia_von || 0),
    ghi_chu: String(item.ghi_chu || '').trim()
  })).filter(item => isObjectId(item.hang_hoa_id));
}

function formatDate(value) {
  if (!value) return '--';
  return new Date(value).toLocaleString('vi-VN', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });
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

function getCreatorName(user) {
  return user ? (user.ho_ten || user.username || user.email || '') : '';
}

function getLotName(lot) {
  return lot ? (lot.ma_lo || lot.ten_lo || '') : '';
}

function buildExportRow(ticket, detail) {
  const product = detail && detail.hang_hoa_id ? detail.hang_hoa_id : {};
  return {
    ma_xuat_huy: ticket.ma_xuat_huy || '',
    thoi_gian: formatExportDate(ticket.ngay_xuat || ticket.created_at),
    kho_xuat: ticket.kho_id ? (ticket.kho_id.ten_kho || ticket.kho_id.ma_kho || '') : '',
    nguoi_tao: getCreatorName(ticket.nguoi_tao_id),
    ly_do_huy: ticket.ly_do_huy || '',
    tong_so_luong: Number(ticket.tong_so_luong || 0),
    tong_gia_tri: Number(ticket.tong_gia_tri || 0),
    ghi_chu: ticket.ghi_chu || '',
    trang_thai: EXPORT_STATUS_MAP[ticket.trang_thai] || ticket.trang_thai || '',
    ma_hang: product.ma_hang || '',
    ten_hang: product.ten_hang || '',
    thuong_hieu: product.thuong_hieu_id ? product.thuong_hieu_id.ten_thuong_hieu : '',
    don_vi_tinh: product.don_vi_tinh_id ? product.don_vi_tinh_id.ten_don_vi : '',
    lo_hang: getLotName(detail && detail.lo_hang_id),
    quy_cach: detail && detail.ten_quy_cach ? detail.ten_quy_cach : '',
    so_luong: detail ? Number(detail.so_luong || 0) : 0,
    gia_von: detail ? Number(detail.gia_von || 0) : 0,
    thanh_tien: detail ? Number(detail.thanh_tien || 0) : 0
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
    to: { row: 1, column: XUAT_HUY_EXPORT_COLUMNS.length }
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

async function loadExportTickets(filter) {
  const tickets = await PhieuXuatHuy.find(filter)
    .populate({ path: 'kho_id', select: 'ma_kho ten_kho' })
    .populate({ path: 'nguoi_tao_id', select: 'ho_ten username email' })
    .sort({ ngay_xuat: -1, created_at: -1 });
  const ticketIds = tickets.map(ticket => ticket._id);
  const details = ticketIds.length
    ? await CTXuatHuy.find({ phieu_xuat_huy_id: { $in: ticketIds } })
      .populate({
        path: 'hang_hoa_id',
        populate: [
          { path: 'thuong_hieu_id' },
          { path: 'don_vi_tinh_id' }
        ]
      })
      .populate('lo_hang_id')
    : [];
  const detailMap = details.reduce((map, detail) => {
    const key = String(detail.phieu_xuat_huy_id);
    if (!map[key]) map[key] = [];
    map[key].push(detail);
    return map;
  }, {});
  return { tickets, detailMap };
}

async function sendXuatHuyWorkbook(res, filename, tickets, detailMap) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Xuất hủy');
  worksheet.columns = XUAT_HUY_EXPORT_COLUMNS;

  tickets.forEach(ticket => {
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

function statusLabel(value) {
  if (value === 'draft') return 'Phiếu tạm';
  if (value === 'cancelled') return 'Đã hủy phiếu';
  return 'Đã hủy hàng';
}

async function makeCode() {
  const last = await PhieuXuatHuy.findOne({ ma_xuat_huy: /^XH\d+$/ }).sort({ ma_xuat_huy: -1 }).lean();
  const next = last && last.ma_xuat_huy ? Number(String(last.ma_xuat_huy).replace(/\D/g, '')) + 1 : 1;
  return 'XH' + String(next).padStart(6, '0');
}

function startOfMonth() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
}

function endOfDay(value) {
  const d = new Date(value);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

async function buildFilter(req, storeId) {
  const query = {};
  if (isObjectId(storeId)) query.cua_hang_id = storeId;
  const q = String(req.query.q || '').trim();
  if (q) query.ma_xuat_huy = { $regex: q, $options: 'i' };
  const statuses = Array.isArray(req.query.trang_thai) ? req.query.trang_thai : (req.query.trang_thai ? [req.query.trang_thai] : []);
  const clean = statuses.filter(x => ['draft', 'completed', 'cancelled'].includes(x));
  if (clean.length) query.trang_thai = { $in: clean };
  if (isObjectId(req.query.kho_id)) query.kho_id = req.query.kho_id;
  if (isObjectId(req.query.nguoi_tao)) query.nguoi_tao_id = req.query.nguoi_tao;

  const timeType = String(req.query.time_type || '').trim();
  const from = String(req.query.date_from || '').trim();
  const to = String(req.query.date_to || '').trim();
  if (timeType === 'this_month') {
    query.ngay_xuat = { $gte: startOfMonth(), $lte: endOfDay(new Date()) };
  } else if (from || to) {
    query.ngay_xuat = {};
    if (from) query.ngay_xuat.$gte = new Date(from + 'T00:00:00');
    if (to) query.ngay_xuat.$lte = endOfDay(to + 'T00:00:00');
  }
  return query;
}

async function loadWarehousesAndUsers(storeId) {
  const filter = isObjectId(storeId) ? { cua_hang_id: storeId } : {};
  const [warehouses, users] = await Promise.all([
    Kho.find(filter).sort({ ten_kho: 1, ma_kho: 1 }).lean(),
    NguoiDung.find(filter).sort({ ho_ten: 1, email: 1 }).lean()
  ]);
  return { warehouses, users };
}

async function validateTonKhoTong(khoId, hangHoaId, qty) {
  const inventory = await TonKho.findOne({ kho_id: khoId, hang_hoa_id: hangHoaId }).lean();
  if (!inventory || Number(inventory.so_luong || 0) < qty) {
    throw new Error('Không cho hủy vượt tồn kho');
  }
}

async function validateTonKhoLo(khoId, hangHoaId, lotId, qty) {
  const lotInv = await TonKhoLo.findOne(lotStockFilter(khoId, hangHoaId, lotId)).lean();
  const lot = await LoHang.findById(lotId).lean();
  if (!lotInv || Number(lotInv.so_luong || 0) < qty || !lot || Number(lot.so_luong_con_lai || 0) < qty) {
    throw new Error('Không cho hủy vượt tồn lô');
  }
}

async function validateTonKhoQuyCach(khoId, hangHoaId, lotId, tenQuyCach, qty) {
  const qcStock = await TonKhoLoQuyCach.findOne({
    kho_id: khoId,
    hang_hoa_id: hangHoaId,
    lo_hang_id: lotId,
    $or: [{ ten_quy_cach: tenQuyCach }, { ten_thuoc_tinh: tenQuyCach }]
  }).lean();
  if (!qcStock || Number(qcStock.so_luong || 0) < qty) {
    throw new Error('Không cho hủy vượt tồn quy cách');
  }
}

async function normalizeRows(items, khoId, skipStockCheck) {
  if (!items.length) throw new Error('Vui lòng chọn hàng cần hủy');
  if (!isObjectId(khoId)) throw new Error('Vui lòng chọn kho hủy');
  const productIds = items.map(x => x.hang_hoa_id);
  const products = await HangHoa.find({ _id: { $in: productIds } })
    .select('_id ten_hang don_vi_tinh_id quan_ly_theo_lo gia_von')
    .lean();
  const productMap = products.reduce((map, p) => {
    map[String(p._id)] = p;
    return map;
  }, {});
  const rows = [];

  for (const item of items) {
    const product = productMap[item.hang_hoa_id];
    if (!product) throw new Error('Hàng hóa không hợp lệ');
    const cost = item.gia_von || product.gia_von || 0;
    const lineGhiChu = item.ghi_chu || '';
    const quyCachItems = parseQuyCachItems(item.quy_cach_items);
    const manageLots = Boolean(product.quan_ly_theo_lo);
    let lotId = isObjectId(item.lo_hang_id) ? item.lo_hang_id : '';

    if (manageLots) {
      if (!lotId) throw new Error('Hàng quản lý theo lô phải chọn lô hàng');
      const hasQc = await lotHasQuyCachStock(khoId, item.hang_hoa_id, lotId);

      if (hasQc) {
        if (!quyCachItems.length) {
          throw new Error('Lô có quy cách, vui lòng nhập số lượng theo từng quy cách');
        }
        let lineTotal = 0;
        for (const qc of quyCachItems) {
          const qty = qc.so_luong;
          lineTotal += qty;
          if (!skipStockCheck) {
            await validateTonKhoQuyCach(khoId, item.hang_hoa_id, lotId, qc.ten_quy_cach, qty);
          }
          rows.push({
            hang_hoa_id: item.hang_hoa_id,
            lo_hang_id: lotId,
            ten_quy_cach: qc.ten_quy_cach,
            so_luong: qty,
            gia_von: cost,
            thanh_tien: qty * cost,
            ghi_chu: lineGhiChu
          });
        }
        if (!skipStockCheck) {
          await validateTonKhoTong(khoId, item.hang_hoa_id, lineTotal);
          await validateTonKhoLo(khoId, item.hang_hoa_id, lotId, lineTotal);
        }
        continue;
      }

      const qty = Math.floor(Number(item.so_luong || 0));
      if (!Number.isFinite(qty) || qty <= 0) continue;
      if (!skipStockCheck) {
        await validateTonKhoTong(khoId, item.hang_hoa_id, qty);
        await validateTonKhoLo(khoId, item.hang_hoa_id, lotId, qty);
      }
      rows.push({
        hang_hoa_id: item.hang_hoa_id,
        lo_hang_id: lotId,
        so_luong: qty,
        gia_von: cost,
        thanh_tien: qty * cost,
        ghi_chu: lineGhiChu
      });
      continue;
    }

    lotId = '';
    const qty = quyCachItems.length
      ? quyCachItems.reduce((sum, qc) => sum + qc.so_luong, 0)
      : Math.floor(Number(item.so_luong || 0));
    if (!Number.isFinite(qty) || qty <= 0) continue;
    if (!skipStockCheck) await validateTonKhoTong(khoId, item.hang_hoa_id, qty);
    rows.push({
      hang_hoa_id: item.hang_hoa_id,
      so_luong: qty,
      gia_von: cost,
      thanh_tien: qty * cost,
      ghi_chu: lineGhiChu
    });
  }

  if (!rows.length) throw new Error('Vui lòng chọn hàng cần hủy');
  return rows;
}

async function persistDetails(ticketId, rows) {
  await CTXuatHuy.deleteMany({ phieu_xuat_huy_id: ticketId });
  if (!rows.length) return [];
  return CTXuatHuy.insertMany(rows.map(row => Object.assign({}, row, { phieu_xuat_huy_id: ticketId })));
}

async function applyInventoryOut(ticket, rows, userId) {
  for (const row of rows) {
    await applyXuatHuyLine(ticket, row, userId);
  }
}

async function reverseInventory(ticket, rows, userId) {
  for (const row of rows) {
    await reverseXuatHuyLine(ticket, row, userId);
  }
}

exports.index = async function(req, res, next) {
  try {
    const storeId = await resolveStoreId(req);
    const query = await buildFilter(req, storeId);
    const [{ warehouses, users }, tickets] = await Promise.all([
      loadWarehousesAndUsers(storeId),
      PhieuXuatHuy.find(query)
        .populate({ path: 'kho_id', select: 'ma_kho ten_kho' })
        .populate({ path: 'cua_hang_id', select: 'ten_cua_hang ma_cua_hang' })
        .populate({ path: 'nguoi_tao_id', select: 'ho_ten email' })
        .sort({ ngay_xuat: -1, created_at: -1 })
        .lean()
    ]);

    const ticketIds = tickets.map(function(t) { return t._id; });
    var detailRows = [];
    if (ticketIds.length) {
      detailRows = await CTXuatHuy.find({ phieu_xuat_huy_id: { $in: ticketIds } })
        .populate({ path: 'hang_hoa_id', select: 'ma_hang ten_hang' })
        .populate({ path: 'lo_hang_id', select: 'ma_lo ten_lo' })
        .sort({ created_at: 1 })
        .lean();
    }
    const detailsByTicket = detailRows.reduce(function(map, row) {
      const key = String(row.phieu_xuat_huy_id);
      if (!map[key]) map[key] = [];
      map[key].push(row);
      return map;
    }, {});
    tickets.forEach(function(row) {
      row.detail_rows = detailsByTicket[String(row._id)] || [];
      row.detail_summary = {
        tong_so_luong: row.detail_rows.reduce(function(sum, item) {
          return sum + Number(item.so_luong || 0);
        }, 0),
        tong_gia_tri: row.detail_rows.reduce(function(sum, item) {
          return sum + Number(item.thanh_tien || (Number(item.so_luong || 0) * Number(item.gia_von || 0)));
        }, 0)
      };
    });

    res.render('xuat-huy/index', {
      title: 'Xuất hủy',
      activeMenu: 'hang-hoa',
      user: req.user,
      tickets,
      warehouses,
      users,
      filters: req.query || {},
      formatDate,
      statusLabel
    });
  } catch (error) {
    next(error);
  }
};

exports.exportExcel = async function(req, res, next) {
  try {
    const storeId = await resolveStoreId(req);
    const query = await buildFilter(req, storeId);
    const { tickets, detailMap } = await loadExportTickets(query);
    await sendXuatHuyWorkbook(res, 'xuat-huy.xlsx', tickets, detailMap);
  } catch (error) {
    next(error);
  }
};

exports.exportOneExcel = async function(req, res, next) {
  try {
    const storeId = await resolveStoreId(req);
    const query = { _id: req.params.id };
    if (isObjectId(storeId)) query.cua_hang_id = storeId;
    if (!isObjectId(req.params.id)) return res.status(404).send('Không tìm thấy phiếu xuất hủy');

    const { tickets, detailMap } = await loadExportTickets(query);
    if (!tickets.length) return res.status(404).send('Không tìm thấy phiếu xuất hủy');

    await sendXuatHuyWorkbook(
      res,
      'xuat-huy-' + (tickets[0].ma_xuat_huy || 'unknown') + '.xlsx',
      tickets,
      detailMap
    );
  } catch (error) {
    next(error);
  }
};

async function loadDestroyCopyDraft(copyFromId) {
  if (!isObjectId(copyFromId)) return null;
  const ticket = await PhieuXuatHuy.findById(copyFromId).lean();
  if (!ticket || ticket.trang_thai === 'cancelled') return null;
  const lines = await CTXuatHuy.find({ phieu_xuat_huy_id: ticket._id })
    .populate({ path: 'hang_hoa_id', select: 'ma_hang ten_hang' })
    .populate({ path: 'lo_hang_id', select: 'ma_lo ten_lo' })
    .sort({ created_at: 1 })
    .lean();
  if (!lines.length) return null;
  return {
    kho_id: ticket.kho_id ? String(ticket.kho_id) : '',
    ly_do_huy: ticket.ly_do_huy || '',
    ghi_chu: ticket.ghi_chu || '',
    items: lines.map(row => ({
      hang_hoa_id: String(row.hang_hoa_id?._id || row.hang_hoa_id || ''),
      lo_hang_id: row.lo_hang_id ? String(row.lo_hang_id._id || row.lo_hang_id) : '',
      ten_quy_cach: row.ten_quy_cach || '',
      ma_hang: row.hang_hoa_id?.ma_hang || '',
      ten_hang: row.hang_hoa_id?.ten_hang || '',
      ma_lo: row.lo_hang_id?.ma_lo || row.lo_hang_id?.ten_lo || '',
      so_luong: Number(row.so_luong || 0),
      gia_von: Number(row.gia_von || 0),
      ghi_chu: row.ghi_chu || ''
    })).filter(row => row.hang_hoa_id && row.so_luong > 0)
  };
}

exports.createPage = async function(req, res, next) {
  try {
    const storeId = await resolveStoreId(req);
    const { warehouses } = await loadWarehousesAndUsers(storeId);
    const copyFromId = String(req.query?.copy_from || '').trim();
    let copyDraft = null;
    let copyFromError = '';
    if (copyFromId) {
      copyDraft = await loadDestroyCopyDraft(copyFromId);
      if (!copyDraft) copyFromError = 'Không tải được phiếu xuất hủy để sao chép.';
    }
    const copyDraftJson = copyDraft ? JSON.stringify(copyDraft).replace(/</g, '\\u003c') : '';
    res.render('xuat-huy/create', {
      title: 'Xuất hủy',
      activeMenu: 'hang-hoa',
      user: req.user,
      warehouses,
      nextCode: await makeCode(),
      todayValue: new Date().toISOString().slice(0, 16),
      copyDraftJson,
      copyFromError
    });
  } catch (error) {
    next(error);
  }
};

exports.createSubmit = async function(req, res) {
  try {
    const storeId = await resolveStoreId(req);
    const body = req.body || {};
    const mode = body.submitMode === 'completed' ? 'completed' : 'draft';
    const khoId = String(body.kho_id || '').trim();
    const phieuNhapId = String(body.phieu_nhap_id || '').trim();
    const reason = String(body.ly_do_huy || '').trim();
    if (!isObjectId(khoId)) return res.status(400).json({ success: false, message: 'Vui lòng chọn kho hủy' });
    if (!isObjectId(phieuNhapId)) return res.status(400).json({ success: false, message: 'Vui lòng chọn phiếu nhập gốc' });
    if (!reason) return res.status(400).json({ success: false, message: 'Vui lòng nhập lý do hủy' });
    const kho = await Kho.findById(khoId).lean();
    if (!kho) return res.status(400).json({ success: false, message: 'Kho hủy không hợp lệ' });
    const purchase = await PhieuNhap.findOne({ _id: phieuNhapId, trang_thai: 'completed' }).select('kho_id').lean();
    if (!purchase) return res.status(400).json({ success: false, message: 'Phiếu nhập gốc không hợp lệ' });
    if (String(purchase.kho_id || '') !== String(khoId)) {
      return res.status(400).json({ success: false, message: 'Không cho chọn kho khác với kho của phiếu nhập gốc' });
    }
    const rows = await normalizeRows(parseItems(body.items_json || body.items), khoId, false);
    const totals = rows.reduce((sum, row) => {
      sum.qty += Number(row.so_luong || 0);
      sum.value += Number(row.thanh_tien || 0);
      return sum;
    }, { qty: 0, value: 0 });
    const code = String(body.ma_xuat_huy || '').trim() || await makeCode();
    const ticket = await PhieuXuatHuy.create({
      ma_xuat_huy: code,
      ngay_xuat: body.ngay_xuat ? new Date(body.ngay_xuat) : new Date(),
      cua_hang_id: storeId || kho.cua_hang_id,
      chi_nhanh_id: kho.chi_nhanh_id,
      kho_id: khoId,
      nguoi_tao_id: req.user?._id,
      ly_do_huy: reason,
      tong_so_luong: totals.qty,
      tong_gia_tri: totals.value,
      trang_thai: mode,
      ghi_chu: String(body.ghi_chu || '').trim()
    });
    await persistDetails(ticket._id, rows);
    if (mode === 'completed') await applyInventoryOut(ticket, rows, req.user?._id);
    return res.json({ success: true, redirect: '/xuat-huy', id: ticket._id, ma_xuat_huy: code, print_url: '/chung-tu-kho/xuat-huy/' + ticket._id });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message || 'Không thể lưu phiếu xuất hủy' });
  }
};

exports.detail = async function(req, res, next) {
  try {
    const ticket = await PhieuXuatHuy.findById(req.params.id).populate('kho_id').populate('nguoi_tao_id').lean();
    if (!ticket) return res.status(404).json({ success: false, message: 'Không tìm thấy phiếu xuất hủy' });
    const items = await CTXuatHuy.find({ phieu_xuat_huy_id: ticket._id }).populate('hang_hoa_id').populate('lo_hang_id').lean();
    return res.json({ success: true, data: { ticket, items } });
  } catch (error) {
    next(error);
  }
};

exports.complete = async function(req, res) {
  try {
    const ticket = await PhieuXuatHuy.findById(req.params.id);
    if (!ticket) return res.status(404).json({ success: false, message: 'Không tìm thấy phiếu xuất hủy' });
    if (ticket.trang_thai === 'cancelled') return res.status(400).json({ success: false, message: 'Phiếu đã hủy' });
    if (ticket.trang_thai === 'completed') return res.json({ success: true, message: 'Phiếu đã hoàn thành' });
    const rows = await CTXuatHuy.find({ phieu_xuat_huy_id: ticket._id }).lean();
    await normalizeRows(rows.map(row => ({
      hang_hoa_id: row.hang_hoa_id,
      lo_hang_id: row.lo_hang_id,
      ten_quy_cach: row.ten_quy_cach,
      so_luong: row.so_luong,
      gia_von: row.gia_von,
      ghi_chu: row.ghi_chu
    })), ticket.kho_id, false);
    await applyInventoryOut(ticket, rows, req.user?._id);
    ticket.trang_thai = 'completed';
    await ticket.save();
    return res.json({ success: true, message: 'Đã hoàn thành phiếu xuất hủy' });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message || 'Không thể hoàn thành phiếu' });
  }
};

exports.cancel = async function(req, res) {
  try {
    const ticket = await PhieuXuatHuy.findById(req.params.id);
    if (!ticket) return res.status(404).json({ success: false, message: 'Không tìm thấy phiếu xuất hủy' });
    if (ticket.trang_thai === 'cancelled') return res.json({ success: true, message: 'Phiếu đã hủy' });
    const rows = await CTXuatHuy.find({ phieu_xuat_huy_id: ticket._id }).lean();
    if (ticket.trang_thai === 'completed') await reverseInventory(ticket, rows, req.user?._id);
    ticket.trang_thai = 'cancelled';
    await ticket.save();
    return res.json({ success: true, message: 'Đã hủy phiếu xuất hủy' });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message || 'Không thể hủy phiếu' });
  }
};

exports.apiWarehouseProducts = async function(req, res) {
  try {
    const khoId = String(req.params.khoId || '').trim();
    if (!isObjectId(khoId)) return res.status(400).json({ success: false, message: 'Kho không hợp lệ' });
    const inventory = await TonKho.find({ kho_id: khoId, so_luong: { $gt: 0 } })
      .populate({ path: 'hang_hoa_id', select: 'ma_hang ten_hang gia_von don_vi_tinh_id quan_ly_theo_lo' })
      .lean();
    const units = await DonViTinh.find({ _id: { $in: inventory.map(row => row.hang_hoa_id && row.hang_hoa_id.don_vi_tinh_id).filter(Boolean) } }).lean();
    const unitMap = units.reduce((map, unit) => {
      map[String(unit._id)] = unit.ten_don_vi || unit.ma_don_vi || '';
      return map;
    }, {});
    const lotInventory = await TonKhoLo.find({
      kho_id: khoId,
      so_luong: { $gt: 0 },
      $or: [{ gia_tri_thuoc_tinh_id: null }, { gia_tri_thuoc_tinh_id: { $exists: false } }]
    }).populate('lo_hang_id').lean();
    const lotsByProduct = lotInventory.reduce((map, row) => {
      const key = String(row.hang_hoa_id);
      if (!map[key]) map[key] = [];
      map[key].push({
        _id: String(row.lo_hang_id && row.lo_hang_id._id ? row.lo_hang_id._id : row.lo_hang_id),
        ma_lo: row.lo_hang_id ? (row.lo_hang_id.ma_lo || row.lo_hang_id.ten_lo || '') : '',
        ten_lo: row.lo_hang_id ? (row.lo_hang_id.ten_lo || '') : '',
        so_luong: Number(row.so_luong || 0),
        gia_von: Number(row.gia_von || 0)
      });
      return map;
    }, {});
    const items = inventory.filter(row => row.hang_hoa_id).map(row => {
      const p = row.hang_hoa_id;
      return {
        hang_hoa_id: String(p._id),
        ma_hang: p.ma_hang || '',
        ten_hang: p.ten_hang || '',
        don_vi_tinh: unitMap[String(p.don_vi_tinh_id)] || '',
        quan_ly_theo_lo: Boolean(p.quan_ly_theo_lo),
        ton_kho: Number(row.so_luong || 0),
        gia_von: Number(p.gia_von || 0),
        lots: lotsByProduct[String(p._id)] || []
      };
    });
    return res.json({ success: true, items });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message || 'Không thể tải hàng tồn kho' });
  }
};

exports.apiPurchasesWithStock = async function(req, res) {
  try {
    const storeId = await resolveStoreId(req);
    const filter = { trang_thai: 'completed' };
    if (isObjectId(storeId)) filter.cua_hang_id = storeId;
    const purchases = await PhieuNhap.find(filter)
      .populate({ path: 'kho_id', select: 'ma_kho ten_kho' })
      .populate({ path: 'nha_cung_cap_id', select: 'ma_ncc ten_ncc' })
      .select('ma_phieu_nhap ngay_nhap created_at kho_id nha_cung_cap_id')
      .sort({ ngay_nhap: -1, created_at: -1 })
      .lean();

    const purchaseIds = purchases.map(row => row._id);
    const details = purchaseIds.length
      ? await CTPhieuNhap.find({ phieu_nhap_id: { $in: purchaseIds } })
        .populate({ path: 'hang_hoa_id', select: 'quan_ly_theo_lo' })
        .lean()
      : [];
    const detailsByPurchase = details.reduce((map, row) => {
      const key = String(row.phieu_nhap_id);
      if (!map[key]) map[key] = [];
      map[key].push(row);
      return map;
    }, {});

    const items = [];
    for (const purchase of purchases) {
      const rows = detailsByPurchase[String(purchase._id)] || [];
      let hasStock = false;
      for (const row of rows) {
        const productId = row.hang_hoa_id && row.hang_hoa_id._id ? row.hang_hoa_id._id : row.hang_hoa_id;
        const manageLots = Boolean(row.hang_hoa_id && row.hang_hoa_id.quan_ly_theo_lo);
        if (manageLots && row.lo_hang_id) {
          const lotInv = await TonKhoLo.findOne(Object.assign(
            lotStockFilter(
              purchase.kho_id && purchase.kho_id._id ? purchase.kho_id._id : purchase.kho_id,
              productId,
              row.lo_hang_id
            ),
            { so_luong: { $gt: 0 } }
          )).select('_id').lean();
          if (lotInv) { hasStock = true; break; }
        } else {
          const inv = await TonKho.findOne({
            kho_id: purchase.kho_id && purchase.kho_id._id ? purchase.kho_id._id : purchase.kho_id,
            hang_hoa_id: productId,
            so_luong: { $gt: 0 }
          }).select('_id').lean();
          if (inv) { hasStock = true; break; }
        }
      }
      if (!hasStock) continue;
      const supplier = purchase.nha_cung_cap_id
        ? {
          _id: String(purchase.nha_cung_cap_id._id || purchase.nha_cung_cap_id),
          ma_ncc: purchase.nha_cung_cap_id.ma_ncc || '',
          ten_ncc: purchase.nha_cung_cap_id.ten_ncc || ''
        }
        : null;
      items.push({
        _id: String(purchase._id),
        ma_phieu_nhap: purchase.ma_phieu_nhap || '',
        ngay_nhap: purchase.ngay_nhap || purchase.created_at || null,
        kho_id: purchase.kho_id && purchase.kho_id._id ? String(purchase.kho_id._id) : String(purchase.kho_id || ''),
        kho: purchase.kho_id || null,
        nha_cung_cap: supplier
      });
    }
    return res.json({ success: true, items });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message || 'Không thể tải phiếu nhập còn hàng' });
  }
};

exports.apiPurchaseDestroyDetail = async function(req, res) {
  try {
    const storeId = await resolveStoreId(req);
    const purchaseId = String(req.params.id || '').trim();
    if (!isObjectId(purchaseId)) return res.status(400).json({ success: false, message: 'Phiếu nhập không hợp lệ' });
    const filter = { _id: purchaseId, trang_thai: 'completed' };
    if (isObjectId(storeId)) filter.cua_hang_id = storeId;
    const purchase = await PhieuNhap.findOne(filter)
      .populate({ path: 'kho_id', select: 'ma_kho ten_kho' })
      .populate({ path: 'nha_cung_cap_id', select: 'ma_ncc ten_ncc' })
      .lean();
    if (!purchase) return res.status(404).json({ success: false, message: 'Không tìm thấy phiếu nhập còn hàng' });
    const khoId = purchase.kho_id && purchase.kho_id._id ? purchase.kho_id._id : purchase.kho_id;
    const details = await CTPhieuNhap.find({ phieu_nhap_id: purchase._id })
      .populate({ path: 'hang_hoa_id', select: 'ma_hang ten_hang don_vi_tinh_id quan_ly_theo_lo gia_von' })
      .populate({ path: 'don_vi_tinh_id', select: 'ma_don_vi ten_don_vi' })
      .populate({ path: 'lo_hang_id', select: 'ma_lo ten_lo so_luong_con_lai han_su_dung' })
      .sort({ created_at: 1 })
      .lean();

    const lotInventoryAll = await TonKhoLo.find({
      kho_id: khoId,
      so_luong: { $gt: 0 },
      $or: [{ gia_tri_thuoc_tinh_id: null }, { gia_tri_thuoc_tinh_id: { $exists: false } }]
    }).populate('lo_hang_id').lean();
    const lotsByProduct = lotInventoryAll.reduce((map, lotRow) => {
      const key = String(lotRow.hang_hoa_id);
      if (!map[key]) map[key] = [];
      const lot = lotRow.lo_hang_id;
      map[key].push({
        _id: String(lot && lot._id ? lot._id : lotRow.lo_hang_id),
        ma_lo: lot ? (lot.ma_lo || lot.ten_lo || '') : '',
        ten_lo: lot ? (lot.ten_lo || '') : '',
        so_luong: Number(lotRow.so_luong || 0),
        gia_von: Number(lotRow.gia_von || 0)
      });
      return map;
    }, {});

    const rows = [];
    const seenKeys = new Set();
    for (const row of details) {
      if (!row.hang_hoa_id) continue;
      const productId = row.hang_hoa_id._id;
      const manageLots = Boolean(row.hang_hoa_id.quan_ly_theo_lo);
      const defaultLotId = row.lo_hang_id && row.lo_hang_id._id ? row.lo_hang_id._id : row.lo_hang_id;
      const dedupeKey = String(productId) + ':' + String(defaultLotId || '');
      if (seenKeys.has(dedupeKey) && manageLots) continue;
      seenKeys.add(dedupeKey);

      let currentStock = 0;
      let lotId = defaultLotId;
      if (manageLots) {
        const lots = lotsByProduct[String(productId)] || [];
        if (!lots.length) continue;
        if (!lotId || !lots.some(l => l._id === String(lotId))) {
          lotId = lots[0]._id;
        }
        const lotInv = await TonKhoLo.findOne(lotStockFilter(khoId, productId, lotId)).lean();
        currentStock = Number(lotInv && lotInv.so_luong || 0);
      } else {
        const inv = await TonKho.findOne({ kho_id: khoId, hang_hoa_id: productId }).lean();
        currentStock = Number(inv && inv.so_luong || 0);
      }
      if (currentStock <= 0) continue;

      const hasQc = manageLots && lotId ? await lotHasQuyCachStock(khoId, productId, lotId) : false;
      const quyCachItems = hasQc ? await loadQuyCachTonForLot(khoId, productId, lotId) : [];
      const selectedLot = (lotsByProduct[String(productId)] || []).find(l => l._id === String(lotId));

      rows.push({
        ct_phieu_nhap_id: String(row._id),
        phieu_nhap_id: String(purchase._id),
        hang_hoa_id: String(productId),
        ma_hang: row.hang_hoa_id.ma_hang || '',
        ten_hang: row.hang_hoa_id.ten_hang || '',
        don_vi_tinh: row.don_vi_tinh_id ? (row.don_vi_tinh_id.ten_don_vi || row.don_vi_tinh_id.ma_don_vi || '') : '',
        quan_ly_theo_lo: manageLots,
        lo_hang_id: lotId ? String(lotId) : '',
        ma_lo: selectedLot ? selectedLot.ma_lo : (row.lo_hang_id ? (row.lo_hang_id.ma_lo || row.lo_hang_id.ten_lo || '') : ''),
        ten_lo: selectedLot ? selectedLot.ten_lo : (row.lo_hang_id ? (row.lo_hang_id.ten_lo || '') : ''),
        lots: lotsByProduct[String(productId)] || [],
        has_quy_cach: hasQc,
        quy_cach_items: quyCachItems.map(qc => Object.assign({}, qc, { so_luong_huy: 0 })),
        so_luong_nhap: Number(row.so_luong || 0),
        ton_hien_tai: currentStock,
        ton_kho_tong: manageLots
          ? Number((await TonKho.findOne({ kho_id: khoId, hang_hoa_id: productId }).lean())?.so_luong || 0)
          : currentStock,
        so_luong: 0,
        gia_von: Number(row.don_gia_nhap || row.don_gia || row.hang_hoa_id.gia_von || 0),
        thanh_tien: 0
      });
    }
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
          kho_id: String(khoId || ''),
          kho: purchase.kho_id || null,
          nha_cung_cap: supplier
        },
        items: rows
      }
    });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message || 'Không thể tải chi tiết xuất hủy' });
  }
};

exports.apiLotQuyCachTon = async function(req, res) {
  try {
    const khoId = String(req.query.kho_id || '').trim();
    const hangHoaId = String(req.query.hang_hoa_id || '').trim();
    const loHangId = String(req.params.loHangId || '').trim();
    if (!isObjectId(khoId) || !isObjectId(hangHoaId) || !isObjectId(loHangId)) {
      return res.status(400).json({ success: false, message: 'Thông tin lô không hợp lệ' });
    }
    const lotInv = await TonKhoLo.findOne(lotStockFilter(khoId, hangHoaId, loHangId)).lean();
    const quyCachItems = await loadQuyCachTonForLot(khoId, hangHoaId, loHangId);
    return res.json({
      success: true,
      data: {
        ton_lo: Number(lotInv && lotInv.so_luong || 0),
        has_quy_cach: quyCachItems.length > 0,
        quy_cach_items: quyCachItems
      }
    });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message || 'Không thể tải quy cách' });
  }
};
