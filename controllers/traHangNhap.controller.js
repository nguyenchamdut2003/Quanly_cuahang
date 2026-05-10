const mongoose = require('mongoose');
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
  CongNoNhaCungCap
} = require('../models/kiot.model');
const { truTonKho } = require('../services/kho.service');
const { taoPhieuThuChi, ensureDefaultSoQuy } = require('../services/soQuy.service');

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
  const { items, storeId, khoId, phieuNhapId, returnId } = params;
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
    if (returnId && isObjectId(returnId)) currentReturnFilter.phieu_tra_nhap_id = { $ne: returnId };
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
      receipts: data.receipts
    });
  } catch (error) {
    next(error);
  }
};

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

    const details = await CTPhieuNhap.find({ phieu_nhap_id: purchase._id })
      .populate({ path: 'hang_hoa_id', select: 'ma_hang ten_hang don_vi_tinh_id quan_ly_theo_lo' })
      .populate({ path: 'don_vi_tinh_id', select: 'ma_don_vi ten_don_vi' })
      .populate({ path: 'lo_hang_id', select: 'ma_lo ten_lo so_luong_con_lai han_su_dung' })
      .sort({ created_at: 1 })
      .lean();

    const returnRows = await CTPhieuTraHangNhap.find({ phieu_nhap_id: purchase._id })
      .populate({ path: 'phieu_tra_nhap_id', select: 'trang_thai' })
      .lean();
    const returnedByDetail = {};
    returnRows.forEach(row => {
      if (row.phieu_tra_nhap_id && row.phieu_tra_nhap_id.trang_thai === 'cancelled') return;
      if (!row.ct_phieu_nhap_id) return;
      const key = String(row.ct_phieu_nhap_id);
      returnedByDetail[key] = (returnedByDetail[key] || 0) + Number(row.so_luong || 0);
    });

    const inventoryRows = await TonKho.find({
      kho_id: purchase.kho_id && purchase.kho_id._id ? purchase.kho_id._id : purchase.kho_id,
      hang_hoa_id: { $in: details.map(row => row.hang_hoa_id && row.hang_hoa_id._id).filter(Boolean) }
    }).lean();
    const inventoryByProduct = inventoryRows.reduce((map, row) => {
      map[String(row.hang_hoa_id)] = Number(row.so_luong || 0);
      return map;
    }, {});

    const lotIds = details.map(row => row.lo_hang_id && row.lo_hang_id._id).filter(Boolean);
    const lotInventoryRows = lotIds.length
      ? await TonKhoLo.find({
        kho_id: purchase.kho_id && purchase.kho_id._id ? purchase.kho_id._id : purchase.kho_id,
        lo_hang_id: { $in: lotIds }
      }).lean()
      : [];
    const inventoryByLot = lotInventoryRows.reduce((map, row) => {
      map[String(row.lo_hang_id)] = Number(row.so_luong || 0);
      return map;
    }, {});

    const items = details.map(row => {
      const detailId = String(row._id);
      const importedQty = Number(row.so_luong || 0);
      const returnedQty = Number(returnedByDetail[detailId] || 0);
      const canReturnByPurchase = Math.max(0, importedQty - returnedQty);
      const productId = row.hang_hoa_id && row.hang_hoa_id._id ? String(row.hang_hoa_id._id) : String(row.hang_hoa_id || '');
      const lotId = row.lo_hang_id && row.lo_hang_id._id ? String(row.lo_hang_id._id) : '';
      const currentStock = lotId
        ? Number(inventoryByLot[lotId] || 0)
        : Number(inventoryByProduct[productId] || 0);
      return {
        ct_phieu_nhap_id: detailId,
        phieu_nhap_id: String(purchase._id),
        hang_hoa_id: productId,
        ma_hang: row.hang_hoa_id ? (row.hang_hoa_id.ma_hang || '') : '',
        ten_hang: row.hang_hoa_id ? (row.hang_hoa_id.ten_hang || '') : '',
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
        thanh_tien: 0
      };
    });

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

    return res.json({ success: true, redirect: '/tra-hang-nhap', id: returnDoc._id, ma_phieu_tra_nhap: maPhieu });
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
    if (returnDoc.trang_thai === 'completed') {
      return res.status(400).json({ success: false, message: 'Phiếu đã hoàn thành không thể hủy trực tiếp' });
    }
    returnDoc.trang_thai = 'cancelled';
    await returnDoc.save();
    return res.json({ success: true, message: 'Đã hủy phiếu trả hàng nhập' });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message || 'Không thể hủy phiếu' });
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
