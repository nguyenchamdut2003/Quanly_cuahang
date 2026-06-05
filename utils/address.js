function cleanPart(value) {
  return String(value || '').trim();
}

function buildFullAddress(input) {
  input = input || {};
  return [
    cleanPart(input.dia_chi_chi_tiet),
    cleanPart(input.phuong_xa),
    cleanPart(input.tinh_thanh)
  ].filter(Boolean).join(', ');
}

function normalizeAddress(input) {
  input = input || {};
  var diaChiChiTiet = cleanPart(input.dia_chi_chi_tiet);
  var phuongXa = cleanPart(input.phuong_xa);
  var tinhThanh = cleanPart(input.tinh_thanh);
  var tinhThanhId = Number(input.tinh_thanh_id || 0) || null;
  var phuongXaCode = cleanPart(input.phuong_xa_code);
  return {
    dia_chi_chi_tiet: diaChiChiTiet,
    phuong_xa: phuongXa,
    tinh_thanh: tinhThanh,
    tinh_thanh_id: tinhThanhId,
    phuong_xa_code: phuongXaCode,
    dia_chi_day_du: cleanPart(input.dia_chi_day_du) || buildFullAddress({
      dia_chi_chi_tiet: diaChiChiTiet,
      phuong_xa: phuongXa,
      tinh_thanh: tinhThanh
    })
  };
}

module.exports = {
  buildFullAddress,
  normalizeAddress
};
