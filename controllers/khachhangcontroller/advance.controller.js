var mongoose = require('mongoose');
var { KhachHang, Counter, PhieuThuChi } = require('../../models/kiot.model');
var { taoPhieuThuChi, parseMoney } = require('../../services/soQuy.service');
var { buildReceiptPaymentInfo } = require('../../services/paymentCashBook.service');
var { resolveStoreId } = require('../../utils/storeScope');
var { normalizeIdParam } = require('./helpers/common.helper');
var {
  normalizeCustomerPaymentInput,
  loadActiveCashBooks,
  loadCustomerUnpaidInvoices
} = require('./helpers/debt.helper');

function formatAdvanceStatus(status) {
  if (status === 'da_dung_het') return 'Đã dùng hết';
  if (status === 'da_hoan') return 'Đã hoàn';
  if (status === 'huy') return 'Hủy';
  return 'Còn dư';
}

function formatAdvancePaymentMethod(method) {
  if (method === 'chuyen_khoan') return 'Chuyển khoản';
  if (method === 'vi_dien_tu') return 'Ví điện tử';
  if (method === 'khac') return 'Khác';
  return 'Tiền mặt';
}

function formatAdvanceRow(row) {
  return {
    id: String(row._id),
    ma_phieu: row.ma_phieu || '',
    ngay_lap: row.ngay_lap || row.created_at || null,
    so_tien: Number(row.so_tien || 0),
    da_can_tru: Number(row.da_can_tru || 0),
    da_hoan: Number(row.da_hoan || 0),
    con_lai: Number(row.con_lai || 0),
    phuong_thuc_thanh_toan: row.phuong_thuc_thanh_toan || 'tien_mat',
    phuong_thuc_text: formatAdvancePaymentMethod(row.phuong_thuc_thanh_toan),
    trang_thai: row.trang_thai || 'active',
    trang_thai_text: formatAdvanceStatus(row.trang_thai),
    ghi_chu: row.ghi_chu || '',
    phieu_thu_chi_id: row.phieu_thu_chi_id ? String(row.phieu_thu_chi_id) : ''
  };
}

async function generateTamUngCode(session) {
  var { PhieuTamUng } = require('../../models/tamung.model');
  var last = await PhieuTamUng.findOne({ ma_phieu: /^TU\d+$/ })
    .sort({ ma_phieu: -1 })
    .select('ma_phieu')
    .session(session || null)
    .lean();
  var currentMax = Number(String(last && last.ma_phieu || '').replace(/^TU/, '')) || 0;
  await Counter.updateOne(
    { _id: 'phieu_tam_ung' },
    { $max: { seq: currentMax } },
    { upsert: true, session: session || undefined }
  );
  var counter = await Counter.findOneAndUpdate(
    { _id: 'phieu_tam_ung' },
    { $inc: { seq: 1 } },
    { new: true, upsert: true, session: session || undefined }
  ).lean();
  return 'TU' + String(Number(counter && counter.seq || 1)).padStart(6, '0');
}

function serializeCashBook(book) {
  var bank = (book && book.thong_tin_ngan_hang) || {};
  return {
    id: String(book._id),
    ten_so_quy: book.ten_so_quy || '',
    loai_so_quy: book.loai_so_quy || 'tien_mat',
    mac_dinh: !!book.mac_dinh,
    ten_ngan_hang: bank.ten_ngan_hang || '',
    so_tai_khoan: bank.so_tai_khoan || ''
  };
}

function resolveCuaHangId(storeId, customer) {
  if (storeId && mongoose.Types.ObjectId.isValid(storeId)) return String(storeId);
  if (customer && customer.cua_hang_id && mongoose.Types.ObjectId.isValid(String(customer.cua_hang_id))) {
    return String(customer.cua_hang_id);
  }
  return '';
}

async function loadAdvanceForCustomer(advanceId, customerId, storeId, session) {
  var { PhieuTamUng } = require('../../models/tamung.model');
  if (!mongoose.Types.ObjectId.isValid(advanceId)) throw new Error('Phiếu tạm ứng không hợp lệ.');
  var query = {
    _id: advanceId,
    loai_doi_tuong: 'khach_hang',
    khach_hang_id: customerId,
    trang_thai_du_lieu: 'active'
  };
  if (storeId && mongoose.Types.ObjectId.isValid(storeId)) query.cua_hang_id = storeId;
  var q = PhieuTamUng.findOne(query);
  if (session) q = q.session(session);
  var advance = await q;
  if (!advance) throw new Error('Không tìm thấy phiếu tạm ứng.');
  return advance;
}

