var mongoose = require('mongoose');
var { KhachHang } = require('../../models/kiot.model');
var { taoPhieuThuChi, parseMoney } = require('../../services/soQuy.service');
var { buildReceiptPaymentInfo } = require('../../services/paymentCashBook.service');
var { createCustomerDebtTransaction } = require('../../services/customerDebt.service');
var { resolveStoreId } = require('../../utils/storeScope');
var { normalizeIdParam } = require('./helpers/common.helper');
var {
  normalizeCustomerPaymentInput,
  loadCustomerUnpaidInvoices,
  sumInvoiceDebt
} = require('./helpers/debt.helper');

function getUserName(user) {
  if (!user) return '';
  return user.ho_ten || user.username || user.email || '';
}

exports.payDebt = async function(req, res) {
  var session = null;
  try {
    var storeId = await resolveStoreId(req);
    var customerId = normalizeIdParam(req && req.params && req.params.id);
    if (!customerId || !mongoose.Types.ObjectId.isValid(customerId)) {
      return res.status(400).json({ success: false, message: 'Khách hàng không hợp lệ' });
    }

    var payment = normalizeCustomerPaymentInput(req.body || {});
    if (payment.amount <= 0) {
      return res.status(400).json({ success: false, message: 'Số tiền thu phải lớn hơn 0' });
    }
    var allowOverpayment = req.body && (
      req.body.enable_overpayment === 'on'
      || req.body.enable_overpayment === 'true'
      || req.body.enable_overpayment === true
    );

    var result;
    session = await mongoose.startSession();
    await session.withTransaction(async function() {
      var customer = await KhachHang.findById(customerId).session(session).lean();
      if (!customer) throw new Error('Không tìm thấy khách hàng');
      if (storeId && mongoose.Types.ObjectId.isValid(storeId) && customer.cua_hang_id && String(customer.cua_hang_id) !== String(storeId)) {
        throw new Error('Không tìm thấy khách hàng');
      }

      var payableDebt = Math.max(0, Number(customer.tong_no || 0));
      if (!allowOverpayment && payment.amount > payableDebt) {
        throw new Error('Số tiền thu không được vượt quá nợ hiện tại. Bật thu dư / ứng trước nếu muốn thu vượt.');
      }

      var invoices = await loadCustomerUnpaidInvoices(customer._id, storeId);
      var invoiceDebt = sumInvoiceDebt(invoices);
      var allocationLimit = Math.min(payment.amount, Math.max(0, payableDebt));
      var allocations = [];
      var manualAllocations = [];
      if (req.body && req.body.allocations_json) {
        try {
          manualAllocations = JSON.parse(String(req.body.allocations_json || '[]'));
          if (!Array.isArray(manualAllocations)) manualAllocations = [];
        } catch (parseError) {
          throw new Error('Phân bổ thanh toán không hợp lệ');
        }
      }

      if (manualAllocations.length) {
        var invoiceMap = {};
        invoices.forEach(function(row) { invoiceMap[String(row.doc_id || row._id)] = row; });
        var manualTotal = 0;
        for (var m = 0; m < manualAllocations.length; m++) {
          var manual = manualAllocations[m] || {};
          var manualId = String(manual.hoa_don_id || '').trim();
          var manualInvoice = invoiceMap[manualId];
          if (!manualInvoice) throw new Error('Chứng từ phân bổ không hợp lệ');
          var manualDebt = Math.max(0, Number(manualInvoice.con_no || 0));
          var manualAmount = parseMoney(manual.so_tien);
          if (manualAmount <= 0) continue;
          if (manualAmount > manualDebt) throw new Error('Không được phân bổ vượt nợ chứng từ');
          manualTotal += manualAmount;
          allocations.push({
            hoa_don_id: manualInvoice._id,
            ma_hoa_don: manualInvoice.ma_hoa_don || '',
            so_tien: manualAmount,
            con_no_truoc: manualDebt,
            con_no_sau: Math.max(0, manualDebt - manualAmount)
          });
        }
        if (manualTotal > allocationLimit) {
          throw new Error('Tổng tiền phân bổ không được vượt quá nợ theo sổ công nợ');
        }
      } else {
        var remaining = allocationLimit;
        for (var i = 0; i < invoices.length && remaining > 0; i++) {
          var invoice = invoices[i];
          var invoiceRemain = Math.max(0, Number(invoice.con_no || 0));
          var payForInvoice = Math.min(remaining, invoiceRemain);
          if (payForInvoice <= 0) continue;
          allocations.push({
            hoa_don_id: invoice._id,
            ma_hoa_don: invoice.ma_hoa_don || '',
            so_tien: payForInvoice,
            con_no_truoc: invoiceRemain,
            con_no_sau: Math.max(0, invoiceRemain - payForInvoice)
          });
          remaining -= payForInvoice;
        }
      }

      var allocatedTotal = allocations.reduce(function(sum, row) { return sum + Number(row.so_tien || 0); }, 0);
      if (allocatedTotal > allocationLimit) {
        throw new Error('Tổng tiền phân bổ không được vượt quá nợ theo sổ công nợ');
      }
      if (!allocations.length && allocationLimit > 0 && invoices.length) {
        throw new Error('Không phân bổ được vào hóa đơn còn nợ. Kiểm tra lại số tiền hoặc danh sách hóa đơn.');
      }
      var overpaymentAmount = Math.max(0, payment.amount - payableDebt);
      var note = String((req.body && req.body.ghi_chu) || '').trim()
        || ('Thanh toán công nợ khách hàng ' + (customer.ten_khach_hang || customer.ma_khach_hang || ''));
      var storeForReceipt = storeId || customer.cua_hang_id;
      if (!storeForReceipt || !mongoose.Types.ObjectId.isValid(String(storeForReceipt))) {
        throw new Error('Không xác định được cửa hàng');
      }

      var primaryAllocation = allocations.length === 1 ? allocations[0] : null;
      var receiptPayload = {
        loai_phieu: 'thu',
        loai_thu_chi: 'thanh_toan_khach',
        gia_tri: payment.amount,
        khach_hang_id: customer._id,
        hoa_don_id: primaryAllocation ? primaryAllocation.hoa_don_id : undefined,
        document_type: primaryAllocation ? 'hoa_don' : (allocations.length ? 'hoa_don' : undefined),
        ma_chung_tu_goc: primaryAllocation
          ? (primaryAllocation.ma_hoa_don || '')
          : (allocations[0] && allocations[0].ma_hoa_don ? allocations[0].ma_hoa_don : ''),
        nhom_doi_tuong: 'khach_hang',
        doi_tuong: customer.ten_khach_hang || customer.ma_khach_hang || '',
        nguoi_tao_id: req.user && req.user._id,
        cua_hang_id: storeForReceipt,
        trang_thai: 'paid',
        ghi_chu: overpaymentAmount > 0
          ? (note + ' - Thu dư / ứng trước: ' + overpaymentAmount.toLocaleString('vi-VN'))
          : note,
        hach_toan: true,
        allocation_type: 'thanh_toan_khach',
        overpayment_amount: overpaymentAmount,
        allocations: allocations
      };

      if (payment.isV2) {
        Object.assign(receiptPayload, {
          payment_v2: true,
          tien_mat: payment.tien_mat,
          so_quy_tien_mat_id: payment.so_quy_tien_mat_id,
          chuyen_khoan: payment.chuyen_khoan,
          so_quy_chuyen_khoan_id: payment.so_quy_chuyen_khoan_id,
          tien_tra_khach: 0
        });
        receiptPayload._paymentInfo = await buildReceiptPaymentInfo(receiptPayload, {
          cuaHangId: storeForReceipt,
          chiNhanhId: req.session && req.session.chi_nhanh_id,
          session: session
        });
      } else {
        var cashBookId = String((req.body && (req.body.so_quy_id || req.body.cashBookId)) || '').trim();
        if (!mongoose.Types.ObjectId.isValid(cashBookId)) {
          throw new Error('Vui lòng chọn sổ quỹ để thu công nợ khách hàng.');
        }
        Object.assign(receiptPayload, {
          so_quy_id: cashBookId,
          phuong_thuc_thanh_toan: String((req.body && req.body.phuong_thuc_thanh_toan) || '').trim() || 'tien_mat',
          chi_tiet_thanh_toan: {
            tien_mat: payment.tien_mat,
            chuyen_khoan: payment.chuyen_khoan,
            tien_tra_khach: 0
          }
        });
      }

      var receipt = await taoPhieuThuChi(receiptPayload, { session: session });
      result = {
        receipt: receipt,
        paid: payment.amount,
        debt: Math.max(0, payableDebt - payment.amount),
        invoice_debt: invoiceDebt,
        allocated: allocatedTotal,
        overpayment_amount: overpaymentAmount
      };
    });

    return res.json({
      success: true,
      message: 'Đã tạo phiếu thu thanh toán khách hàng',
      data: result
    });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message || 'Không tạo được phiếu thu' });
  } finally {
    if (session) await session.endSession();
  }
};

