const mongoose = require('mongoose');
const {
  Kho,
  HangHoa,
  TonKho,
  LoHang,
  TonKhoLo,
  TonKhoLoQuyCach,
  LichSuKho,
  GiaTriThuocTinh
} = require('../models/kiot.model');

const QUY_CACH_REQUIRED_MSG = 'Hàng/lô có quản lý quy cách, cần truyền quy cách để trừ tồn.';

function toObjectId(value, fieldName) {
  if (!value) {
    throw new Error(`Thiếu ${fieldName}`);
  }

  if (value instanceof mongoose.Types.ObjectId) {
    return value;
  }

  if (!mongoose.Types.ObjectId.isValid(value)) {
    throw new Error(`${fieldName} không hợp lệ`);
  }

  return new mongoose.Types.ObjectId(value);
}

function optionalObjectId(value, fieldName) {
  if (!value) {
    return null;
  }

  return toObjectId(value, fieldName);
}

function normalizeQuantity(value) {
  const quantity = Number(value);

  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error('Số lượng phải lớn hơn 0');
  }

  return quantity;
}

function normalizeTenQuyCach(value) {
  return String(value || '').trim();
}

function isSellableLot(lot) {
  if (!lot || lot.trang_thai === 'huy') return false;
  if (!lot.han_su_dung) return true;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expiry = new Date(lot.han_su_dung);
  expiry.setHours(0, 0, 0, 0);
  return expiry.getTime() >= today.getTime();
}

function sortLotsFefo(a, b) {
  const aLot = a.lo_hang_id;
  const bLot = b.lo_hang_id;
  const aDate = aLot && aLot.han_su_dung ? new Date(aLot.han_su_dung).getTime() : Number.MAX_SAFE_INTEGER;
  const bDate = bLot && bLot.han_su_dung ? new Date(bLot.han_su_dung).getTime() : Number.MAX_SAFE_INTEGER;
  if (aDate !== bDate) return aDate - bDate;
  return new Date(a.updated_at || a.created_at || 0).getTime() - new Date(b.updated_at || b.created_at || 0).getTime();
}

function buildAllocationEntry(lotDoc, quantity) {
  const lotId = lotDoc?._id || lotDoc || null;
  return {
    lo_hang_id: lotId,
    ma_lo: lotDoc?.ma_lo || '',
    ten_lo: lotDoc?.ten_lo || '',
    han_su_dung: lotDoc?.han_su_dung || null,
    so_luong: Number(quantity) || 0
  };
}

function pushAllocation(allocations, lotDoc, quantity) {
  const qty = Number(quantity) || 0;
  if (qty <= 0) return allocations;
  const entry = buildAllocationEntry(lotDoc, qty);
  const key = String(entry.lo_hang_id || '');
  if (!key) return allocations;
  const existing = allocations.find(row => String(row.lo_hang_id) === key);
  if (existing) {
    existing.so_luong += qty;
    return allocations;
  }
  allocations.push(entry);
  return allocations;
}

function finalizeTruTonKho(inventory, allocations = []) {
  return {
    success: true,
    allocations,
    inventory
  };
}

async function getWarehouse(khoId) {
  const warehouse = await Kho.findById(khoId);

  if (!warehouse) {
    throw new Error('Không tìm thấy kho');
  }

  return warehouse;
}

async function ghiLichSuKho(params) {
  const khoId = toObjectId(params.kho_id, 'kho_id');
  const hangHoaId = toObjectId(params.hang_hoa_id, 'hang_hoa_id');
  const loHangId = optionalObjectId(params.lo_hang_id, 'lo_hang_id');
  const warehouse = await getWarehouse(khoId);
  const historyData = {
    cua_hang_id: warehouse.cua_hang_id,
    chi_nhanh_id: warehouse.chi_nhanh_id,
    kho_id: khoId,
    hang_hoa_id: hangHoaId,
    loai_phieu: params.loai_phieu,
    ma_phieu: params.ma_phieu,
    so_luong_thay_doi: Number(params.so_luong_thay_doi) || 0,
    ton_kho_sau: Number(params.ton_kho_sau) || 0,
    gia_tri_thay_doi: Number(params.gia_tri_thay_doi) || 0,
    ghi_chu: params.ghi_chu,
    ngay: new Date()
  };

  if (loHangId) {
    historyData.lo_hang_id = loHangId;
  }

  if (params.ton_kho_truoc != null) {
    historyData.ton_kho_truoc = Number(params.ton_kho_truoc) || 0;
  }
  if (params.ten_quy_cach) {
    historyData.ten_quy_cach = String(params.ten_quy_cach).trim();
  }
  if (params.cap_ton) {
    historyData.cap_ton = params.cap_ton;
  }

  const creatorId = optionalObjectId(params.nguoi_tao_id, 'nguoi_tao_id');
  if (creatorId) {
    historyData.nguoi_tao_id = creatorId;
  }

  return LichSuKho.create([historyData], withSessionOptions({}, params.session)).then(rows => rows[0]);
}