function buildPaymentFromSourceReceipt(sourceReceipt, amount) {
  var detail = (sourceReceipt && sourceReceipt.chi_tiet_thanh_toan) || {};
  var cashBookId = String(detail.so_quy_tien_mat_id || (sourceReceipt && sourceReceipt.so_quy_id) || '').trim();
  var bankBookId = String(detail.so_quy_chuyen_khoan_id || '').trim();
  var sourceCash = Math.max(0, Number(detail.tien_mat || 0));
  var sourceTransfer = Math.max(0, Number(detail.chuyen_khoan || 0));
  var tienMat = 0;
  var chuyenKhoan = 0;

  if (sourceCash > 0 && sourceTransfer > 0 && cashBookId && bankBookId) {
    var cashShare = Math.min(amount, Math.round(amount * (sourceCash / (sourceCash + sourceTransfer))));
    tienMat = cashShare;
    chuyenKhoan = Math.max(0, amount - cashShare);
  } else if (sourceTransfer > 0 && bankBookId) {
    chuyenKhoan = amount;
  } else if (cashBookId) {
    tienMat = amount;
  } else if (bankBookId) {
    chuyenKhoan = amount;
  } else {
    throw new Error('Phiếu tạm ứng gốc thiếu sổ quỹ để ghi nhận cấn trừ.');
  }

  return {
    amount: amount,
    tien_mat: tienMat,
    chuyen_khoan: chuyenKhoan,
    so_quy_tien_mat_id: tienMat > 0 ? cashBookId : '',
    so_quy_chuyen_khoan_id: chuyenKhoan > 0 ? bankBookId : ''
  };
}

exports.apiCustomerAdvances = async function(req, res, next) {
  try {
    var customerId = String(req.params.id || '').trim();
    if (!mongoose.Types.ObjectId.isValid(customerId)) {
      return res.status(400).json({ success: false, message: 'Khách hàng không hợp lệ.' });
    }

    var storeId = await resolveStoreId(req);
    var customer = await KhachHang.findById(customerId).select('_id ma_khach_hang ten_khach_hang cua_hang_id').lean();
    if (!customer) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy khách hàng.' });
    }
    if (storeId && mongoose.Types.ObjectId.isValid(storeId) && customer.cua_hang_id && String(customer.cua_hang_id) !== String(storeId)) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy khách hàng.' });
    }

    var { PhieuTamUng } = require('../../models/tamung.model');
    var advanceQuery = {
      loai_doi_tuong: 'khach_hang',
      khach_hang_id: customer._id,
      trang_thai_du_lieu: 'active'
    };
    if (storeId && mongoose.Types.ObjectId.isValid(storeId)) {
      advanceQuery.cua_hang_id = storeId;
    }

    var rows = await PhieuTamUng.find(advanceQuery).sort({ ngay_lap: -1, created_at: -1 }).lean();
    var cashBooks = await loadActiveCashBooks();

    return res.json({
      success: true,
      customer: {
        id: String(customer._id),
        ma_khach_hang: customer.ma_khach_hang || '',
        ten_khach_hang: customer.ten_khach_hang || ''
      },
      cash_books: (cashBooks || []).map(serializeCashBook),
      rows: rows.map(formatAdvanceRow)
    });
  } catch (error) {
    next(error);
  }
};

