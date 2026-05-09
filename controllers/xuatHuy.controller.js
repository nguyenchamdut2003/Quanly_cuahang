const mongoose = require('mongoose');
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
  CTXuatHuy
} = require('../models/kiot.model');
const { truTonKho, congTonKho } = require('../services/kho.service');

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

function parseItems(raw) {
  let parsed = raw;
  if (typeof raw === 'string') {
    try { parsed = JSON.parse(raw); } catch (_) { parsed = []; }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.map(item => ({
    hang_hoa_id: String(item.hang_hoa_id || '').trim(),
    lo_hang_id: String(item.lo_hang_id || '').trim(),
    so_luong: Number(item.so_luong || 0),
    gia_von: parseMoney(item.gia_von || 0)
  })).filter(item => isObjectId(item.hang_hoa_id));
}

function formatDate(value) {
  if (!value) return '--';
  return new Date(value).toLocaleString('vi-VN', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });
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
    const qty = Math.floor(Number(item.so_luong || 0));
    if (!Number.isFinite(qty) || qty <= 0) throw new Error('Số lượng hủy phải lớn hơn 0');
    let lotId = isObjectId(item.lo_hang_id) ? item.lo_hang_id : '';

    if (!skipStockCheck) {
      const inventory = await TonKho.findOne({ kho_id: khoId, hang_hoa_id: item.hang_hoa_id }).lean();
      if (!inventory || Number(inventory.so_luong || 0) < qty) throw new Error('Không cho hủy vượt tồn kho');
      if (product.quan_ly_theo_lo) {
        if (lotId) {
          const lotInv = await TonKhoLo.findOne({ kho_id: khoId, hang_hoa_id: item.hang_hoa_id, lo_hang_id: lotId }).lean();
          const lot = await LoHang.findById(lotId).lean();
          if (!lotInv || Number(lotInv.so_luong || 0) < qty || !lot || Number(lot.so_luong_con_lai || 0) < qty) {
            throw new Error('Không cho lô âm');
          }
        } else {
          const lotRows = await TonKhoLo.find({ kho_id: khoId, hang_hoa_id: item.hang_hoa_id, so_luong: { $gt: 0 } })
            .populate('lo_hang_id')
            .lean();
          const totalLotQty = lotRows.reduce((sum, row) => sum + Number(row.so_luong || 0), 0);
          if (totalLotQty < qty) throw new Error('Tồn kho theo lô không đủ để tự chọn FEFO');

          lotRows.sort((a, b) => {
            const aLot = a.lo_hang_id || {};
            const bLot = b.lo_hang_id || {};
            const aDate = aLot.han_su_dung ? new Date(aLot.han_su_dung).getTime() : Number.MAX_SAFE_INTEGER;
            const bDate = bLot.han_su_dung ? new Date(bLot.han_su_dung).getTime() : Number.MAX_SAFE_INTEGER;
            if (aDate !== bDate) return aDate - bDate;
            return new Date(a.updated_at || a.created_at || 0).getTime() - new Date(b.updated_at || b.created_at || 0).getTime();
          });
          let remaining = qty;
          for (const lotRow of lotRows) {
            if (remaining <= 0) break;
            const take = Math.min(Number(lotRow.so_luong || 0), remaining);
            if (take <= 0) continue;
            const cost = item.gia_von || lotRow.gia_von || product.gia_von || 0;
            rows.push({
              hang_hoa_id: item.hang_hoa_id,
              lo_hang_id: lotRow.lo_hang_id && lotRow.lo_hang_id._id ? lotRow.lo_hang_id._id : lotRow.lo_hang_id,
              so_luong: take,
              gia_von: cost,
              thanh_tien: take * cost
            });
            remaining -= take;
          }
          continue;
        }
      } else {
        lotId = '';
      }
    }

    const cost = item.gia_von || product.gia_von || 0;
    rows.push({
      hang_hoa_id: item.hang_hoa_id,
      lo_hang_id: lotId || undefined,
      so_luong: qty,
      gia_von: cost,
      thanh_tien: qty * cost
    });
  }
  return rows;
}

async function persistDetails(ticketId, rows) {
  await CTXuatHuy.deleteMany({ phieu_xuat_huy_id: ticketId });
  if (!rows.length) return [];
  return CTXuatHuy.insertMany(rows.map(row => Object.assign({}, row, { phieu_xuat_huy_id: ticketId })));
}

