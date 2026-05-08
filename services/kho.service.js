const mongoose = require('mongoose');
const {
  Kho,
  HangHoa,
  TonKho,
  LoHang,
  TonKhoLo,
  LichSuKho
} = require('../models/kiot.model');

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

  const creatorId = optionalObjectId(params.nguoi_tao_id, 'nguoi_tao_id');
  if (creatorId) {
    historyData.nguoi_tao_id = creatorId;
  }

  return LichSuKho.create(historyData);
}

async function congTonKho(params) {
  const khoId = toObjectId(params.kho_id, 'kho_id');
  const hangHoaId = toObjectId(params.hang_hoa_id, 'hang_hoa_id');
  let loHangId = optionalObjectId(params.lo_hang_id, 'lo_hang_id');
  const quantity = normalizeQuantity(params.so_luong);
  const cost = Number(params.gia_von) || 0;
  const warehouse = await getWarehouse(khoId);
  const product = await HangHoa.findById(hangHoaId).select('quan_ly_theo_lo');
  const manageLots = Boolean(product && product.quan_ly_theo_lo);

  if (!manageLots) {
    loHangId = null;
  } else if (!loHangId) {
    throw new Error('Hàng hóa quản lý theo lô phải có lô hàng khi nhập kho');
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
    { upsert: true, new: true, setDefaultsOnInsert: true }
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
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    await LoHang.findByIdAndUpdate(loHangId, {
      $inc: {
        so_luong_con_lai: quantity
      }
    });
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
    ghi_chu: params.ghi_chu
  });

  return inventory;
}

async function truTonKho(params) {
  const khoId = toObjectId(params.kho_id, 'kho_id');
  const hangHoaId = toObjectId(params.hang_hoa_id, 'hang_hoa_id');
  let loHangId = optionalObjectId(params.lo_hang_id, 'lo_hang_id');
  const quantity = normalizeQuantity(params.so_luong);
  const product = await HangHoa.findById(hangHoaId).select('quan_ly_theo_lo');
  const manageLots = Boolean(product && product.quan_ly_theo_lo);

  if (!manageLots) {
    loHangId = null;
  }

  const inventory = await TonKho.findOne({
    kho_id: khoId,
    hang_hoa_id: hangHoaId
  });

  if (!inventory || inventory.so_luong < quantity) {
    throw new Error('Tồn kho không đủ để trừ');
  }

  if (manageLots && !loHangId) {
    let remaining = quantity;
    const lotRows = await TonKhoLo.find({
      kho_id: khoId,
      hang_hoa_id: hangHoaId,
      so_luong: { $gt: 0 }
    })
      .populate('lo_hang_id')
      .sort({ updated_at: 1, created_at: 1 });

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const sellableLotRows = lotRows.filter(row => {
      const lot = row.lo_hang_id;
      if (!lot || lot.trang_thai === 'huy') return false;
      if (!lot.han_su_dung) return true;
      const expiry = new Date(lot.han_su_dung);
      expiry.setHours(0, 0, 0, 0);
      return expiry.getTime() >= today.getTime();
    });

    sellableLotRows.sort((a, b) => {
      const aDate = a.lo_hang_id && a.lo_hang_id.han_su_dung ? new Date(a.lo_hang_id.han_su_dung).getTime() : Number.MAX_SAFE_INTEGER;
      const bDate = b.lo_hang_id && b.lo_hang_id.han_su_dung ? new Date(b.lo_hang_id.han_su_dung).getTime() : Number.MAX_SAFE_INTEGER;
      if (aDate !== bDate) return aDate - bDate;
      return new Date(a.updated_at || a.created_at || 0).getTime() - new Date(b.updated_at || b.created_at || 0).getTime();
    });

    for (const row of sellableLotRows) {
      if (remaining <= 0) break;
      const take = Math.min(Number(row.so_luong || 0), remaining);
      if (take <= 0) continue;

      row.so_luong -= take;
      await row.save();

      if (row.lo_hang_id) {
        const lot = row.lo_hang_id;
        lot.so_luong_con_lai = Math.max(0, Number(lot.so_luong_con_lai || 0) - take);
        lot.trang_thai = lot.so_luong_con_lai > 0 ? lot.trang_thai : 'het_hang';
        await lot.save();
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
    await inventory.save();
    return inventory;
  }

  let lotInventory = null;
  if (manageLots && loHangId) {
    lotInventory = await TonKhoLo.findOne({
      kho_id: khoId,
      hang_hoa_id: hangHoaId,
      lo_hang_id: loHangId
    });

    if (!lotInventory || lotInventory.so_luong < quantity) {
      throw new Error('Tồn kho theo lô không đủ để trừ');
    }

    const lot = await LoHang.findById(loHangId);
    if (lot) {
      if ((lot.so_luong_con_lai || 0) < quantity) {
        throw new Error('Số lượng còn lại của lô không đủ để trừ');
      }

      lotInventory.so_luong -= quantity;
      await lotInventory.save();

      lot.so_luong_con_lai -= quantity;
      lot.trang_thai = lot.so_luong_con_lai > 0 ? lot.trang_thai : 'het_hang';
      await lot.save();
    }
  }

  inventory.so_luong -= quantity;
  await inventory.save();

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

  return inventory;
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
  layTonKhoTheoKho,
  layTonKhoTheoLo
};