exports.createCustomerAdvance = async function(req, res) {
  var session = null;
  try {
    var storeId = await resolveStoreId(req);
    var customerId = normalizeIdParam(req && req.params && req.params.id);
    if (!customerId || !mongoose.Types.ObjectId.isValid(customerId)) {
      return res.status(400).json({ success: false, message: 'Khách hàng không hợp lệ.' });
    }

    var body = req.body || {};
    var payment = normalizeCustomerPaymentInput(body);
    if (payment.amount <= 0) {
      return res.status(400).json({ success: false, message: 'Số tiền tạm ứng phải lớn hơn 0.' });
    }
    if (payment.tien_mat > 0 && !payment.so_quy_tien_mat_id) {
      return res.status(400).json({ success: false, message: 'Vui lòng chọn sổ tiền mặt.' });
    }
    if (payment.chuyen_khoan > 0 && !payment.so_quy_chuyen_khoan_id) {
      return res.status(400).json({ success: false, message: 'Vui lòng chọn sổ chuyển khoản.' });
    }
    if (!payment.so_quy_tien_mat_id && !payment.so_quy_chuyen_khoan_id) {
      return res.status(400).json({ success: false, message: 'Vui lòng chọn sổ quỹ thanh toán.' });
    }

    var { PhieuTamUng } = require('../../models/tamung.model');
    var created = null;
    session = await mongoose.startSession();
    await session.withTransaction(async function() {
      var customer = await KhachHang.findById(customerId).session(session).lean();
      if (!customer) throw new Error('Không tìm thấy khách hàng.');
      if (storeId && mongoose.Types.ObjectId.isValid(storeId) && customer.cua_hang_id && String(customer.cua_hang_id) !== String(storeId)) {
        throw new Error('Không tìm thấy khách hàng.');
      }

      var cuaHangId = resolveCuaHangId(storeId, customer);
      if (!cuaHangId) throw new Error('Thiếu cửa hàng khi tạo phiếu tạm ứng.');

      var ngayLap = body.ngay_lap ? new Date(body.ngay_lap) : new Date();
      if (Number.isNaN(ngayLap.getTime())) throw new Error('Ngày lập không hợp lệ.');

      var note = String(body.ghi_chu || '').trim()
        || ('Tạm ứng khách hàng ' + (customer.ten_khach_hang || customer.ma_khach_hang || ''));

      var receiptPayload = {
        loai_phieu: 'thu',
        loai_thu_chi: 'tam_ung_kh',
        gia_tri: payment.amount,
        khach_hang_id: customer._id,
        nhom_doi_tuong: 'khach_hang',
        doi_tuong: customer.ten_khach_hang || customer.ma_khach_hang || '',
        nguoi_tao_id: req.user && req.user._id,
        cua_hang_id: cuaHangId,
        ngay_lap: ngayLap,
        trang_thai: 'paid',
        ghi_chu: note,
        hach_toan: false,
        payment_v2: true,
        tien_mat: payment.tien_mat,
        so_quy_tien_mat_id: payment.so_quy_tien_mat_id || null,
        chuyen_khoan: payment.chuyen_khoan,
        so_quy_chuyen_khoan_id: payment.so_quy_chuyen_khoan_id || null,
        tien_tra_khach: 0
      };
      receiptPayload._paymentInfo = await buildReceiptPaymentInfo(receiptPayload, {
        cuaHangId: cuaHangId,
        chiNhanhId: req.session && req.session.chi_nhanh_id,
        session: session
      });

      var receipt = await taoPhieuThuChi(receiptPayload, { session: session });
      var maPhieu = await generateTamUngCode(session);
      var method = payment.chuyen_khoan > 0 && payment.tien_mat <= 0
        ? 'chuyen_khoan'
        : (payment.tien_mat > 0 && payment.chuyen_khoan > 0 ? 'khac' : 'tien_mat');

      var advanceRows = await PhieuTamUng.create([{
        ma_phieu: maPhieu,
        cua_hang_id: cuaHangId,
        loai_doi_tuong: 'khach_hang',
        khach_hang_id: customer._id,
        nha_cung_cap_id: null,
        ngay_lap: ngayLap,
        so_tien: payment.amount,
        da_can_tru: 0,
        da_hoan: 0,
        con_lai: payment.amount,
        phuong_thuc_thanh_toan: method,
        phieu_thu_chi_id: receipt._id,
        trang_thai: 'active',
        ghi_chu: note,
        nguoi_tao_id: req.user && req.user._id,
        trang_thai_du_lieu: 'active'
      }], { session: session });

      created = {
        advance: formatAdvanceRow(advanceRows[0].toObject ? advanceRows[0].toObject() : advanceRows[0]),
        receipt: {
          id: String(receipt._id),
          ma_phieu: receipt.ma_phieu || ''
        }
      };
    });

    return res.json({
      success: true,
      message: 'Đã tạo phiếu tạm ứng.',
      data: created
    });
  } catch (error) {
    var message = error && error.message ? error.message : 'Không tạo được phiếu tạm ứng.';
    console.error('[createCustomerAdvance]', message);
    return res.status(400).json({ success: false, message: message });
  } finally {
    if (session) session.endSession();
  }
};