exports.discountDebt = async function(req, res) {
  try {
    var storeId = await resolveStoreId(req);
    var customerId = normalizeIdParam(req && req.params && req.params.id);
    if (!customerId || !mongoose.Types.ObjectId.isValid(customerId)) {
      return res.status(400).json({ success: false, message: 'Khách hàng không hợp lệ' });
    }

    var customer = await KhachHang.findById(customerId).lean();
    if (!customer) return res.status(404).json({ success: false, message: 'Không tìm thấy khách hàng' });
    if (storeId && mongoose.Types.ObjectId.isValid(storeId) && customer.cua_hang_id && String(customer.cua_hang_id) !== String(storeId)) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy khách hàng' });
    }

    var debt = Math.max(0, Number(customer.tong_no || 0));
    var payment = normalizeCustomerPaymentInput(req.body || {});
    var amount = payment.isV2 ? payment.amount : parseMoney(req.body && req.body.gia_tri);
    if (amount <= 0) return res.status(400).json({ success: false, message: 'Số tiền chiết khấu phải lớn hơn 0' });
    if (amount > debt) {
      return res.status(400).json({ success: false, message: 'Số tiền chiết khấu không được vượt quá nợ hiện tại' });
    }

    var storeForTransaction = storeId && mongoose.Types.ObjectId.isValid(storeId) ? storeId : customer.cua_hang_id;
    if (!storeForTransaction || !mongoose.Types.ObjectId.isValid(String(storeForTransaction))) {
      return res.status(400).json({ success: false, message: 'Không xác định được cửa hàng' });
    }

    var note = String((req.body && req.body.ghi_chu) || '').trim()
      || ('Chiết khấu thanh toán khách hàng ' + (customer.ten_khach_hang || customer.ma_khach_hang || ''));
    var receipt = null;
    if (payment.isV2 && payment.amount > 0) {
      var receiptPayload = {
        loai_phieu: 'thu',
        loai_thu_chi: 'chiet_khau_thanh_toan',
        gia_tri: amount,
        khach_hang_id: customer._id,
        nhom_doi_tuong: 'khach_hang',
        doi_tuong: customer.ten_khach_hang || customer.ma_khach_hang || '',
        nguoi_tao_id: req.user && req.user._id,
        cua_hang_id: storeForTransaction,
        trang_thai: 'paid',
        ghi_chu: note,
        hach_toan: false,
        payment_v2: true,
        tien_mat: payment.tien_mat,
        so_quy_tien_mat_id: payment.so_quy_tien_mat_id,
        chuyen_khoan: payment.chuyen_khoan,
        so_quy_chuyen_khoan_id: payment.so_quy_chuyen_khoan_id,
        tien_tra_khach: 0
      };
      receiptPayload._paymentInfo = await buildReceiptPaymentInfo(receiptPayload, {
        cuaHangId: storeForTransaction,
        chiNhanhId: req.session && req.session.chi_nhanh_id
      });
      receipt = await taoPhieuThuChi(receiptPayload);
    }

    var transaction = await createCustomerDebtTransaction({
      cua_hang_id: storeForTransaction,
      khach_hang_id: customer._id,
      loai_giao_dich: 'chiet_khau_thanh_toan',
      huong_cong_no: 'giam_no',
      gia_tri: amount,
      ngay_giao_dich: new Date(),
      anh_huong_so_quy: Boolean(receipt),
      phieu_thu_chi_id: receipt ? receipt._id : null,
      ghi_chu: note,
      nguoi_tao_id: req.user && req.user._id
    });

    return res.json({
      success: true,
      message: 'Đã tạo chiết khấu thanh toán khách hàng',
      data: {
        transaction: transaction,
        discount: amount,
        debt: debt - amount,
        currentUserName: getUserName(req.user)
      }
    });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message || 'Không tạo được chiết khấu thanh toán' });
  }
};
