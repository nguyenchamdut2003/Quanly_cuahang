const mongoose = require('mongoose');
const { CTDonHang, CTHoaDonBanHang } = require('../models/kiot.model');

function toObjectId(value) {
  if (!value) return null;
  if (value instanceof mongoose.Types.ObjectId) return value;
  if (!mongoose.Types.ObjectId.isValid(String(value))) return null;
  return new mongoose.Types.ObjectId(String(value));
}

function buildVariantKey({ hang_hoa_id, gia_tri_thuoc_tinh_id, ten_quy_cach }) {
  return [
    String(hang_hoa_id || ''),
    String(gia_tri_thuoc_tinh_id || ''),
    String(ten_quy_cach || '').trim()
  ].join('|');
}

function buildLotKey(hang_hoa_id, lo_hang_id) {
  return `${String(hang_hoa_id || '')}|${String(lo_hang_id || '')}`;
}

function createReservedMaps() {
  return { byProduct: {}, byVariant: {}, byLot: {} };
}

function addReservedQuantity(maps, {
  hangHoaId,
  giaTriThuocTinhId = '',
  tenQuyCach = '',
  loHangId = '',
  quantity = 0
}) {
  const qty = Math.max(0, Number(quantity) || 0);
  if (!hangHoaId || qty <= 0) return maps;

  if (!maps.byProduct[hangHoaId]) {
    maps.byProduct[hangHoaId] = { hang_hoa_id: hangHoaId, so_luong_khach_dat: 0 };
  }
  maps.byProduct[hangHoaId].so_luong_khach_dat += qty;

  const variantKey = buildVariantKey({
    hang_hoa_id: hangHoaId,
    gia_tri_thuoc_tinh_id: giaTriThuocTinhId,
    ten_quy_cach: tenQuyCach
  });
  if (!maps.byVariant[variantKey]) {
    maps.byVariant[variantKey] = {
      hang_hoa_id: hangHoaId,
      gia_tri_thuoc_tinh_id: giaTriThuocTinhId,
      ten_quy_cach: tenQuyCach,
      so_luong_khach_dat: 0
    };
  }
  maps.byVariant[variantKey].so_luong_khach_dat += qty;

  if (giaTriThuocTinhId && tenQuyCach) {
    const fallbackVariantKey = buildVariantKey({
      hang_hoa_id: hangHoaId,
      gia_tri_thuoc_tinh_id: '',
      ten_quy_cach: tenQuyCach
    });
    if (!maps.byVariant[fallbackVariantKey]) {
      maps.byVariant[fallbackVariantKey] = {
        hang_hoa_id: hangHoaId,
        gia_tri_thuoc_tinh_id: '',
        ten_quy_cach: tenQuyCach,
        so_luong_khach_dat: 0
      };
    }
    maps.byVariant[fallbackVariantKey].so_luong_khach_dat += qty;
  }

  if (loHangId) {
    const lotKey = buildLotKey(hangHoaId, loHangId);
    if (!maps.byLot[lotKey]) {
      maps.byLot[lotKey] = {
        hang_hoa_id: hangHoaId,
        lo_hang_id: loHangId,
        so_luong_khach_dat: 0
      };
    }
    maps.byLot[lotKey].so_luong_khach_dat += qty;
  }

  return maps;
}

function mergeReservedMaps(target, source) {
  Object.entries(source?.byProduct || {}).forEach(([key, row]) => {
    if (!target.byProduct[key]) {
      target.byProduct[key] = {
        hang_hoa_id: row.hang_hoa_id,
        so_luong_khach_dat: 0
      };
    }
    target.byProduct[key].so_luong_khach_dat += Number(row.so_luong_khach_dat || 0);
  });
  Object.entries(source?.byVariant || {}).forEach(([key, row]) => {
    if (!target.byVariant[key]) {
      target.byVariant[key] = {
        hang_hoa_id: row.hang_hoa_id,
        gia_tri_thuoc_tinh_id: row.gia_tri_thuoc_tinh_id,
        ten_quy_cach: row.ten_quy_cach,
        so_luong_khach_dat: 0
      };
    }
    target.byVariant[key].so_luong_khach_dat += Number(row.so_luong_khach_dat || 0);
  });
  Object.entries(source?.byLot || {}).forEach(([key, row]) => {
    if (!target.byLot[key]) {
      target.byLot[key] = {
        hang_hoa_id: row.hang_hoa_id,
        lo_hang_id: row.lo_hang_id,
        so_luong_khach_dat: 0
      };
    }
    target.byLot[key].so_luong_khach_dat += Number(row.so_luong_khach_dat || 0);
  });
  return target;
}

function rowsToReservedMaps(rows = []) {
  const maps = createReservedMaps();
  rows.forEach(row => {
    const hangHoaId = String(row._id?.hang_hoa_id || '');
    const giaTriThuocTinhId = row._id?.gia_tri_thuoc_tinh_id ? String(row._id.gia_tri_thuoc_tinh_id) : '';
    const tenQuyCach = String(row._id?.ten_quy_cach || '').trim();
    const loHangId = row._id?.lo_hang_id ? String(row._id.lo_hang_id) : '';
    addReservedQuantity(maps, {
      hangHoaId,
      giaTriThuocTinhId,
      tenQuyCach,
      loHangId,
      quantity: row.so_luong_khach_dat
    });
  });
  return maps;
}