exports.apiAdvancePayableInvoices = async function(req, res) {
  try {
    var customerId = String(req.params.id || '').trim();
    var advanceId = String(req.params.advanceId || '').trim();
    if (!mongoose.Types.ObjectId.isValid(customerId)) {
      return res.status(400).json({ success: false, message: 'Khách hàng không hợp lệ.' });
    }

    var storeId = await resolveStoreId(req);
    var customer = await KhachHang.findById(customerId).select('_id ma_khach_hang ten_khach_hang cua_hang_id').lean();
    if (!customer) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy khách hàng.' });
    }
    if (storeId && mongoose.Types.ObjectId.isValid(storeId) && customer.cua_hang_id && String(customer.cua_hang_id) !== String(storeId)) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy khách hàng.' });
    }

    var advance = await loadAdvanceForCustomer(advanceId, customer._id, storeId, null);
    var invoices = await loadCustomerUnpaidInvoices(customer._id, storeId);
    return res.json({
      success: true,
      advance: formatAdvanceRow(advance.toObject ? advance.toObject() : advance),
      rows: (invoices || []).map(function(row) {
        return {
          id: String(row._id),
          ma_hoa_don: row.ma_hoa_don || '',
          ngay_ban: row.ngay_chung_tu || row.ngay_ban || null,
          can_tra: Number(row.gia_tri_phai_tra || 0),
          da_tra: Number(row.da_thanh_toan || 0),
          con_no: Math.max(0, Number(row.con_no || 0))
        };
      }).filter(function(row) { return row.con_no > 0; })
    });
  } catch (error) {
    var message = error && error.message ? error.message : 'Không tải được hóa đơn.';
    return res.status(400).json({ success: false, message: message });
  }
};