async function applyInventoryOut(ticket, rows, userId) {
  for (const row of rows) {
    await truTonKho({
      kho_id: ticket.kho_id,
      hang_hoa_id: row.hang_hoa_id,
      lo_hang_id: row.lo_hang_id,
      so_luong: row.so_luong,
      gia_von: row.gia_von,
      nguoi_tao_id: userId,
      loai_phieu: 'xuat_huy',
      ma_phieu: ticket.ma_xuat_huy,
      ghi_chu: ticket.ly_do_huy || ticket.ghi_chu || 'Xuất hủy'
    });
  }
}

async function reverseInventory(ticket, rows, userId) {
  for (const row of rows) {
    await congTonKho({
      kho_id: ticket.kho_id,
      hang_hoa_id: row.hang_hoa_id,
      lo_hang_id: row.lo_hang_id,
      so_luong: row.so_luong,
      gia_von: row.gia_von,
      nguoi_tao_id: userId,
      loai_phieu: 'xuat_huy',
      ma_phieu: ticket.ma_xuat_huy,
      ghi_chu: 'Đảo hủy phiếu xuất hủy ' + ticket.ma_xuat_huy
    });
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
        .populate({ path: 'nguoi_tao_id', select: 'ho_ten email' })
        .sort({ ngay_xuat: -1, created_at: -1 })
        .lean()
    ]);
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

exports.createPage = async function(req, res, next) {
  try {
    const storeId = await resolveStoreId(req);
    const { warehouses } = await loadWarehousesAndUsers(storeId);
    res.render('xuat-huy/create', {
      title: 'Xuất hủy',
      activeMenu: 'hang-hoa',
      user: req.user,
      warehouses,
      nextCode: await makeCode(),
      todayValue: new Date().toISOString().slice(0, 16)
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
    return res.json({ success: true, redirect: '/xuat-huy', id: ticket._id, ma_xuat_huy: code });
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
      so_luong: row.so_luong,
      gia_von: row.gia_von
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
    const lotInventory = await TonKhoLo.find({ kho_id: khoId, so_luong: { $gt: 0 } }).populate('lo_hang_id').lean();
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
          const lotInv = await TonKhoLo.findOne({
            kho_id: purchase.kho_id && purchase.kho_id._id ? purchase.kho_id._id : purchase.kho_id,
            hang_hoa_id: productId,
            lo_hang_id: row.lo_hang_id,
            so_luong: { $gt: 0 }
          }).select('_id').lean();
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

    const rows = [];
    for (const row of details) {
      if (!row.hang_hoa_id) continue;
      const productId = row.hang_hoa_id._id;
      const manageLots = Boolean(row.hang_hoa_id.quan_ly_theo_lo);
      const lotId = row.lo_hang_id && row.lo_hang_id._id ? row.lo_hang_id._id : row.lo_hang_id;
      let currentStock = 0;
      if (manageLots) {
        if (!lotId) continue;
        const lotInv = await TonKhoLo.findOne({ kho_id: khoId, hang_hoa_id: productId, lo_hang_id: lotId }).lean();
        currentStock = Number(lotInv && lotInv.so_luong || 0);
      } else {
        const inv = await TonKho.findOne({ kho_id: khoId, hang_hoa_id: productId }).lean();
        currentStock = Number(inv && inv.so_luong || 0);
      }
      if (currentStock <= 0) continue;
      rows.push({
        ct_phieu_nhap_id: String(row._id),
        phieu_nhap_id: String(purchase._id),
        hang_hoa_id: String(productId),
        ma_hang: row.hang_hoa_id.ma_hang || '',
        ten_hang: row.hang_hoa_id.ten_hang || '',
        don_vi_tinh: row.don_vi_tinh_id ? (row.don_vi_tinh_id.ten_don_vi || row.don_vi_tinh_id.ma_don_vi || '') : '',
        quan_ly_theo_lo: manageLots,
        lo_hang_id: lotId ? String(lotId) : '',
        ma_lo: row.lo_hang_id ? (row.lo_hang_id.ma_lo || row.lo_hang_id.ten_lo || '') : '',
        ten_lo: row.lo_hang_id ? (row.lo_hang_id.ten_lo || '') : '',
        so_luong_nhap: Number(row.so_luong || 0),
        ton_hien_tai: currentStock,
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
