const {
  NhaCungCap,
  PhieuNhap,
  PhieuThuChi,
  Counter,
  buildReceiptPaymentInfo,
  buildSupplierStoreAccessQuery,
  mongoose,
  normalizeIdParam,
  parseMoney,
  resolveStoreId,
  taoPhieuThuChi
} = require('./helpers/common.helper');
const {
  normalizeSupplierPaymentInput,
  loadActiveCashBooks,
  loadSupplierUnpaidPurchases
} = require('./helpers/debt.helper');
const { acquirePurchaseGroupMutationLock } = require('../../services/purchaseGroup.service');

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
  const { PhieuTamUng } = require('../../models/tamung.model');
  const last = await PhieuTamUng.findOne({ ma_phieu: /^TU\d+$/ })
    .sort({ ma_phieu: -1 })
    .select('ma_phieu')
    .session(session || null)
    .lean();
  const currentMax = Number(String(last?.ma_phieu || '').replace(/^TU/, '')) || 0;
  await Counter.updateOne(
    { _id: 'phieu_tam_ung' },
    { $max: { seq: currentMax } },
    { upsert: true, session: session || undefined }
  );
  const counter = await Counter.findOneAndUpdate(
    { _id: 'phieu_tam_ung' },
    { $inc: { seq: 1 } },
    { new: true, upsert: true, session: session || undefined }
  ).lean();
  return 'TU' + String(Number(counter?.seq || 1)).padStart(6, '0');
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

exports.apiSupplierAdvances = async function(req, res, next) {
  try {
    const supplierId = String(req.params.id || '').trim();
    if (!mongoose.Types.ObjectId.isValid(supplierId)) {
      return res.status(400).json({ success: false, message: 'Nhà cung cấp không hợp lệ.' });
    }

    const storeId = await resolveStoreId(req);
    const supplierQuery = Object.assign(
      { _id: supplierId },
      buildSupplierStoreAccessQuery(storeId)
    );
    const supplier = await NhaCungCap.findOne(supplierQuery)
      .select('_id ma_ncc ten_ncc')
      .lean();
    if (!supplier) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy nhà cung cấp.' });
    }

    const { PhieuTamUng } = require('../../models/tamung.model');
    const advanceQuery = {
      loai_doi_tuong: 'nha_cung_cap',
      nha_cung_cap_id: supplier._id,
      trang_thai_du_lieu: 'active'
    };
    if (storeId && mongoose.Types.ObjectId.isValid(storeId)) {
      advanceQuery.cua_hang_id = storeId;
    }

    const [rows, cashBooks] = await Promise.all([
      PhieuTamUng.find(advanceQuery).sort({ ngay_lap: -1, created_at: -1 }).lean(),
      loadActiveCashBooks()
    ]);

    return res.json({
      success: true,
      supplier: {
        id: String(supplier._id),
        ma_ncc: supplier.ma_ncc || '',
        ten_ncc: supplier.ten_ncc || ''
      },
      cash_books: (cashBooks || []).map(serializeCashBook),
      rows: rows.map(formatAdvanceRow)
    });
  } catch (error) {
    next(error);
  }
};