exports.applyAdvanceOffset = async function(req, res) {
  var session = null;
  try {
    var storeId = await resolveStoreId(req);
    var customerId = normalizeIdParam(req && req.params && req.params.id);
    var advanceId = String(req.params.advanceId || '').trim();
    if (!customerId || !mongoose.Types.ObjectId.isValid(customerId)) {
      return res.status(400).json({ success: false, message: 'Khách hàng không hợp lệ.' });
    }

    var body = req.body || {};
    var amount = parseMoney(body.so_tien != null ? body.so_tien : body.gia_tri);
    var manualAllocations = [];
    if (body.allocations_json) {
      try {
        manualAllocations = typeof body.allocations_json === 'string'
          ? JSON.parse(body.allocations_json || '[]')
          : body.allocations_json;
        if (!Array.isArray(manualAllocations)) manualAllocations = [];
      } catch (parseError) {
        return res.status(400).json({ success: false, message: 'Phân bổ cấn trừ không hợp lệ.' });
      }
    }
    if (Array.isArray(body.allocations)) manualAllocations = body.allocations;

    var result = null;
    session = await mongoose.startSession();
    await session.withTransaction(async function() {
      var customer = await KhachHang.findById(customerId).session(session).lean();
      if (!customer) throw new Error('Không tìm thấy khách hàng.');
      if (storeId && mongoose.Types.ObjectId.isValid(storeId) && customer.cua_hang_id && String(customer.cua_hang_id) !== String(storeId)) {
        throw new Error('Không tìm thấy khách hàng.');
      }

      var cuaHangId = resolveCuaHangId(storeId, customer);
      if (!cuaHangId) throw new Error('Thiếu cửa hàng khi cấn trừ tạm ứng.');

      var advance = await loadAdvanceForCustomer(advanceId, customer._id, storeId, session);
      var conLai = Math.max(0, Number(advance.con_lai || 0));
      if (conLai <= 0) throw new Error('Phiếu tạm ứng đã hết số dư.');

      var invoices = await loadCustomerUnpaidInvoices(customer._id, storeId);
      var invoiceMap = {};
      invoices.forEach(function(row) {
        invoiceMap[String(row.doc_id || row._id)] = row;
      });

      var allocations = [];
      if (manualAllocations.length) {
        var manualTotal = 0;
        for (var m = 0; m < manualAllocations.length; m++) {
          var manual = manualAllocations[m] || {};
          var manualId = String(manual.hoa_don_id || '').trim();
          var invoice = invoiceMap[manualId];
          if (!invoice) throw new Error('Chứng từ phân bổ không hợp lệ.');
          var invoiceDebt = Math.max(0, Number(invoice.con_no || 0));
          var manualAmount = parseMoney(manual.so_tien);
          if (manualAmount <= 0) continue;
          if (manualAmount > invoiceDebt) throw new Error('Không được phân bổ vượt nợ chứng từ.');
          manualTotal += manualAmount;
          allocations.push({
            hoa_don_id: invoice._id,
            ma_hoa_don: invoice.ma_hoa_don || '',
            so_tien: manualAmount,
            con_no_truoc: invoiceDebt,
            con_no_sau: Math.max(0, invoiceDebt - manualAmount)
          });
        }
        amount = manualTotal;
      } else {
        if (amount <= 0) throw new Error('Số tiền cấn trừ phải lớn hơn 0.');
        var remaining = Math.min(amount, conLai);
        for (var i = 0; i < invoices.length && remaining > 0; i++) {
          var inv = invoices[i];
          var invDebt = Math.max(0, Number(inv.con_no || 0));
          var payFor = Math.min(remaining, invDebt);
          if (payFor <= 0) continue;
          allocations.push({
            hoa_don_id: inv._id,
            ma_hoa_don: inv.ma_hoa_don || '',
            so_tien: payFor,
            con_no_truoc: invDebt,
            con_no_sau: Math.max(0, invDebt - payFor)
          });
          remaining -= payFor;
        }
        amount = allocations.reduce(function(sum, row) { return sum + Number(row.so_tien || 0); }, 0);
      }

      if (amount <= 0) throw new Error('Vui lòng phân bổ số tiền cấn trừ vào hóa đơn.');
      if (amount > conLai) throw new Error('Số tiền cấn trừ không được vượt quá còn lại của phiếu tạm ứng.');
      if (!allocations.length) throw new Error('Không có hóa đơn để cấn trừ.');

      var sourceReceipt = null;
      if (advance.phieu_thu_chi_id) {
        sourceReceipt = await PhieuThuChi.findById(advance.phieu_thu_chi_id).session(session).lean();
      }
      var paymentInput = normalizeCustomerPaymentInput(body);
      var payment = null;
      if (paymentInput.amount > 0 && (paymentInput.so_quy_tien_mat_id || paymentInput.so_quy_chuyen_khoan_id)) {
        if (Math.abs(paymentInput.amount - amount) > 0.0001) {
          throw new Error('Tổng tiền mặt/chuyển khoản phải bằng số tiền đã phân bổ cấn trừ.');
        }
        if (paymentInput.tien_mat > 0 && !paymentInput.so_quy_tien_mat_id) {
          throw new Error('Vui lòng chọn sổ tiền mặt.');
        }
        if (paymentInput.chuyen_khoan > 0 && !paymentInput.so_quy_chuyen_khoan_id) {
          throw new Error('Vui lòng chọn sổ chuyển khoản.');
        }
        payment = {
          amount: amount,
          tien_mat: paymentInput.tien_mat,
          chuyen_khoan: paymentInput.chuyen_khoan,
          so_quy_tien_mat_id: paymentInput.so_quy_tien_mat_id || '',
          so_quy_chuyen_khoan_id: paymentInput.so_quy_chuyen_khoan_id || ''
        };
      } else {
        payment = buildPaymentFromSourceReceipt(sourceReceipt, amount);
      }

      var codes = allocations.map(function(row) { return row.ma_hoa_don; }).filter(Boolean).join(', ');
      var note = String(body.ghi_chu || '').trim()
        || ('Cấn trừ tạm ứng ' + (advance.ma_phieu || '') + (codes ? (' vào ' + codes) : ' vào hóa đơn'));

      var receiptPayload = {
        loai_phieu: 'thu',
        loai_thu_chi: 'can_tru_tam_ung_kh',
        gia_tri: amount,
        khach_hang_id: customer._id,
        hoa_don_id: allocations.length === 1 ? allocations[0].hoa_don_id : undefined,
        nhom_doi_tuong: 'khach_hang',
        doi_tuong: customer.ten_khach_hang || customer.ma_khach_hang || '',
        nguoi_tao_id: req.user && req.user._id,
        cua_hang_id: cuaHangId,
        ngay_lap: body.ngay_lap ? new Date(body.ngay_lap) : new Date(),
        trang_thai: 'paid',
        ghi_chu: note,
        hach_toan: true,
        allocation_type: 'can_tru_tam_ung_kh',
        allocations: allocations,
        payment_v2: true,
        tien_mat: payment.tien_mat,
        so_quy_tien_mat_id: payment.so_quy_tien_mat_id || null,
        chuyen_khoan: payment.chuyen_khoan,
        so_quy_chuyen_khoan_id: payment.so_quy_chuyen_khoan_id || null,
        tien_tra_khach: 0
      };
      receiptPayload._paymentInfo = await buildReceiptPaymentInfo(receiptPayload, {
        cuaHangId: cuaHangId,
        chiNhanhId: req.session && req.session.chi_nhanh_id,
        session: session
      });

      var receipt = await taoPhieuThuChi(receiptPayload, { session: session });

      var { PhieuThanhToanTamUng } = require('../../models/tamung.model');
      var linkRows = allocations.map(function(allocation) {
        return {
          cua_hang_id: cuaHangId,
          phieu_tam_ung_id: advance._id,
          phieu_thanh_toan_id: receipt._id,
          so_tien: allocation.so_tien,
          ngay_giao_dich: receipt.ngay_lap || new Date(),
          hoa_don_id: allocation.hoa_don_id,
          no_truoc_tam_ung: allocation.con_no_truoc,
          no_sau_tam_ung: allocation.con_no_sau,
          ghi_chu: note,
          trang_thai: 'active',
          nguoi_tao_id: req.user && req.user._id,
          trang_thai_du_lieu: 'active'
        };
      });
      await PhieuThanhToanTamUng.create(linkRows, { session: session });

      advance.da_can_tru = Math.max(0, Number(advance.da_can_tru || 0) + amount);
      advance.nguoi_cap_nhat_id = req.user && req.user._id;
      await advance.save({ session: session });

      result = {
        advance: formatAdvanceRow(advance.toObject ? advance.toObject() : advance),
        receipt: { id: String(receipt._id), ma_phieu: receipt.ma_phieu || '' },
        amount: amount,
        allocated: amount,
        allocations: allocations.map(function(row) {
          return {
            id: String(row.hoa_don_id),
            ma_hoa_don: row.ma_hoa_don || '',
            so_tien: row.so_tien,
            con_no: row.con_no_sau
          };
        })
      };
    });

    return res.json({
      success: true,
      message: 'Đã cấn trừ tạm ứng vào hóa đơn.',
      data: result
    });
  } catch (error) {
    var message = error && error.message ? error.message : 'Không cấn trừ được tạm ứng.';
    console.error('[applyCustomerAdvanceOffset]', message);
    return res.status(400).json({ success: false, message: message });
  } finally {
    if (session) session.endSession();
  }
};