async function resolveTenQuyCachFromParams(params) {
  const direct = normalizeTenQuyCach(params.ten_quy_cach || params.ten_thuoc_tinh);
  if (direct) return direct;
  const attrId = optionalObjectId(params.gia_tri_thuoc_tinh_id, 'gia_tri_thuoc_tinh_id');
  if (!attrId) return '';
  const attr = await GiaTriThuocTinh.findById(attrId).select('ten_gia_tri').lean();
  return normalizeTenQuyCach(attr && attr.ten_gia_tri);
}

async function lotHasQuyCachStock(khoId, hangHoaId, loHangId) {
  return Boolean(await TonKhoLoQuyCach.exists({
    kho_id: khoId,
    hang_hoa_id: hangHoaId,
    lo_hang_id: loHangId
  }));
}

async function productHasQuyCachStock(khoId, hangHoaId) {
  return Boolean(await TonKhoLoQuyCach.exists({
    kho_id: khoId,
    hang_hoa_id: hangHoaId,
    so_luong: { $gt: 0 }
  }));
}

async function resolveQuyCachStock(khoId, hangHoaId, loHangId, tenQuyCach) {
  const name = normalizeTenQuyCach(tenQuyCach);
  if (name) {
    const row = await TonKhoLoQuyCach.findOne({
      kho_id: khoId,
      hang_hoa_id: hangHoaId,
      lo_hang_id: loHangId,
      $or: [{ ten_quy_cach: name }, { ten_thuoc_tinh: name }]
    });
    if (!row) {
      throw new Error('Không tìm thấy tồn quy cách trong lô');
    }
    return row;
  }

  const rows = await TonKhoLoQuyCach.find({
    kho_id: khoId,
    hang_hoa_id: hangHoaId,
    lo_hang_id: loHangId,
    so_luong: { $gt: 0 }
  });
  if (!rows.length) return null;
  if (rows.length > 1) {
    throw new Error('Lô có nhiều quy cách, vui lòng kiểm kho theo từng quy cách');
  }
  return rows[0];
}

function withSessionOptions(options = {}, session) {
  return session ? Object.assign({}, options, { session }) : options;
}

function withSessionQuery(query, session) {
  return session ? query.session(session) : query;
}

async function syncTonKhoSauQuyCach(khoId, hangHoaId, loHangId, warehouse, cost, options = {}) {
  const session = options.session;
  const qcRows = await withSessionQuery(TonKhoLoQuyCach.find({
    kho_id: khoId,
    hang_hoa_id: hangHoaId,
    lo_hang_id: loHangId
  }), session).lean();
  const lotTotal = qcRows.reduce((sum, row) => sum + Number(row.so_luong || 0), 0);
  const weightedCost = qcRows.reduce((sum, row) => {
    return sum + Number(row.so_luong || 0) * Number(row.gia_von || 0);
  }, 0);
  const avgCost = lotTotal > 0 ? Math.round(weightedCost / lotTotal) : Number(cost || 0);

  await TonKhoLo.findOneAndUpdate(
    {
      kho_id: khoId,
      hang_hoa_id: hangHoaId,
      lo_hang_id: loHangId
    },
    {
      $setOnInsert: {
        cua_hang_id: warehouse.cua_hang_id,
        kho_id: khoId,
        hang_hoa_id: hangHoaId,
        lo_hang_id: loHangId
      },
      $set: {
        so_luong: lotTotal,
        gia_von: avgCost
      }
    },
    withSessionOptions({ upsert: true, new: true, setDefaultsOnInsert: true }, session)
  );

  const lot = await withSessionQuery(LoHang.findById(loHangId), session);
  if (lot) {
    lot.so_luong_con_lai = lotTotal;
    if (lot.trang_thai !== 'huy') {
      lot.trang_thai = lotTotal > 0 ? 'active' : 'het_hang';
    }
    await lot.save(withSessionOptions({}, session));
  }

  const lotRows = await withSessionQuery(TonKhoLo.find({
    kho_id: khoId,
    hang_hoa_id: hangHoaId
  }), session).lean();
  const productTotal = lotRows.reduce((sum, row) => sum + Number(row.so_luong || 0), 0);
  const inventory = await TonKho.findOneAndUpdate(
    {
      kho_id: khoId,
      hang_hoa_id: hangHoaId
    },
    {
      $setOnInsert: {
        cua_hang_id: warehouse.cua_hang_id,
        chi_nhanh_id: warehouse.chi_nhanh_id,
        kho_id: khoId,
        hang_hoa_id: hangHoaId
      },
      $set: {
        so_luong: productTotal
      }
    },
    withSessionOptions({ upsert: true, new: true, setDefaultsOnInsert: true }, session)
  );

  return { lotTotal, productTotal, inventory };
}

