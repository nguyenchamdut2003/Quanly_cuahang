const mongoose = require('mongoose');
const {
  Kho,
  HangHoa,
  TonKho,
  TonKhoLo,
  TonKhoLoQuyCach,
  LoHang
} = require('../models/kiot.model');
const { ghiLichSuKho } = require('./kho.service');

function toObjectId(value, fieldName) {
  if (!value) throw new Error(`Thiếu ${fieldName}`);
  if (value instanceof mongoose.Types.ObjectId) return value;
  if (!mongoose.Types.ObjectId.isValid(value)) throw new Error(`${fieldName} không hợp lệ`);
  return new mongoose.Types.ObjectId(value);
}

function normalizeTenQuyCach(value) {
  return String(value || '').trim();
}

function lotStockFilter(khoId, hangHoaId, loHangId) {
  return {
    kho_id: khoId,
    hang_hoa_id: hangHoaId,
    lo_hang_id: loHangId,
    $or: [{ gia_tri_thuoc_tinh_id: null }, { gia_tri_thuoc_tinh_id: { $exists: false } }]
  };
}

function quyCachNameFilter(tenQuyCach) {
  const name = normalizeTenQuyCach(tenQuyCach);
  return {
    $or: [{ ten_quy_cach: name }, { ten_thuoc_tinh: name }]
  };
}

async function lotHasQuyCachStock(khoId, hangHoaId, loHangId) {
  const count = await TonKhoLoQuyCach.countDocuments({
    kho_id: khoId,
    hang_hoa_id: hangHoaId,
    lo_hang_id: loHangId,
    so_luong: { $gt: 0 }
  });
  return count > 0;
}

async function findQuyCachStock(khoId, hangHoaId, loHangId, tenQuyCach) {
  return TonKhoLoQuyCach.findOne({
    kho_id: khoId,
    hang_hoa_id: hangHoaId,
    lo_hang_id: loHangId,
    ...quyCachNameFilter(tenQuyCach)
  });
}