exports.refundCustomerAdvance = async function(req, res) {
  var session = null;
  try {
    var storeId = await resolveStoreId(req);
    var customerId = normalizeIdParam(req && req.params && req.params.id);
    var advanceId = String(req.params.advanceId || '').trim();
    if (!customerId || !mongoose.Types.ObjectId.isValid(customerId)) {
      return res.status(400).json({ success: false, message: 'Khách hàng không hợp lệ.' });
    }

    var body = req.body || {};
    var payment = normalizeCustomerPaymentInput(body);
    if (payment.amount <= 0) {
      return res.status(400).json({ success: false, message: 'Số tiền hoàn phải lớn hơn 0.' });
    }
    if (payment.tien_mat > 0 && !payment.so_quy_tien_mat_id) {
      return res.status(400).json({ success: false, message: 'Vui lòng chọn sổ tiền mặt.' });
    }
    if (payment.chuyen_khoan > 0 && !payment.so_quy_chuyen_khoan_id) {
      return res.status(400).json({ success: false, message: 'Vui lòng chọn sổ chuyển khoản.' });
    }
    if (!payment.so_quy_tien_mat_id && !payment.so_quy_chuyen_khoan_id) {
      return res.status(400).json({ success: false, message: 'Vui lòng chọn sổ quỹ nhận hoàn tiền.' });
    }

    var result = null;
    session = await mongoose.startSession();
    await session.withTransaction(async function() {
      var customer = await KhachHang.findById(customerId).session(session).lean();
      if (!customer) throw new Error('Không tìm thấy khách hàng.');
      if (storeId && mongoose.Types.ObjectId.isValid(storeId) && customer.cua_hang_id && String(customer.cua_hang_id) !== String(storeId)) {
        throw new Error('Không tìm thấy khách hàng.');
      }

      var cuaHangId = resolveCuaHangId(storeId, customer);
      if (!cuaHangId) throw new Error('Thiếu cửa hàng khi hoàn tiền tạm ứng.');

      var advance = await loadAdvanceForCustomer(advanceId, customer._id, storeId, session);
      var conLai = Math.max(0, Number(advance.con_lai || 0));
      if (conLai <= 0) throw new Error('Phiếu tạm ứng đã hết số dư.');
      if (payment.amount > conLai) {
        throw new Error('Số tiền hoàn không được vượt quá còn lại của phiếu tạm ứng.');
      }

      var note = String(body.ghi_chu || '').trim()
        || ('Hoàn tiền tạm ứng ' + (advance.ma_phieu || '') + ' - ' + (customer.ten_khach_hang || customer.ma_khach_hang || ''));
      var ngayLap = body.ngay_lap ? new Date(body.ngay_lap) : new Date();
      if (Number.isNaN(ngayLap.getTime())) throw new Error('Ngày lập không hợp lệ.');

      var receiptPayload = {
        loai_phieu: 'chi',
        loai_thu_chi: 'hoan_tam_ung_kh',
        gia_tri: payment.amount,
        khach_hang_id: customer._id,
        nhom_doi_tuong: 'khach_hang',
        doi_tuong: customer.ten_khach_hang || customer.ma_khach_hang || '',
        nguoi_tao_id: req.user && req.user._id,
        cua_hang_id: cuaHangId,
        ngay_lap: ngayLap,
        trang_thai: 'paid',
        ghi_chu: note,
        hach_toan: false,
        payment_v2: true,
        tien_mat: payment.tien_mat,
        so_quy_tien_mat_id: payment.so_quy_tien_mat_id || null,
        chuyen_khoan: payment.chuyen_khoan,
        so_quy_chuyen_khoan_id: payment.so_quy_chuyen_khoan_id || null,
        tien_tra_khach: 0
      };
      receiptPayload._paymentInfo = await buildReceiptPaymentInfo(receiptPayload, {
        cuaHangId: cuaHangId,
        chiNhanhId: req.session && req.session.chi_nhanh_id,
        session: session
      });

      var receipt = await taoPhieuThuChi(receiptPayload, { session: session });
      advance.da_hoan = Math.max(0, Number(advance.da_hoan || 0) + payment.amount);
      advance.nguoi_cap_nhat_id = req.user && req.user._id;
      var nextConLai = Math.max(
        0,
        Number(advance.so_tien || 0) - Number(advance.da_can_tru || 0) - Number(advance.da_hoan || 0)
      );
      if (nextConLai <= 0 && Number(advance.da_can_tru || 0) <= 0) {
        advance.trang_thai = 'da_hoan';
      }
      await advance.save({ session: session });

      result = {
        advance: formatAdvanceRow(advance.toObject ? advance.toObject() : advance),
        receipt: { id: String(receipt._id), ma_phieu: receipt.ma_phieu || '' },
        amount: payment.amount
      };
    });

    return res.json({
      success: true,
      message: 'Đã hoàn tiền tạm ứng.',
      data: result
    });
  } catch (error) {
    var message = error && error.message ? error.message : 'Không hoàn được tạm ứng.';
    console.error('[refundCustomerAdvance]', message);
    return res.status(400).json({ success: false, message: message });
  } finally {
    if (session) session.endSession();
  }
};