async function dieuChinhTonQuyCach(params, direction) {
  const khoId = toObjectId(params.kho_id, 'kho_id');
  const hangHoaId = toObjectId(params.hang_hoa_id, 'hang_hoa_id');
  const loHangId = toObjectId(params.lo_hang_id, 'lo_hang_id');
  const quantity = normalizeQuantity(params.so_luong);
  const cost = Number(params.gia_von) || 0;
  const warehouse = await getWarehouse(khoId);
  const tenQuyCach = await resolveTenQuyCachFromParams(params);
  if (!tenQuyCach) {
    throw new Error('Thiếu quy cách để điều chỉnh tồn');
  }

  let qcStock = await resolveQuyCachStock(khoId, hangHoaId, loHangId, tenQuyCach);
  if (!qcStock) {
    if (direction < 0) {
      throw new Error('Không tìm thấy tồn quy cách trong lô');
    }
    qcStock = await TonKhoLoQuyCach.create({
      cua_hang_id: warehouse.cua_hang_id,
      kho_id: khoId,
      hang_hoa_id: hangHoaId,
      lo_hang_id: loHangId,
      ten_quy_cach: tenQuyCach,
      ten_thuoc_tinh: tenQuyCach,
      so_luong: 0,
      don_gia_nhap: cost,
      gia_von: cost,
      thanh_tien: 0
    });
  }

  const beforeQc = Number(qcStock.so_luong || 0);
  const nextQc = beforeQc + direction * quantity;
  if (nextQc < 0) {
    throw new Error('Không cho tồn quy cách âm');
  }

  qcStock.so_luong = nextQc;
  if (cost) {
    qcStock.gia_von = cost;
    qcStock.don_gia_nhap = cost;
  }
  qcStock.thanh_tien = nextQc * (Number(qcStock.don_gia_nhap || qcStock.gia_von) || cost);
  if (!qcStock.ten_quy_cach && qcStock.ten_thuoc_tinh) qcStock.ten_quy_cach = qcStock.ten_thuoc_tinh;
  await qcStock.save();

  await ghiLichSuKho({
    kho_id: khoId,
    hang_hoa_id: hangHoaId,
    lo_hang_id: loHangId,
    ten_quy_cach: qcStock.ten_quy_cach || qcStock.ten_thuoc_tinh,
    cap_ton: 'quy_cach',
    nguoi_tao_id: params.nguoi_tao_id,
    loai_phieu: params.loai_phieu,
    ma_phieu: params.ma_phieu,
    so_luong_thay_doi: direction * quantity,
    ton_kho_truoc: beforeQc,
    ton_kho_sau: nextQc,
    gia_tri_thay_doi: direction * quantity * (Number(qcStock.gia_von) || cost),
    ghi_chu: params.ghi_chu
  });

  return syncTonKhoSauQuyCach(khoId, hangHoaId, loHangId, warehouse, cost);
}

