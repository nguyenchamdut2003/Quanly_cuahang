// Quantities (kg, litres, ...) retain up to six decimal places. Currency is
// deliberately handled by the existing payment/price normalizers instead.
function stockQuantity(value, { allowZero = true } = {}) {
  const quantity = Number(value == null || value === '' ? 0 : value);
  const scaled = quantity * 1000000;
  if (typeof value === 'boolean' || !Number.isFinite(quantity) || quantity < 0 || (!allowZero && quantity === 0)
      || Math.abs(scaled) > Number.MAX_SAFE_INTEGER
      || Math.abs(scaled - Math.round(scaled)) > 0.00001) {
    throw new Error('Số lượng không hợp lệ; chỉ dùng số không âm với tối đa 6 chữ số thập phân.');
  }
  return Math.round(scaled) / 1000000;
}

module.exports = { stockQuantity };
