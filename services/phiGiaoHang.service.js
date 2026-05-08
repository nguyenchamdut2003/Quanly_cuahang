const { BangGiaVanChuyen, PhiVanChuyenKhachHang, VanDon } = require('../models/kiot.model');

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function applyMinimumFee(fee, priceList) {
  const calculatedFee = Math.max(0, Number(fee || 0));
  const minimumFee = Math.max(0, Number(priceList?.phi_toi_thieu || 0));
  return Math.max(calculatedFee, minimumFee);
}

async function findPriceLists({ cua_hang_id, doi_tac_giao_hang_id }) {
  const filter = { trang_thai: 'active' };
  if (cua_hang_id) filter.cua_hang_id = cua_hang_id;
  if (doi_tac_giao_hang_id) filter.doi_tac_giao_hang_id = doi_tac_giao_hang_id;
  return BangGiaVanChuyen.find(filter).sort({ updated_at: -1, created_at: -1 }).lean();
}

async function findCustomerShippingFee({ khach_hang_id, dia_chi_khach_hang_id, doi_tac_giao_hang_id }) {
  if (!khach_hang_id || !dia_chi_khach_hang_id || !doi_tac_giao_hang_id) return null;
  return PhiVanChuyenKhachHang.findOne({
    khach_hang_id,
    dia_chi_khach_hang_id,
    doi_tac_giao_hang_id,
    trang_thai: 'active'
  }).lean();
}

async function findRecentShipmentFee({ khach_hang_id, dia_chi_khach_hang_id, doi_tac_giao_hang_id, dia_chi_nhan }) {
  if (!khach_hang_id || !dia_chi_khach_hang_id || !doi_tac_giao_hang_id) return null;
  const filter = {
    khach_hang_id,
    doi_tac_giao_hang_id,
    trang_thai: 'completed',
    phi_giao_hang: { $gte: 0 }
  };
  const addressText = String(dia_chi_nhan || '').trim();
  filter.$or = [{ dia_chi_khach_hang_id }];
  if (addressText) filter.$or.push({ dia_chi_nhan: addressText });

  return VanDon.findOne(filter).sort({ updated_at: -1, created_at: -1 }).lean();
}

async function luuPhiVanChuyenKhachHang({
  cua_hang_id,
  khach_hang_id,
  dia_chi_khach_hang_id,
  doi_tac_giao_hang_id,
  phi_van_chuyen,
  ghi_chu
}) {
  if (!khach_hang_id || !dia_chi_khach_hang_id || !doi_tac_giao_hang_id) return null;
  const fee = Number(phi_van_chuyen);
  if (!Number.isFinite(fee) || fee < 0) return null;

  return PhiVanChuyenKhachHang.findOneAndUpdate(
    { khach_hang_id, dia_chi_khach_hang_id, doi_tac_giao_hang_id },
    {
      $set: {
        cua_hang_id: cua_hang_id || null,
        phi_van_chuyen: fee,
        ghi_chu,
        trang_thai: 'active'
      }
    },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
  );
}

async function tinhPhiGiaoHang({
  cua_hang_id,
  khach_hang_id,
  dia_chi_khach_hang_id,
  doi_tac_giao_hang_id,
  diem_di,
  diem_den,
  khoang_cach_km
}) {
  const customerFee = await findCustomerShippingFee({
    khach_hang_id,
    dia_chi_khach_hang_id,
    doi_tac_giao_hang_id
  });
  if (customerFee) {
    return {
      success: true,
      phi_giao_hang: Math.max(0, Number(customerFee.phi_van_chuyen || 0)),
      loai_tinh_phi: 'theo_khach_hang',
      nguon_phi: 'bang_phi_khach_hang',
      phi_van_chuyen_khach_hang_id: customerFee._id,
      bang_gia_id: null,
      cho_phep_nhap_tay: true
    };
  }

  const recentShipment = await findRecentShipmentFee({
    khach_hang_id,
    dia_chi_khach_hang_id,
    doi_tac_giao_hang_id,
    dia_chi_nhan: diem_den
  });
  if (recentShipment) {
    return {
      success: true,
      phi_giao_hang: Math.max(0, Number(recentShipment.phi_giao_hang || 0)),
      loai_tinh_phi: 'lich_su_van_don',
      nguon_phi: 'lich_su_van_don',
      van_don_id: recentShipment._id,
      bang_gia_id: null,
      cho_phep_nhap_tay: true
    };
  }

  const priceLists = await findPriceLists({ cua_hang_id, doi_tac_giao_hang_id });
  const startPoint = normalizeText(diem_di);
  const endPoint = normalizeText(diem_den);
  const distance = Math.max(0, Number(khoang_cach_km || 0));

  const routePrice = priceLists.find(item =>
    item.loai_tinh_phi === 'theo_tuyen' &&
    normalizeText(item.diem_di) === startPoint &&
    normalizeText(item.diem_den) === endPoint
  );
  if (routePrice) {
    return {
      success: true,
      phi_giao_hang: applyMinimumFee(routePrice.phi_co_dinh, routePrice),
      loai_tinh_phi: 'theo_tuyen',
      nguon_phi: 'bang_gia_van_chuyen',
      bang_gia_id: routePrice._id,
      cho_phep_nhap_tay: true
    };
  }

  const distancePrice = priceLists.find(item => item.loai_tinh_phi === 'theo_km');
  if (distancePrice) {
    return {
      success: true,
      phi_giao_hang: applyMinimumFee(distance * Number(distancePrice.don_gia_km || 0), distancePrice),
      loai_tinh_phi: 'theo_km',
      nguon_phi: 'bang_gia_van_chuyen',
      bang_gia_id: distancePrice._id,
      cho_phep_nhap_tay: true
    };
  }

  const fixedPrice = priceLists.find(item => item.loai_tinh_phi === 'co_dinh');
  if (fixedPrice) {
    return {
      success: true,
      phi_giao_hang: applyMinimumFee(fixedPrice.phi_co_dinh, fixedPrice),
      loai_tinh_phi: 'co_dinh',
      nguon_phi: 'bang_gia_van_chuyen',
      bang_gia_id: fixedPrice._id,
      cho_phep_nhap_tay: true
    };
  }

  return {
    success: true,
    phi_giao_hang: 0,
    loai_tinh_phi: null,
    nguon_phi: null,
    bang_gia_id: null,
    cho_phep_nhap_tay: true,
    message: 'Không có bảng giá vận chuyển phù hợp'
  };
}

module.exports = {
  tinhPhiGiaoHang,
  luuPhiVanChuyenKhachHang
};
