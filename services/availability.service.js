const mongoose = require('mongoose');
const { DonHang, CTDonHang } = require('../models/kiot.model');

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
    return { byProduct: {}, byVariant: {} };
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
        'don_hang.trang_thai': { $nin: ['cancelled', 'completed', 'merged'] },
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

  const byProduct = {};
  const byVariant = {};
  rows.forEach(row => {
    const hangHoaId = String(row._id.hang_hoa_id || '');
    const giaTriThuocTinhId = row._id.gia_tri_thuoc_tinh_id ? String(row._id.gia_tri_thuoc_tinh_id) : '';
    const tenQuyCach = String(row._id.ten_quy_cach || '').trim();
    const quantity = Number(row.so_luong_khach_dat || 0);

    if (!byProduct[hangHoaId]) {
      byProduct[hangHoaId] = { hang_hoa_id: hangHoaId, so_luong_khach_dat: 0 };
    }
    byProduct[hangHoaId].so_luong_khach_dat += quantity;

    const variantKey = buildVariantKey({
      hang_hoa_id: hangHoaId,
      gia_tri_thuoc_tinh_id: giaTriThuocTinhId,
      ten_quy_cach: tenQuyCach
    });
    byVariant[variantKey] = {
      hang_hoa_id: hangHoaId,
      gia_tri_thuoc_tinh_id: giaTriThuocTinhId,
      ten_quy_cach: tenQuyCach,
      so_luong_khach_dat: quantity
    };
    if (giaTriThuocTinhId && tenQuyCach) {
      const fallbackVariantKey = buildVariantKey({
        hang_hoa_id: hangHoaId,
        gia_tri_thuoc_tinh_id: '',
        ten_quy_cach: tenQuyCach
      });
      if (!byVariant[fallbackVariantKey]) {
        byVariant[fallbackVariantKey] = {
          hang_hoa_id: hangHoaId,
          gia_tri_thuoc_tinh_id: '',
          ten_quy_cach: tenQuyCach,
          so_luong_khach_dat: 0
        };
      }
      byVariant[fallbackVariantKey].so_luong_khach_dat += quantity;
    }
  });

  return { byProduct, byVariant };
}

module.exports = {
  buildVariantKey,
  getReservedQuantitiesByOrder
};
