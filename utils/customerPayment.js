const CHANGE_RECEIPT_LOAI_THU_CHI = 'tra_tien_thua_khach';

function parsePaymentNumber(value) {
  return Number(String(value ?? '').replace(/\./g, '').replace(/,/g, '')) || 0;
}

function hasSplitPaymentFields(body = {}) {
  return [
    'tien_mat_khach_dua',
    'tien_mat',
    'chuyen_khoan_khach_dua',
    'chuyen_khoan',
    'tien_thua_tra_khach',
    'tien_thua'
  ].some(key => body[key] !== undefined && body[key] !== null && String(body[key]).trim() !== '');
}

/**
 * Chuẩn hóa input thanh toán khách (tiền mặt / CK / tiền thừa).
 * Hỗ trợ legacy: một field khach_thanh_toan hoặc gia_tri = thực thu (toàn bộ tiền mặt, không thừa).
 */
function normalizeCustomerPaymentInput(body = {}, options = {}) {
  const tien_mat = Math.max(0, parsePaymentNumber(body.tien_mat_khach_dua ?? body.tien_mat));
  const chuyen_khoan = Math.max(0, parsePaymentNumber(body.chuyen_khoan_khach_dua ?? body.chuyen_khoan));
  let tien_thua = Math.max(0, parsePaymentNumber(body.tien_thua_tra_khach ?? body.tien_thua));

  const legacyThucThu = parsePaymentNumber(body.khach_thanh_toan ?? body.gia_tri);
  const hasSplit = hasSplitPaymentFields(body);

  let tien_mat_final = tien_mat;
  let chuyen_khoan_final = chuyen_khoan;

  if (!hasSplit && legacyThucThu > 0 && tien_mat + chuyen_khoan === 0 && tien_thua === 0) {
    tien_mat_final = legacyThucThu;
    chuyen_khoan_final = 0;
    tien_thua = 0;
  }

  const tong_khach_dua = tien_mat_final + chuyen_khoan_final;
  const tien_thua_final = tien_thua;
  const thuc_thu = tong_khach_dua - tien_thua_final;

  const errors = [];
  if (tien_thua_final > tong_khach_dua) {
    errors.push('Tiền thừa không được vượt tổng khách đưa');
  }
  if (options.requirePayment && tong_khach_dua <= 0) {
    errors.push('Vui lòng nhập số tiền khách đưa');
  }
  if (options.requirePayment && thuc_thu <= 0) {
    errors.push('Thực thu phải lớn hơn 0');
  }
  if (options.so_tien_con_phai_thu !== undefined && thuc_thu > options.so_tien_con_phai_thu) {
    errors.push(
      `Thực thu không được vượt số còn phải thu (${Number(options.so_tien_con_phai_thu).toLocaleString('vi-VN')} VNĐ)`
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    tien_mat: tien_mat_final,
    chuyen_khoan: chuyen_khoan_final,
    tien_thua: tien_thua_final,
    tong_khach_dua,
    thuc_thu
  };
}

function computeNetPaidFromReceiptRows(receipts = []) {
  let thuTotal = 0;
  let changeTotal = 0;
  for (const row of receipts) {
    if (row.trang_thai === 'cancelled') continue;
    const val = Number(row.gia_tri || 0);
    if (row.loai_phieu === 'thu') {
      thuTotal += val;
    } else if (row.loai_phieu === 'chi' && row.loai_thu_chi === CHANGE_RECEIPT_LOAI_THU_CHI) {
      changeTotal += val;
    }
  }
  return Math.max(0, thuTotal - changeTotal);
}

function receiptRowsForNetPaidFilter(extra = {}) {
  const { $or: extraOr, $and: extraAnd, trang_thai: _trangThai, ...rest } = extra;
  const andConditions = [
    {
      $or: [
        { loai_phieu: 'thu' },
        { loai_phieu: 'chi', loai_thu_chi: CHANGE_RECEIPT_LOAI_THU_CHI }
      ]
    }
  ];
  if (extraOr) andConditions.push({ $or: extraOr });
  if (extraAnd) andConditions.push(...(Array.isArray(extraAnd) ? extraAnd : [extraAnd]));
  return {
    trang_thai: { $ne: 'cancelled' },
    ...rest,
    $and: andConditions
  };
}

module.exports = {
  CHANGE_RECEIPT_LOAI_THU_CHI,
  parsePaymentNumber,
  normalizeCustomerPaymentInput,
  computeNetPaidFromReceiptRows,
  receiptRowsForNetPaidFilter
};