exports.createSupplierAdvance = async function(req, res, next) {
  let session = null;
  try {
    const storeId = await resolveStoreId(req);
    const supplierId = normalizeIdParam(req?.params?.id);
    if (!supplierId || !mongoose.Types.ObjectId.isValid(supplierId)) {
      return res.status(400).json({ success: false, message: 'Nhà cung cấp không hợp lệ.' });
    }

    const body = req.body || {};
    const payment = normalizeSupplierPaymentInput(body);
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

    const { PhieuTamUng } = require('../../models/tamung.model');
    let created = null;

    session = await mongoose.startSession();
    await session.withTransaction(async function() {
      const supplierQuery = Object.assign(
        { _id: supplierId },
        buildSupplierStoreAccessQuery(storeId)
      );
      const supplier = await NhaCungCap.findOne(supplierQuery).session(session).lean();
      if (!supplier) throw new Error('Không tìm thấy nhà cung cấp.');

      const cuaHangId = (storeId && mongoose.Types.ObjectId.isValid(storeId))
        ? storeId
        : (supplier.cua_hang_id && mongoose.Types.ObjectId.isValid(String(supplier.cua_hang_id))
          ? String(supplier.cua_hang_id)
          : '');
      if (!cuaHangId) throw new Error('Thiếu cửa hàng khi tạo phiếu tạm ứng.');

      const ngayLap = body.ngay_lap ? new Date(body.ngay_lap) : new Date();
      if (Number.isNaN(ngayLap.getTime())) throw new Error('Ngày lập không hợp lệ.');

      const note = String(body.ghi_chu || '').trim()
        || ('Tạm ứng nhà cung cấp ' + (supplier.ten_ncc || supplier.ma_ncc || ''));

      const receiptPayload = {
        loai_phieu: 'chi',
        loai_thu_chi: 'tam_ung_ncc',
        gia_tri: payment.amount,
        nha_cung_cap_id: supplier._id,
        nhom_doi_tuong: 'nha_cung_cap',
        doi_tuong: supplier.ten_ncc || supplier.ten_cong_ty || supplier.ma_ncc || '',
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

      const receipt = await taoPhieuThuChi(receiptPayload, { session: session });
      const maPhieu = await generateTamUngCode(session);
      const method = payment.chuyen_khoan > 0 && payment.tien_mat <= 0
        ? 'chuyen_khoan'
        : (payment.tien_mat > 0 && payment.chuyen_khoan > 0 ? 'khac' : 'tien_mat');

      const advanceRows = await PhieuTamUng.create([{
        ma_phieu: maPhieu,
        cua_hang_id: cuaHangId,
        loai_doi_tuong: 'nha_cung_cap',
        khach_hang_id: null,
        nha_cung_cap_id: supplier._id,
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
    const message = error && error.message ? error.message : 'Không tạo được phiếu tạm ứng.';
    console.error('[createSupplierAdvance]', message);
    return res.status(400).json({ success: false, message: message });
  } finally {
    if (session) session.endSession();
  }
};

function resolveCuaHangId(storeId, supplier) {
  if (storeId && mongoose.Types.ObjectId.isValid(storeId)) return String(storeId);
  if (supplier && supplier.cua_hang_id && mongoose.Types.ObjectId.isValid(String(supplier.cua_hang_id))) {
    return String(supplier.cua_hang_id);
  }
  return '';
}

async function loadAdvanceForSupplier(advanceId, supplierId, storeId, session) {
  const { PhieuTamUng } = require('../../models/tamung.model');
  if (!mongoose.Types.ObjectId.isValid(advanceId)) throw new Error('Phiếu tạm ứng không hợp lệ.');
  const query = {
    _id: advanceId,
    loai_doi_tuong: 'nha_cung_cap',
    nha_cung_cap_id: supplierId,
    trang_thai_du_lieu: 'active'
  };
  if (storeId && mongoose.Types.ObjectId.isValid(storeId)) query.cua_hang_id = storeId;
  let q = PhieuTamUng.findOne(query);
  if (session) q = q.session(session);
  const advance = await q;
  if (!advance) throw new Error('Không tìm thấy phiếu tạm ứng.');
  return advance;
}

function buildPaymentFromSourceReceipt(sourceReceipt, amount) {
  const detail = (sourceReceipt && sourceReceipt.chi_tiet_thanh_toan) || {};
  const cashBookId = String(detail.so_quy_tien_mat_id || sourceReceipt?.so_quy_id || '').trim();
  const bankBookId = String(detail.so_quy_chuyen_khoan_id || '').trim();
  const sourceCash = Math.max(0, Number(detail.tien_mat || 0));
  const sourceTransfer = Math.max(0, Number(detail.chuyen_khoan || 0));
  let tienMat = 0;
  let chuyenKhoan = 0;

  if (sourceCash > 0 && sourceTransfer > 0 && cashBookId && bankBookId) {
    const cashShare = Math.min(amount, Math.round(amount * (sourceCash / (sourceCash + sourceTransfer))));
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

exports.apiAdvancePayablePurchases = async function(req, res, next) {
  try {
    const supplierId = String(req.params.id || '').trim();
    const advanceId = String(req.params.advanceId || '').trim();
    if (!mongoose.Types.ObjectId.isValid(supplierId)) {
      return res.status(400).json({ success: false, message: 'Nhà cung cấp không hợp lệ.' });
    }

    const storeId = await resolveStoreId(req);
    const supplierQuery = Object.assign(
      { _id: supplierId },
      buildSupplierStoreAccessQuery(storeId)
    );
    const supplier = await NhaCungCap.findOne(supplierQuery).select('_id ma_ncc ten_ncc').lean();
    if (!supplier) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy nhà cung cấp.' });
    }

    const advance = await loadAdvanceForSupplier(advanceId, supplier._id, storeId, null);
    const purchases = await loadSupplierUnpaidPurchases(supplier._id, storeId);
    return res.json({
      success: true,
      advance: formatAdvanceRow(advance.toObject ? advance.toObject() : advance),
      rows: (purchases || []).map(function(row) {
        return {
          id: String(row._id),
          ma_phieu_nhap: row.ma_phieu_nhap || '',
          ngay_nhap: row.ngay_nhap || row.created_at || null,
          can_tra_ncc: Number(row.can_tra_ncc || row.tong_tien || 0),
          da_tra_ncc: Number(row.da_tra_ncc || 0),
          con_no: Math.max(0, Number(row.con_no_ncc || 0))
        };
      }).filter(function(row) { return row.con_no > 0; })
    });
  } catch (error) {
    const message = error && error.message ? error.message : 'Không tải được phiếu nhập.';
    return res.status(400).json({ success: false, message: message });
  }
};

exports.applyAdvanceOffset = async function(req, res) {
  let session = null;
  try {
    const storeId = await resolveStoreId(req);
    const supplierId = normalizeIdParam(req?.params?.id);
    const advanceId = String(req.params.advanceId || '').trim();
    if (!supplierId || !mongoose.Types.ObjectId.isValid(supplierId)) {
      return res.status(400).json({ success: false, message: 'Nhà cung cấp không hợp lệ.' });
    }

    const body = req.body || {};
    let amount = parseMoney(body.so_tien != null ? body.so_tien : body.gia_tri);
    let manualAllocations = [];
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

    let result = null;
    session = await mongoose.startSession();
    await session.withTransaction(async function() {
      await acquirePurchaseGroupMutationLock(storeId, session);
      const supplierQuery = Object.assign(
        { _id: supplierId },
        buildSupplierStoreAccessQuery(storeId)
      );
      const supplier = await NhaCungCap.findOne(supplierQuery).session(session).lean();
      if (!supplier) throw new Error('Không tìm thấy nhà cung cấp.');

      const cuaHangId = resolveCuaHangId(storeId, supplier);
      if (!cuaHangId) throw new Error('Thiếu cửa hàng khi cấn trừ tạm ứng.');

      const advance = await loadAdvanceForSupplier(advanceId, supplier._id, storeId, session);
      const conLai = Math.max(0, Number(advance.con_lai || 0));
      if (conLai <= 0) throw new Error('Phiếu tạm ứng đã hết số dư.');

      const purchases = await loadSupplierUnpaidPurchases(supplier._id, storeId, { session });
      const purchaseMap = {};
      purchases.forEach(function(row) {
        purchaseMap[String(row._id)] = row;
      });

      const allocations = [];
      if (manualAllocations.length) {
        let manualTotal = 0;
        for (let m = 0; m < manualAllocations.length; m++) {
          const manual = manualAllocations[m] || {};
          const manualId = String(manual.phieu_nhap_id || '').trim();
          const purchase = purchaseMap[manualId];
          if (!purchase) throw new Error('Chứng từ phân bổ không hợp lệ.');
          const purchaseDebt = Math.max(0, Number(purchase.con_no_ncc || 0));
          const manualAmount = parseMoney(manual.so_tien);
          if (manualAmount <= 0) continue;
          if (manualAmount > purchaseDebt) throw new Error('Không được phân bổ vượt nợ chứng từ.');
          manualTotal += manualAmount;
          allocations.push({
            phieu_nhap_id: purchase._id,
            ma_phieu_nhap: purchase.ma_phieu_nhap || '',
            so_tien: manualAmount,
            con_no_truoc: purchaseDebt,
            con_no_sau: Math.max(0, purchaseDebt - manualAmount),
            da_tra_ncc: Number(purchase.da_tra_ncc || 0),
            can_tra_ncc: Number(purchase.can_tra_ncc || purchase.tong_tien || 0)
          });
        }
        amount = manualTotal;
      } else {
        if (amount <= 0) throw new Error('Số tiền cấn trừ phải lớn hơn 0.');
        let remaining = Math.min(amount, conLai);
        for (let i = 0; i < purchases.length && remaining > 0; i++) {
          const purchase = purchases[i];
          const purchaseDebt = Math.max(0, Number(purchase.con_no_ncc || 0));
          const payForPurchase = Math.min(remaining, purchaseDebt);
          if (payForPurchase <= 0) continue;
          allocations.push({
            phieu_nhap_id: purchase._id,
            ma_phieu_nhap: purchase.ma_phieu_nhap || '',
            so_tien: payForPurchase,
            con_no_truoc: purchaseDebt,
            con_no_sau: Math.max(0, purchaseDebt - payForPurchase),
            da_tra_ncc: Number(purchase.da_tra_ncc || 0),
            can_tra_ncc: Number(purchase.can_tra_ncc || purchase.tong_tien || 0)
          });
          remaining -= payForPurchase;
        }
        amount = allocations.reduce(function(sum, row) { return sum + Number(row.so_tien || 0); }, 0);
      }

      if (amount <= 0) throw new Error('Vui lòng phân bổ số tiền cấn trừ vào phiếu nhập.');
      if (amount > conLai) throw new Error('Số tiền cấn trừ không được vượt quá còn lại của phiếu tạm ứng.');
      if (!allocations.length) throw new Error('Không có phiếu nhập để cấn trừ.');

      let sourceReceipt = null;
      if (advance.phieu_thu_chi_id) {
        sourceReceipt = await PhieuThuChi.findById(advance.phieu_thu_chi_id).session(session).lean();
      }
      const paymentInput = normalizeSupplierPaymentInput(body);
      let payment = null;
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
      const codes = allocations.map(function(row) { return row.ma_phieu_nhap; }).filter(Boolean).join(', ');
      const note = String(body.ghi_chu || '').trim()
        || ('Cấn trừ tạm ứng ' + (advance.ma_phieu || '') + (codes ? (' vào ' + codes) : ' vào phiếu nhập'));

      const receiptPayload = {
        loai_phieu: 'chi',
        loai_thu_chi: 'can_tru_tam_ung_ncc',
        gia_tri: amount,
        nha_cung_cap_id: supplier._id,
        phieu_nhap_id: allocations.length === 1 ? allocations[0].phieu_nhap_id : undefined,
        nhom_doi_tuong: 'nha_cung_cap',
        doi_tuong: supplier.ten_ncc || supplier.ten_cong_ty || supplier.ma_ncc || '',
        nguoi_tao_id: req.user && req.user._id,
        cua_hang_id: cuaHangId,
        ngay_lap: body.ngay_lap ? new Date(body.ngay_lap) : new Date(),
        trang_thai: 'paid',
        ghi_chu: note,
        hach_toan: true,
        allocation_type: 'can_tru_tam_ung_ncc',
        allocations: allocations.map(function(row) {
          const source = purchaseMap[String(row.phieu_nhap_id)];
          return {
            phieu_nhap_id: row.phieu_nhap_id,
            ma_phieu_nhap: row.ma_phieu_nhap,
            so_tien: row.so_tien,
            con_no_truoc: row.con_no_truoc,
            con_no_sau: row.con_no_sau,
            legacy_paid_baseline: source && source.payment_current && source.payment_current.legacy_paid_fallback
              ? Number(source.payment_current.paid) || 0 : 0
          };
        }),
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

      const receipt = await taoPhieuThuChi(receiptPayload, { session: session });

      for (let j = 0; j < allocations.length; j++) {
        const allocation = allocations[j];
        const payable = Math.max(
          Number(allocation.can_tra_ncc || 0),
          Number(allocation.da_tra_ncc || 0) + Number(allocation.con_no_truoc || 0)
        );
        const nextPaid = Math.min(Number(allocation.da_tra_ncc || 0) + allocation.so_tien, payable);
        await PhieuNhap.updateOne(
          { _id: allocation.phieu_nhap_id },
          {
            $set: {
              da_tra_ncc: nextPaid,
              con_no_ncc: Math.max(0, payable - nextPaid)
            }
          },
          { session: session }
        );
      }

      const { PhieuThanhToanTamUng } = require('../../models/tamung.model');
      const linkRows = allocations.map(function(allocation) {
        return {
          cua_hang_id: cuaHangId,
          phieu_tam_ung_id: advance._id,
          phieu_thanh_toan_id: receipt._id,
          so_tien: allocation.so_tien,
          ngay_giao_dich: receipt.ngay_lap || new Date(),
          phieu_nhap_id: allocation.phieu_nhap_id,
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
            id: String(row.phieu_nhap_id),
            ma_phieu_nhap: row.ma_phieu_nhap || '',
            so_tien: row.so_tien,
            con_no: row.con_no_sau
          };
        })
      };
    });

    return res.json({
      success: true,
      message: 'Đã cấn trừ tạm ứng vào phiếu nhập.',
      data: result
    });
  } catch (error) {
    const message = error && error.message ? error.message : 'Không cấn trừ được tạm ứng.';
    console.error('[applyAdvanceOffset]', message);
    return res.status(400).json({ success: false, message: message });
  } finally {
    if (session) session.endSession();
  }
};

exports.refundSupplierAdvance = async function(req, res) {
  let session = null;
  try {
    const storeId = await resolveStoreId(req);
    const supplierId = normalizeIdParam(req?.params?.id);
    const advanceId = String(req.params.advanceId || '').trim();
    if (!supplierId || !mongoose.Types.ObjectId.isValid(supplierId)) {
      return res.status(400).json({ success: false, message: 'Nhà cung cấp không hợp lệ.' });
    }

    const body = req.body || {};
    const payment = normalizeSupplierPaymentInput(body);
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

    let result = null;
    session = await mongoose.startSession();
    await session.withTransaction(async function() {
      const supplierQuery = Object.assign(
        { _id: supplierId },
        buildSupplierStoreAccessQuery(storeId)
      );
      const supplier = await NhaCungCap.findOne(supplierQuery).session(session).lean();
      if (!supplier) throw new Error('Không tìm thấy nhà cung cấp.');

      const cuaHangId = resolveCuaHangId(storeId, supplier);
      if (!cuaHangId) throw new Error('Thiếu cửa hàng khi hoàn tiền tạm ứng.');

      const advance = await loadAdvanceForSupplier(advanceId, supplier._id, storeId, session);
      const conLai = Math.max(0, Number(advance.con_lai || 0));
      if (conLai <= 0) throw new Error('Phiếu tạm ứng đã hết số dư.');
      if (payment.amount > conLai) {
        throw new Error('Số tiền hoàn không được vượt quá còn lại của phiếu tạm ứng.');
      }

      const note = String(body.ghi_chu || '').trim()
        || ('Hoàn tiền tạm ứng ' + (advance.ma_phieu || '') + ' - ' + (supplier.ten_ncc || supplier.ma_ncc || ''));
      const ngayLap = body.ngay_lap ? new Date(body.ngay_lap) : new Date();
      if (Number.isNaN(ngayLap.getTime())) throw new Error('Ngày lập không hợp lệ.');

      const receiptPayload = {
        loai_phieu: 'thu',
        loai_thu_chi: 'hoan_tam_ung_ncc',
        gia_tri: payment.amount,
        nha_cung_cap_id: supplier._id,
        nhom_doi_tuong: 'nha_cung_cap',
        doi_tuong: supplier.ten_ncc || supplier.ten_cong_ty || supplier.ma_ncc || '',
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

      const receipt = await taoPhieuThuChi(receiptPayload, { session: session });
      advance.da_hoan = Math.max(0, Number(advance.da_hoan || 0) + payment.amount);
      advance.nguoi_cap_nhat_id = req.user && req.user._id;
      const nextConLai = Math.max(
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
    const message = error && error.message ? error.message : 'Không hoàn được tạm ứng.';
    console.error('[refundSupplierAdvance]', message);
    return res.status(400).json({ success: false, message: message });
  } finally {
    if (session) session.endSession();
  }
};