async function truTonKhoQuyCach(params, inventory, quantity) {
  const khoId = toObjectId(params.kho_id, 'kho_id');
  const hangHoaId = toObjectId(params.hang_hoa_id, 'hang_hoa_id');
  const loHangId = optionalObjectId(params.lo_hang_id, 'lo_hang_id');
  const warehouse = await getWarehouse(khoId);
  const tenQuyCach = await resolveTenQuyCachFromParams(params);
  if (!tenQuyCach) {
    throw new Error('Thiếu quy cách để trừ tồn');
  }

  const qcFilter = {
    kho_id: khoId,
    hang_hoa_id: hangHoaId,
    $or: [{ ten_quy_cach: tenQuyCach }, { ten_thuoc_tinh: tenQuyCach }],
    so_luong: { $gt: 0 }
  };
  if (loHangId) qcFilter.lo_hang_id = loHangId;

  let qcRows = await TonKhoLoQuyCach.find(qcFilter)
    .populate('lo_hang_id')
    .sort({ updated_at: 1, created_at: 1 });
  qcRows = qcRows.filter(row => isSellableLot(row.lo_hang_id)).sort(sortLotsFefo);

  let remaining = quantity;
  const allocations = [];

  for (const qcStock of qcRows) {
    if (remaining <= 0) break;
    const lotId = qcStock.lo_hang_id?._id || qcStock.lo_hang_id;
    if (!lotId) continue;

    const lot = qcStock.lo_hang_id?._id ? qcStock.lo_hang_id : await LoHang.findById(lotId);
    const qcQty = Number(qcStock.so_luong || 0);
    const take = Math.min(qcQty, remaining);
    if (take <= 0) continue;

    const beforeQc = qcQty;
    qcStock.so_luong = beforeQc - take;
    qcStock.thanh_tien = qcStock.so_luong * (Number(qcStock.don_gia_nhap || qcStock.gia_von) || 0);
    if (!qcStock.ten_quy_cach && qcStock.ten_thuoc_tinh) qcStock.ten_quy_cach = qcStock.ten_thuoc_tinh;
    await qcStock.save();

    await syncTonKhoSauQuyCach(khoId, hangHoaId, lotId, warehouse);

    pushAllocation(allocations, lot, take);
    remaining -= take;
    await ghiLichSuKho({
      kho_id: khoId,
      hang_hoa_id: hangHoaId,
      lo_hang_id: lotId,
      ten_quy_cach: qcStock.ten_quy_cach || qcStock.ten_thuoc_tinh,
      cap_ton: 'quy_cach',
      nguoi_tao_id: params.nguoi_tao_id,
      loai_phieu: params.loai_phieu,
      ma_phieu: params.ma_phieu,
      so_luong_thay_doi: -take,
      ton_kho_truoc: beforeQc,
      ton_kho_sau: qcStock.so_luong,
      gia_tri_thay_doi: -(take * (Number(qcStock.gia_von) || 0)),
      ghi_chu: params.ghi_chu
    });
  }

  if (remaining > 0) {
    throw new Error('Tồn kho quy cách không đủ để trừ');
  }

  const refreshed = await TonKho.findOne({ kho_id: khoId, hang_hoa_id: hangHoaId });
  if (!refreshed || refreshed.so_luong < 0) {
    throw new Error('Tồn kho không đủ để trừ');
  }
  return finalizeTruTonKho(refreshed, allocations);
}