async function syncTonKhoLoFromQuyCach(khoId, hangHoaId, loHangId, warehouse) {
  const qcRows = await TonKhoLoQuyCach.find({
    kho_id: khoId,
    hang_hoa_id: hangHoaId,
    lo_hang_id: loHangId
  }).lean();
  const total = qcRows.reduce((sum, row) => sum + Number(row.so_luong || 0), 0);
  const avgCost = qcRows.length
    ? qcRows.reduce((sum, row) => sum + Number(row.so_luong || 0) * Number(row.gia_von || 0), 0) / Math.max(total, 1)
    : 0;

  await TonKhoLo.findOneAndUpdate(
    lotStockFilter(khoId, hangHoaId, loHangId),
    {
      $setOnInsert: {
        cua_hang_id: warehouse.cua_hang_id,
        kho_id: khoId,
        hang_hoa_id: hangHoaId,
        lo_hang_id: loHangId
      },
      $set: {
        so_luong: total,
        gia_von: Math.floor(avgCost)
      }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  const lot = await LoHang.findById(loHangId);
  if (lot) {
    lot.so_luong_con_lai = total;
    lot.trang_thai = total > 0 ? (lot.trang_thai === 'huy' ? lot.trang_thai : 'active') : 'het_hang';
    await lot.save();
  }

  return total;
}

async function writeHistory(params) {
  return ghiLichSuKho({
    kho_id: params.kho_id,
    hang_hoa_id: params.hang_hoa_id,
    lo_hang_id: params.lo_hang_id,
    ten_quy_cach: params.ten_quy_cach,
    cap_ton: params.cap_ton,
    nguoi_tao_id: params.nguoi_tao_id,
    loai_phieu: params.loai_phieu || 'xuat_huy',
    ma_phieu: params.ma_phieu,
    so_luong_thay_doi: params.so_luong_thay_doi,
    ton_kho_truoc: params.ton_kho_truoc,
    ton_kho_sau: params.ton_kho_sau,
    gia_tri_thay_doi: params.gia_tri_thay_doi,
    ghi_chu: params.ghi_chu
  });
}

async function applyXuatHuyLine(ticket, row, userId) {
  const khoId = toObjectId(ticket.kho_id, 'kho_id');
  const hangHoaId = toObjectId(row.hang_hoa_id, 'hang_hoa_id');
  const quantity = Math.floor(Number(row.so_luong || 0));
  const cost = Number(row.gia_von) || 0;
  const warehouse = await Kho.findById(khoId);
  if (!warehouse) throw new Error('Không tìm thấy kho');

  const product = await HangHoa.findById(hangHoaId).select('quan_ly_theo_lo').lean();
  const manageLots = Boolean(product && product.quan_ly_theo_lo);
  const loHangId = manageLots ? toObjectId(row.lo_hang_id, 'lo_hang_id') : null;
  const tenQuyCach = normalizeTenQuyCach(row.ten_quy_cach);
  const logBase = {
    kho_id: khoId,
    hang_hoa_id: hangHoaId,
    lo_hang_id: loHangId,
    nguoi_tao_id: userId,
    loai_phieu: 'xuat_huy',
    ma_phieu: ticket.ma_xuat_huy,
    ghi_chu: row.ghi_chu || ticket.ly_do_huy || ticket.ghi_chu || 'Xuất hủy'
  };

  const inventory = await TonKho.findOne({ kho_id: khoId, hang_hoa_id: hangHoaId });
  if (!inventory || Number(inventory.so_luong || 0) < quantity) {
    throw new Error('Tồn kho không đủ để trừ');
  }
  const tonTruocTong = Number(inventory.so_luong || 0);

  if (!manageLots) {
    inventory.so_luong -= quantity;
    await inventory.save();
    await writeHistory(Object.assign({}, logBase, {
      cap_ton: 'tong',
      so_luong_thay_doi: -quantity,
      ton_kho_truoc: tonTruocTong,
      ton_kho_sau: inventory.so_luong,
      gia_tri_thay_doi: -(quantity * cost)
    }));
    return;
  }

  if (!loHangId) throw new Error('Hàng quản lý theo lô phải chọn lô hàng');

  const hasQc = tenQuyCach ? true : await lotHasQuyCachStock(khoId, hangHoaId, loHangId);

  if (hasQc) {
    if (!tenQuyCach) throw new Error('Lô có quy cách, vui lòng chọn quy cách cần hủy');
    const qcStock = await findQuyCachStock(khoId, hangHoaId, loHangId, tenQuyCach);
    if (!qcStock || Number(qcStock.so_luong || 0) < quantity) {
      throw new Error('Không cho hủy vượt tồn quy cách');
    }
    const tonTruocQc = Number(qcStock.so_luong || 0);
    qcStock.so_luong -= quantity;
    await qcStock.save();

    await writeHistory(Object.assign({}, logBase, {
      ten_quy_cach: tenQuyCach,
      cap_ton: 'quy_cach',
      so_luong_thay_doi: -quantity,
      ton_kho_truoc: tonTruocQc,
      ton_kho_sau: qcStock.so_luong,
      gia_tri_thay_doi: -(quantity * (Number(qcStock.gia_von) || cost))
    }));

    await syncTonKhoLoFromQuyCach(khoId, hangHoaId, loHangId, warehouse);
  } else {
    const lotInv = await TonKhoLo.findOne(lotStockFilter(khoId, hangHoaId, loHangId));
    if (!lotInv || Number(lotInv.so_luong || 0) < quantity) {
      throw new Error('Không cho hủy vượt tồn lô');
    }
    const lot = await LoHang.findById(loHangId);
    if (!lot || Number(lot.so_luong_con_lai || 0) < quantity) {
      throw new Error('Số lượng còn lại của lô không đủ');
    }
    const tonTruocLo = Number(lotInv.so_luong || 0);
    lotInv.so_luong -= quantity;
    await lotInv.save();
    lot.so_luong_con_lai -= quantity;
    lot.trang_thai = lot.so_luong_con_lai > 0 ? lot.trang_thai : 'het_hang';
    await lot.save();

    await writeHistory(Object.assign({}, logBase, {
      cap_ton: 'lo',
      so_luong_thay_doi: -quantity,
      ton_kho_truoc: tonTruocLo,
      ton_kho_sau: lotInv.so_luong,
      gia_tri_thay_doi: -(quantity * (Number(lotInv.gia_von) || cost))
    }));
  }

  inventory.so_luong -= quantity;
  await inventory.save();
  await writeHistory(Object.assign({}, logBase, {
    cap_ton: 'tong',
    so_luong_thay_doi: -quantity,
    ton_kho_truoc: tonTruocTong,
    ton_kho_sau: inventory.so_luong,
    gia_tri_thay_doi: -(quantity * cost),
    ghi_chu: (logBase.ghi_chu || '') + ' (tổng kho)'
  }));
}

async function reverseXuatHuyLine(ticket, row, userId) {
  const khoId = toObjectId(ticket.kho_id, 'kho_id');
  const hangHoaId = toObjectId(row.hang_hoa_id, 'hang_hoa_id');
  const quantity = Math.floor(Number(row.so_luong || 0));
  const cost = Number(row.gia_von) || 0;
  const warehouse = await Kho.findById(khoId);
  if (!warehouse) throw new Error('Không tìm thấy kho');

  const product = await HangHoa.findById(hangHoaId).select('quan_ly_theo_lo').lean();
  const manageLots = Boolean(product && product.quan_ly_theo_lo);
  const loHangId = manageLots ? toObjectId(row.lo_hang_id, 'lo_hang_id') : null;
  const tenQuyCach = normalizeTenQuyCach(row.ten_quy_cach);
  const logBase = {
    kho_id: khoId,
    hang_hoa_id: hangHoaId,
    lo_hang_id: loHangId,
    nguoi_tao_id: userId,
    loai_phieu: 'xuat_huy',
    ma_phieu: ticket.ma_xuat_huy,
    ghi_chu: 'Đảo hủy phiếu xuất hủy ' + (ticket.ma_xuat_huy || '')
  };

  let inventory = await TonKho.findOne({ kho_id: khoId, hang_hoa_id: hangHoaId });
  if (!inventory) {
    inventory = await TonKho.create({
      cua_hang_id: warehouse.cua_hang_id,
      chi_nhanh_id: warehouse.chi_nhanh_id,
      kho_id: khoId,
      hang_hoa_id: hangHoaId,
      so_luong: 0
    });
  }
  const tonTruocTong = Number(inventory.so_luong || 0);

  if (!manageLots) {
    inventory.so_luong += quantity;
    await inventory.save();
    await writeHistory(Object.assign({}, logBase, {
      cap_ton: 'tong',
      so_luong_thay_doi: quantity,
      ton_kho_truoc: tonTruocTong,
      ton_kho_sau: inventory.so_luong,
      gia_tri_thay_doi: quantity * cost
    }));
    return;
  }

  if (!loHangId) throw new Error('Thiếu lô hàng khi hoàn tồn');

  if (tenQuyCach) {
    let qcStock = await findQuyCachStock(khoId, hangHoaId, loHangId, tenQuyCach);
    const tonTruocQc = Number(qcStock && qcStock.so_luong || 0);
    if (!qcStock) {
      qcStock = await TonKhoLoQuyCach.create({
        cua_hang_id: warehouse.cua_hang_id,
        kho_id: khoId,
        hang_hoa_id: hangHoaId,
        lo_hang_id: loHangId,
        ten_quy_cach: tenQuyCach,
        so_luong: quantity,
        gia_von: cost
      });
    } else {
      qcStock.so_luong += quantity;
      await qcStock.save();
    }
    await writeHistory(Object.assign({}, logBase, {
      ten_quy_cach: tenQuyCach,
      cap_ton: 'quy_cach',
      so_luong_thay_doi: quantity,
      ton_kho_truoc: tonTruocQc,
      ton_kho_sau: qcStock.so_luong,
      gia_tri_thay_doi: quantity * (Number(qcStock.gia_von) || cost)
    }));
    await syncTonKhoLoFromQuyCach(khoId, hangHoaId, loHangId, warehouse);
  } else {
    let lotInv = await TonKhoLo.findOne(lotStockFilter(khoId, hangHoaId, loHangId));
    const tonTruocLo = Number(lotInv && lotInv.so_luong || 0);
    if (!lotInv) {
      lotInv = await TonKhoLo.create({
        cua_hang_id: warehouse.cua_hang_id,
        kho_id: khoId,
        hang_hoa_id: hangHoaId,
        lo_hang_id: loHangId,
        so_luong: quantity,
        gia_von: cost
      });
    } else {
      lotInv.so_luong += quantity;
      await lotInv.save();
    }
    const lot = await LoHang.findById(loHangId);
    if (lot) {
      lot.so_luong_con_lai += quantity;
      if (lot.trang_thai === 'het_hang') lot.trang_thai = 'active';
      await lot.save();
    }
    await writeHistory(Object.assign({}, logBase, {
      cap_ton: 'lo',
      so_luong_thay_doi: quantity,
      ton_kho_truoc: tonTruocLo,
      ton_kho_sau: lotInv.so_luong,
      gia_tri_thay_doi: quantity * cost
    }));
  }

  inventory.so_luong += quantity;
  await inventory.save();
  await writeHistory(Object.assign({}, logBase, {
    cap_ton: 'tong',
    so_luong_thay_doi: quantity,
    ton_kho_truoc: tonTruocTong,
    ton_kho_sau: inventory.so_luong,
    gia_tri_thay_doi: quantity * cost
  }));
}

async function loadQuyCachTonForLot(khoId, hangHoaId, loHangId) {
  const rows = await TonKhoLoQuyCach.find({
    kho_id: khoId,
    hang_hoa_id: hangHoaId,
    lo_hang_id: loHangId,
    so_luong: { $gt: 0 }
  }).sort({ ten_quy_cach: 1 }).lean();

  return rows.map(row => ({
    ten_quy_cach: normalizeTenQuyCach(row.ten_quy_cach || row.ten_thuoc_tinh),
    ton_hien_tai: Number(row.so_luong || 0),
    gia_von: Number(row.gia_von || 0)
  })).filter(row => row.ten_quy_cach && row.ton_hien_tai > 0);
}

module.exports = {
  normalizeTenQuyCach,
  lotHasQuyCachStock,
  loadQuyCachTonForLot,
  applyXuatHuyLine,
  reverseXuatHuyLine,
  lotStockFilter
};
