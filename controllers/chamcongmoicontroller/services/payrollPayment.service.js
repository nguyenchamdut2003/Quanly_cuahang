const mongoose = require('mongoose');
const { ChamCongMoiBangLuong } = require('../../../models/chamcongmoi.model');
const { taoPhieuThuChi } = require('../../../services/soQuy.service');
const { extractPaymentDetail } = require('../../../services/paymentCashBook.service');
const { loadPayrollPhieuChi } = require('./payroll.service');

async function createPayrollPayment({ storeId, payrollId, body, userId }) {
  var session;
  var receipt;
  if (!mongoose.Types.ObjectId.isValid(payrollId)) throw Object.assign(new Error('MÃ£ báº£ng lÆ°Æ¡ng khÃ´ng há»£p lá»‡'), { status: 400 });

  var payroll = await ChamCongMoiBangLuong.findOne({
    _id: payrollId,
    cua_hang_id: storeId
  }).lean();
  if (!payroll) throw Object.assign(new Error('KhÃ´ng tÃ¬m tháº¥y báº£ng lÆ°Æ¡ng'), { status: 404 });
  if (payroll.trang_thai === 'da_thanh_toan') throw Object.assign(new Error('Báº£ng lÆ°Æ¡ng Ä‘Ã£ thanh toÃ¡n'), { status: 400 });

  var existingReceipt = await loadPayrollPhieuChi(storeId, payrollId);
  if (existingReceipt) throw Object.assign(new Error('ÄÃ£ cÃ³ phiáº¿u chi cho báº£ng lÆ°Æ¡ng nÃ y'), { status: 400 });

  var tongTien = Number(payroll.tong_tien || 0);
  if (tongTien <= 0) throw Object.assign(new Error('Báº£ng lÆ°Æ¡ng chÆ°a cÃ³ sá»‘ tiá»n cáº§n thanh toÃ¡n'), { status: 400 });

  var body = body || {};
  var paymentDetail = extractPaymentDetail({
    tien_mat: body.tien_mat,
    chuyen_khoan: body.chuyen_khoan,
    so_quy_tien_mat_id: body.so_quy_tien_mat_id,
    so_quy_chuyen_khoan_id: body.so_quy_chuyen_khoan_id,
    chi_tiet_thanh_toan: body.chi_tiet_thanh_toan
  });
  var tongChi = paymentDetail.tien_mat + paymentDetail.chuyen_khoan;
  if (tongChi <= 0) throw Object.assign(new Error('Vui lÃ²ng nháº­p sá»‘ tiá»n thanh toÃ¡n'), { status: 400 });
  if (tongChi !== tongTien) {
    throw Object.assign(new Error('Sá»‘ tiá»n thanh toÃ¡n pháº£i báº±ng ' + tongTien.toLocaleString('vi-VN') + ' Ä‘'), { status: 400 });
  }

  var receipt;
  session = await mongoose.startSession();
  await session.withTransaction(async function() {
    var lockedPayroll = await ChamCongMoiBangLuong.findOne({
      _id: payrollId,
      cua_hang_id: storeId,
      trang_thai: 'can_thanh_toan'
    }).session(session);
    if (!lockedPayroll) throw new Error('Báº£ng lÆ°Æ¡ng khÃ´ng cÃ²n á»Ÿ tráº¡ng thÃ¡i cáº§n thanh toÃ¡n');

    receipt = await taoPhieuThuChi({
      loai_phieu: 'chi',
      loai_thu_chi: 'tra_luong_nhan_vien',
      cua_hang_id: storeId,
      nguoi_tao_id: userId,
      nhom_doi_tuong: 'nhan_vien',
      doi_tuong: lockedPayroll.ten_nhan_vien || lockedPayroll.ma_nhan_vien || 'NhÃ¢n viÃªn',
      chamcongmoi_bang_luong_id: lockedPayroll._id,
      ma_chung_tu_goc: lockedPayroll.ma_bang_luong || '',
      hach_toan: false,
      payment_v2: true,
      tien_mat: paymentDetail.tien_mat,
      chuyen_khoan: paymentDetail.chuyen_khoan,
      so_quy_tien_mat_id: body.so_quy_tien_mat_id,
      so_quy_chuyen_khoan_id: body.so_quy_chuyen_khoan_id,
      ghi_chu: String(body.ghi_chu || '').trim() || (
        'Thanh toÃ¡n lÆ°Æ¡ng ' + (lockedPayroll.ma_bang_luong || '') +
        ' - ' + (lockedPayroll.ten_nhan_vien || lockedPayroll.ma_nhan_vien || 'nhÃ¢n viÃªn')
      ),
      session: session
    });

    await ChamCongMoiBangLuong.updateOne(
      { _id: lockedPayroll._id, cua_hang_id: storeId },
      { $set: { trang_thai: 'da_thanh_toan' } },
      { session: session }
    );
  });
  await session.endSession();

  return {
    success: true,
    message: 'Đã tạo phiếu chi',
    receipt: {
      _id: String(receipt._id),
      ma_phieu: receipt.ma_phieu || '',
      gia_tri: Number(receipt.gia_tri || 0)
    }
  };
}

module.exports = { createPayrollPayment };