async function congTonKho(params) {
  const session = params.session;
  const khoId = toObjectId(params.kho_id, 'kho_id');
  const hangHoaId = toObjectId(params.hang_hoa_id, 'hang_hoa_id');
  let loHangId = optionalObjectId(params.lo_hang_id, 'lo_hang_id');
  const quantity = normalizeQuantity(params.so_luong);
  const cost = Number(params.gia_von) || 0;
  const warehouse = await withSessionQuery(Kho.findById(khoId), session);
  if (!warehouse) {
    throw new Error('KhÃ´ng tÃ¬m tháº¥y kho');
  }
  const product = await withSessionQuery(HangHoa.findById(hangHoaId).select('quan_ly_theo_lo'), session);
  const manageLots = Boolean(product && product.quan_ly_theo_lo);
  const tenQuyCach = await resolveTenQuyCachFromParams(params);
  const useQuyCach = Boolean(
    params.sync_quy_cach || tenQuyCach || (manageLots && loHangId && await lotHasQuyCachStock(khoId, hangHoaId, loHangId))
  );

  if (!manageLots) {
    loHangId = null;
  } else if (!loHangId) {
    throw new Error('Hàng hóa quản lý theo lô phải có lô hàng khi nhập kho');
  }

  if (manageLots && loHangId && useQuyCach) {
    if (!tenQuyCach) {
      throw new Error('Lô có quản lý quy cách, vui lòng truyền quy cách khi cộng tồn.');
    }
    const synced = await dieuChinhTonQuyCach(Object.assign({}, params, { ten_quy_cach: tenQuyCach }), 1);
    return synced.inventory;
  }

  const inventory = await TonKho.findOneAndUpdate(
    {
      kho_id: khoId,
      hang_hoa_id: hangHoaId
    },
    {
      $setOnInsert: {
        cua_hang_id: warehouse.cua_hang_id,
        chi_nhanh_id: warehouse.chi_nhanh_id,
        kho_id: khoId,
        hang_hoa_id: hangHoaId
      },
      $inc: {
        so_luong: quantity
      }
    },
    withSessionOptions({ upsert: true, new: true, setDefaultsOnInsert: true }, session)
  );

  if (loHangId) {
    await TonKhoLo.findOneAndUpdate(
      {
        kho_id: khoId,
        hang_hoa_id: hangHoaId,
        lo_hang_id: loHangId
      },
      {
        $setOnInsert: {
          cua_hang_id: warehouse.cua_hang_id,
          kho_id: khoId,
          hang_hoa_id: hangHoaId,
          lo_hang_id: loHangId
        },
        $set: {
          gia_von: cost
        },
        $inc: {
          so_luong: quantity
        }
      },
      withSessionOptions({ upsert: true, new: true, setDefaultsOnInsert: true }, session)
    );

    await LoHang.findByIdAndUpdate(loHangId, {
      $inc: {
        so_luong_con_lai: quantity
      }
    }, withSessionOptions({}, session));
  }

  await ghiLichSuKho({
    kho_id: khoId,
    hang_hoa_id: hangHoaId,
    lo_hang_id: loHangId,
    nguoi_tao_id: params.nguoi_tao_id,
    loai_phieu: params.loai_phieu,
    ma_phieu: params.ma_phieu,
    so_luong_thay_doi: quantity,
    ton_kho_sau: inventory.so_luong,
    gia_tri_thay_doi: quantity * cost,
    ghi_chu: params.ghi_chu,
    session
  });

  return inventory;
}