async function getReservedQuantitiesByOrder({
  kho_id,
  hang_hoa_ids,
  exclude_don_hang_id = null,
  session = null
} = {}) {
  const khoId = toObjectId(kho_id);
  const productIds = [...new Set((hang_hoa_ids || []).map(toObjectId).filter(Boolean).map(String))]
    .map(id => new mongoose.Types.ObjectId(id));

  if (!khoId || !productIds.length) {
    return createReservedMaps();
  }

  const excludedOrderId = toObjectId(exclude_don_hang_id);
  const pipeline = [
    {
      $match: {
        hang_hoa_id: { $in: productIds },
        trang_thai_giao: { $ne: 'giao_du' }
      }
    },
    {
      $lookup: {
        from: 'don_hang',
        localField: 'don_hang_id',
        foreignField: '_id',
        as: 'don_hang'
      }
    },
    { $unwind: '$don_hang' },
    {
      $match: {
        'don_hang.kho_id': khoId,
        'don_hang.trang_thai': { $nin: ['cancelled', 'merged'] },
        'don_hang.trang_thai_giao_hang': { $ne: 'giao_du' },
        ...(excludedOrderId ? { 'don_hang._id': { $ne: excludedOrderId } } : {})
      }
    },
    {
      $addFields: {
        remaining: {
          $max: [
            {
              $ifNull: [
                '$so_luong_con_thieu',
                {
                  $subtract: [
                    { $ifNull: ['$so_luong_dat', { $ifNull: ['$so_luong', 0] }] },
                    { $ifNull: ['$so_luong_da_giao', 0] }
                  ]
                }
              ]
            },
            0
          ]
        }
      }
    },
    { $match: { remaining: { $gt: 0 } } },
    {
      $group: {
        _id: {
          hang_hoa_id: '$hang_hoa_id',
          lo_hang_id: '$lo_hang_id',
          gia_tri_thuoc_tinh_id: '$gia_tri_thuoc_tinh_id',
          ten_quy_cach: '$ten_quy_cach'
        },
        so_luong_khach_dat: { $sum: '$remaining' }
      }
    }
  ];

  const query = CTDonHang.aggregate(pipeline);
  if (session) query.session(session);
  const rows = await query;
  return rowsToReservedMaps(rows);
}

async function getReservedQuantitiesByDirectInvoice({
  kho_id,
  hang_hoa_ids,
  exclude_hoa_don_id = null,
  session = null
} = {}) {
  const khoId = toObjectId(kho_id);
  const productIds = [...new Set((hang_hoa_ids || []).map(toObjectId).filter(Boolean).map(String))]
    .map(id => new mongoose.Types.ObjectId(id));

  if (!khoId || !productIds.length) {
    return createReservedMaps();
  }

  const excludedInvoiceId = toObjectId(exclude_hoa_don_id);
  const pipeline = [
    {
      $match: {
        hang_hoa_id: { $in: productIds },
        so_luong: { $gt: 0 }
      }
    },
    {
      $lookup: {
        from: 'hoa_don_ban_hang',
        localField: 'hoa_don_id',
        foreignField: '_id',
        as: 'hoa_don'
      }
    },
    { $unwind: '$hoa_don' },
    {
      $match: {
        'hoa_don.kho_id': khoId,
        'hoa_don.trang_thai': { $ne: 'cancelled' },
        'hoa_don.da_tru_ton_kho': { $ne: true },
        $or: [
          { 'hoa_don.don_hang_id': { $exists: false } },
          { 'hoa_don.don_hang_id': null }
        ],
        ...(excludedInvoiceId ? { 'hoa_don._id': { $ne: excludedInvoiceId } } : {})
      }
    },
    {
      $group: {
        _id: {
          hang_hoa_id: '$hang_hoa_id',
          lo_hang_id: '$lo_hang_id',
          gia_tri_thuoc_tinh_id: '$gia_tri_thuoc_tinh_id',
          ten_quy_cach: '$ten_quy_cach'
        },
        so_luong_khach_dat: { $sum: '$so_luong' }
      }
    }
  ];

  const query = CTHoaDonBanHang.aggregate(pipeline);
  if (session) query.session(session);
  const rows = await query;
  return rowsToReservedMaps(rows);
}

async function getReservedQuantitiesForSale(options = {}) {
  const [orderReserved, invoiceReserved] = await Promise.all([
    getReservedQuantitiesByOrder(options),
    getReservedQuantitiesByDirectInvoice(options)
  ]);
  const merged = createReservedMaps();
  mergeReservedMaps(merged, orderReserved);
  mergeReservedMaps(merged, invoiceReserved);
  return merged;
}

module.exports = {
  buildVariantKey,
  buildLotKey,
  getReservedQuantitiesByOrder,
  getReservedQuantitiesByDirectInvoice,
  getReservedQuantitiesForSale
};