async function truTonKho(params) {
  const session = params.session;
  const khoId = toObjectId(params.kho_id, 'kho_id');
  const hangHoaId = toObjectId(params.hang_hoa_id, 'hang_hoa_id');
  let loHangId = optionalObjectId(params.lo_hang_id, 'lo_hang_id');
  const quantity = normalizeQuantity(params.so_luong);
  const product = await withSessionQuery(HangHoa.findById(hangHoaId).select('quan_ly_theo_lo'), session);
  const manageLots = Boolean(product && product.quan_ly_theo_lo);
  const tenQuyCach = await resolveTenQuyCachFromParams(params);
  const useQuyCach = Boolean(
    params.sync_quy_cach || tenQuyCach
  );

  if (!manageLots) {
    loHangId = null;
  }

  const inventory = await withSessionQuery(TonKho.findOne({
    kho_id: khoId,
    hang_hoa_id: hangHoaId
  }), session);

  if (!inventory || inventory.so_luong < quantity) {
    throw new Error('Tồn kho không đủ để trừ');
  }

  if (manageLots && useQuyCach) {
    return truTonKhoQuyCach(params, inventory, quantity);
  }

  if (manageLots && loHangId && await lotHasQuyCachStock(khoId, hangHoaId, loHangId)) {
    throw new Error(QUY_CACH_REQUIRED_MSG);
  }

  if (manageLots && !loHangId && await productHasQuyCachStock(khoId, hangHoaId)) {
    throw new Error(QUY_CACH_REQUIRED_MSG);
  }

  if (manageLots && !loHangId) {
    let remaining = quantity;
    const allocations = [];
    const lotRows = await withSessionQuery(TonKhoLo.find({
      kho_id: khoId,
      hang_hoa_id: hangHoaId,
      so_luong: { $gt: 0 }
    })
      .populate('lo_hang_id')
      .sort({ updated_at: 1, created_at: 1 }), session);

    const sellableLotRows = lotRows.filter(row => isSellableLot(row.lo_hang_id)).sort(sortLotsFefo);

    for (const row of sellableLotRows) {
      if (remaining <= 0) break;
      const take = Math.min(Number(row.so_luong || 0), remaining);
      if (take <= 0) continue;

      row.so_luong -= take;
      await row.save(withSessionOptions({}, session));

      if (row.lo_hang_id) {
        const lot = row.lo_hang_id;
        lot.so_luong_con_lai = Math.max(0, Number(lot.so_luong_con_lai || 0) - take);
        lot.trang_thai = lot.so_luong_con_lai > 0 ? lot.trang_thai : 'het_hang';
        await lot.save(withSessionOptions({}, session));
        pushAllocation(allocations, lot, take);
      }

      remaining -= take;
      await ghiLichSuKho({
        kho_id: khoId,
        hang_hoa_id: hangHoaId,
        lo_hang_id: row.lo_hang_id?._id || row.lo_hang_id,
        nguoi_tao_id: params.nguoi_tao_id,
        loai_phieu: params.loai_phieu,
        ma_phieu: params.ma_phieu,
        so_luong_thay_doi: -take,
        ton_kho_sau: inventory.so_luong - (quantity - remaining),
        gia_tri_thay_doi: -(take * (Number(row.gia_von) || 0)),
        ghi_chu: params.ghi_chu || 'Tự trừ theo FEFO'
      });
    }

    if (remaining > 0) {
      throw new Error('Tồn kho theo lô không đủ để trừ');
    }

    inventory.so_luong -= quantity;
    await inventory.save(withSessionOptions({}, session));
    return finalizeTruTonKho(inventory, allocations);
  }

  let lotInventory = null;
  const allocations = [];
  if (manageLots && loHangId) {
    lotInventory = await withSessionQuery(TonKhoLo.findOne({
      kho_id: khoId,
      hang_hoa_id: hangHoaId,
      lo_hang_id: loHangId
    }), session);

    if (!lotInventory || lotInventory.so_luong < quantity) {
      throw new Error('Tồn kho theo lô không đủ để trừ');
    }

    const lot = await withSessionQuery(LoHang.findById(loHangId), session);
    if (lot) {
      if ((lot.so_luong_con_lai || 0) < quantity) {
        throw new Error('Số lượng còn lại của lô không đủ để trừ');
      }

      lotInventory.so_luong -= quantity;
      await lotInventory.save(withSessionOptions({}, session));

      lot.so_luong_con_lai -= quantity;
      lot.trang_thai = lot.so_luong_con_lai > 0 ? lot.trang_thai : 'het_hang';
      await lot.save(withSessionOptions({}, session));
      pushAllocation(allocations, lot, quantity);
    }
  }

  inventory.so_luong -= quantity;
  await inventory.save(withSessionOptions({}, session));

  const unitCost = lotInventory ? Number(lotInventory.gia_von) || 0 : Number(params.gia_von) || 0;
  await ghiLichSuKho({
    kho_id: khoId,
    hang_hoa_id: hangHoaId,
    lo_hang_id: loHangId,
    nguoi_tao_id: params.nguoi_tao_id,
    loai_phieu: params.loai_phieu,
    ma_phieu: params.ma_phieu,
    so_luong_thay_doi: -quantity,
    ton_kho_sau: inventory.so_luong,
    gia_tri_thay_doi: -(quantity * unitCost),
    ghi_chu: params.ghi_chu
  });

  return finalizeTruTonKho(inventory, allocations);
}

async function layTonKhoTheoKho(kho_id) {
  const khoId = toObjectId(kho_id, 'kho_id');

  return TonKho.find({ kho_id: khoId })
    .populate('hang_hoa_id')
    .sort({ updated_at: -1, created_at: -1 });
}

async function layTonKhoTheoLo(kho_id, hang_hoa_id) {
  const khoId = toObjectId(kho_id, 'kho_id');
  const hangHoaId = toObjectId(hang_hoa_id, 'hang_hoa_id');

  return TonKhoLo.find({
    kho_id: khoId,
    hang_hoa_id: hangHoaId
  })
    .populate('lo_hang_id')
    .sort({ updated_at: -1, created_at: -1 });
}

module.exports = {
  congTonKho,
  truTonKho,
  ghiLichSuKho,
  syncTonKhoSauQuyCach,
  lotHasQuyCachStock,
  productHasQuyCachStock,
  resolveTenQuyCachFromParams,
  layTonKhoTheoKho,
  layTonKhoTheoLo
};
