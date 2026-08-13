const {
  GiaoDichCongNoNhaCungCap,
  NhaCungCap,
  PhieuNhap,
  buildReceiptPaymentInfo,
  mongoose,
  normalizeIdParam,
  parseMoney,
  resolveStoreId,
  taoPhieuThuChi
} = require('./helpers/common.helper');
const {
  aggregateSupplierPurchaseTotals,
  applySupplierTotalsFromMap
} = require('./helpers/metrics.helper');
const {
  normalizeSupplierPaymentInput,
  sumInvoiceDebt,
  loadSupplierPayableDocuments,
  makeSupplierDebtTransactionCode
} = require('./helpers/debt.helper');

exports.payDebt = async function(req, res, next) {
      var session = null;
      try {
          var storeId = await resolveStoreId(req);
          var supplierId = normalizeIdParam(req?.params?.id);
          if (!supplierId || !mongoose.Types.ObjectId.isValid(supplierId)) {
              return res.status(400).json({ success: false, message: 'Nhà cung cấp không hợp lệ' });
          }
  
          var payment = normalizeSupplierPaymentInput(req.body || {});
          if (payment.amount <= 0) return res.status(400).json({ success: false, message: 'Số tiền trả phải lớn hơn 0' });
          var allowOverpayment = req?.body?.enable_overpayment === 'on' || req?.body?.enable_overpayment === 'true' || req?.body?.enable_overpayment === true;
  
          var result;
          session = await mongoose.startSession();
          await session.withTransaction(async function() {
              var supplier = await NhaCungCap.findById(supplierId).session(session).lean();
              if (!supplier) throw new Error('Không tìm thấy nhà cung cấp');
              if (storeId && mongoose.Types.ObjectId.isValid(storeId) && supplier.cua_hang_id && String(supplier.cua_hang_id) !== String(storeId)) {
                  throw new Error('Không tìm thấy nhà cung cấp');
              }
  
              var totalsMap = await aggregateSupplierPurchaseTotals(storeId, [supplier._id]);
              applySupplierTotalsFromMap(supplier, totalsMap);
              var purchases = await loadSupplierPayableDocuments(supplier._id, storeId);
              var invoiceDebt = sumInvoiceDebt(purchases);
              var payableDebt = Math.max(0, Number(supplier.tong_no || 0));
              if (!allowOverpayment && payment.amount > payableDebt) {
                  throw new Error('Số tiền trả không được vượt quá nợ theo sổ công nợ. Bật trả dư / ứng trước NCC nếu muốn chi vượt.');
              }
  
              var allocationLimit = Math.min(payment.amount, Math.max(0, payableDebt));
              var remaining = allocationLimit;
              var allocations = [];
              var manualAllocations = [];
              if (req?.body?.allocations_json) {
                  try {
                      manualAllocations = JSON.parse(String(req.body.allocations_json || '[]'));
                      if (!Array.isArray(manualAllocations)) manualAllocations = [];
                  } catch (parseError) {
                      throw new Error('Phân bổ thanh toán không hợp lệ');
                  }
              }
              if (manualAllocations.length) {
                  var purchaseMap = {};
                  purchases.forEach(function(row) { purchaseMap[String(row.doc_id || row._id)] = row; });
                  var manualTotal = 0;
                  for (var m = 0; m < manualAllocations.length; m++) {
                      var manual = manualAllocations[m] || {};
                      var manualId = String(manual.phieu_nhap_id || manual.nhap_vat_chua_id || '').trim();
                      var manualPurchase = purchaseMap[manualId];
                      if (!manualPurchase) throw new Error('Chung tu phan bo khong hop le');
                      var manualDebt = Math.max(0, Number(manualPurchase.con_no_ncc != null ? manualPurchase.con_no_ncc : manualPurchase.con_no || 0));
                      var manualAmount = parseMoney(manual.so_tien);
                      if (manualAmount <= 0) continue;
                      if (manualAmount > manualDebt) throw new Error('Khong duoc phan bo vuot no chung tu');
                      manualTotal += manualAmount;
                      allocations.push({
                          phieu_nhap_id: manualPurchase.doc_type === 'phieu_nhap' ? manualPurchase._id : undefined,
                          nhap_vat_chua_id: manualPurchase.doc_type === 'nhap_vat_chua' ? manualPurchase._id : undefined,
                          ma_phieu_nhap: manualPurchase.doc_type === 'phieu_nhap' ? (manualPurchase.ma_phieu_nhap || '') : '',
                          ma_nhap_vat_chua: manualPurchase.doc_type === 'nhap_vat_chua' ? (manualPurchase.ma_nhap_vat_chua || manualPurchase.ma_chung_tu || '') : '',
                          so_tien: manualAmount,
                          con_no_truoc: manualDebt,
                          con_no_sau: Math.max(0, manualDebt - manualAmount)
                      });
                  }
                  if (manualTotal > allocationLimit) throw new Error('Tong tien phan bo khong duoc vuot qua no theo so cong no');
              } else {
                  for (var i = 0; i < purchases.length && remaining > 0; i++) {
                      var purchase = purchases[i];
                      var purchaseDebt = Math.max(0, Number(purchase.con_no_ncc != null ? purchase.con_no_ncc : purchase.con_no || 0));
                      var payForPurchase = Math.min(remaining, purchaseDebt);
                      if (payForPurchase <= 0) continue;
                      allocations.push({
                          phieu_nhap_id: purchase.doc_type === 'phieu_nhap' ? purchase._id : undefined,
                          nhap_vat_chua_id: purchase.doc_type === 'nhap_vat_chua' ? purchase._id : undefined,
                          ma_phieu_nhap: purchase.doc_type === 'phieu_nhap' ? (purchase.ma_phieu_nhap || '') : '',
                          ma_nhap_vat_chua: purchase.doc_type === 'nhap_vat_chua' ? (purchase.ma_nhap_vat_chua || purchase.ma_chung_tu || '') : '',
                          so_tien: payForPurchase,
                          con_no_truoc: purchaseDebt,
                          con_no_sau: Math.max(0, purchaseDebt - payForPurchase)
                      });
                      remaining -= payForPurchase;
                  }
              }
  
              var allocatedTotal = allocations.reduce(function(sum, row) { return sum + Number(row.so_tien || 0); }, 0);
              if (allocatedTotal > allocationLimit) throw new Error('Tổng tiền phân bổ không được vượt quá nợ theo sổ công nợ');
              var overpaymentAmount = Math.max(0, payment.amount - payableDebt);
              var note = String(req?.body?.ghi_chu || '').trim() || ('Thanh toán công nợ nhà cung cấp ' + (supplier.ten_ncc || supplier.ma_ncc || ''));
              var receiptPayload = {
                  loai_phieu: 'chi',
                  loai_thu_chi: 'thanh_toan_ncc',
                  gia_tri: payment.amount,
                  nha_cung_cap_id: supplier._id,
                  phieu_nhap_id: allocations.length === 1 ? allocations[0].phieu_nhap_id : undefined,
                  nhap_vat_chua_id: allocations.length === 1 ? allocations[0].nhap_vat_chua_id : undefined,
                  nhom_doi_tuong: 'nha_cung_cap',
                  doi_tuong: supplier.ten_ncc || supplier.ten_cong_ty || supplier.ma_ncc || '',
                  nguoi_tao_id: req.user && req.user._id,
                  cua_hang_id: storeId || supplier.cua_hang_id,
                  trang_thai: 'paid',
                  ghi_chu: overpaymentAmount > 0 ? (note + ' - Trả dư / ứng trước NCC: ' + overpaymentAmount.toLocaleString('vi-VN')) : note,
                  hach_toan: true,
                  allocation_type: 'thanh_toan_ncc',
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
                      cuaHangId: receiptPayload.cua_hang_id,
                      chiNhanhId: req.session && req.session.chi_nhanh_id,
                      session: session
                  });
              } else {
                  var cashBookId = String(req?.body?.so_quy_id || req?.body?.cashBookId || '').trim();
                  if (!mongoose.Types.ObjectId.isValid(cashBookId)) throw new Error('Vui lòng chọn sổ quỹ để thanh toán nhà cung cấp.');
                  Object.assign(receiptPayload, {
                      so_quy_id: cashBookId,
                      phuong_thuc_thanh_toan: String(req?.body?.phuong_thuc_thanh_toan || '').trim() || 'tien_mat',
                      chi_tiet_thanh_toan: { tien_mat: payment.tien_mat, chuyen_khoan: payment.chuyen_khoan, tien_tra_khach: 0 }
                  });
              }
  
              var receipt = await taoPhieuThuChi(receiptPayload, { session: session });
              for (var j = 0; j < allocations.length; j++) {
                  var allocation = allocations[j];
                  if (!allocation.phieu_nhap_id) continue;
                  var matchingPurchase = purchases.find(function(item) { return String(item._id) === String(allocation.phieu_nhap_id); });
                  if (!matchingPurchase) continue;
                  var payable = Number(matchingPurchase.can_tra_ncc || matchingPurchase.tong_tien || 0);
                  if (!payable || payable < Number(matchingPurchase.da_tra_ncc || 0) + allocation.con_no_truoc) {
                      payable = Number(matchingPurchase.da_tra_ncc || 0) + allocation.con_no_truoc;
                  }
                  await PhieuNhap.updateOne(
                      { _id: allocation.phieu_nhap_id },
                      { $set: { da_tra_ncc: Math.min(Number(matchingPurchase.da_tra_ncc || 0) + allocation.so_tien, payable), con_no_ncc: allocation.con_no_sau } },
                      { session: session }
                  );
              }
              result = {
                  receipt: receipt,
                  paid: payment.amount,
                  debt: payableDebt - payment.amount,
                  invoice_debt: invoiceDebt,
                  allocated: allocatedTotal,
                  overpayment_amount: overpaymentAmount
              };
          });
  
          return res.json({
              success: true,
              message: 'Đã tạo phiếu chi thanh toán nhà cung cấp',
              data: result
          });
      } catch (error) {
          return res.status(400).json({ success: false, message: error.message || 'Không tạo được phiếu chi' });
      } finally {
          if (session) await session.endSession();
      }
  };

  exports.discountDebt = async function(req, res) {
      try {
          var storeId = await resolveStoreId(req);
          var supplierId = normalizeIdParam(req?.params?.id);
          if (!supplierId || !mongoose.Types.ObjectId.isValid(supplierId)) {
              return res.status(400).json({ success: false, message: 'Nhà cung cấp không hợp lệ' });
          }
  
          var supplier = await NhaCungCap.findById(supplierId).lean();
          if (!supplier) return res.status(404).json({ success: false, message: 'Không tìm thấy nhà cung cấp' });
          if (storeId && mongoose.Types.ObjectId.isValid(storeId) && supplier.cua_hang_id && String(supplier.cua_hang_id) !== String(storeId)) {
              return res.status(404).json({ success: false, message: 'Không tìm thấy nhà cung cấp' });
          }
  
          var totalsMap = await aggregateSupplierPurchaseTotals(storeId);
          applySupplierTotalsFromMap(supplier, totalsMap);
          var debt = Math.max(0, Number(supplier.tong_no || 0));
          var payment = normalizeSupplierPaymentInput(req.body || {});
          var amount = payment.isV2 ? payment.amount : parseMoney(req?.body?.gia_tri);
          if (amount <= 0) return res.status(400).json({ success: false, message: 'Số tiền chiết khấu phải lớn hơn 0' });
          if (amount > debt) {
              return res.status(400).json({ success: false, message: 'Số tiền chiết khấu không được vượt quá nợ hiện tại' });
          }
  
          var storeForTransaction = storeId && mongoose.Types.ObjectId.isValid(storeId) ? storeId : supplier.cua_hang_id;
          if (!storeForTransaction || !mongoose.Types.ObjectId.isValid(String(storeForTransaction))) {
              return res.status(400).json({ success: false, message: 'Không xác định được cửa hàng' });
          }
          var note = String(req?.body?.ghi_chu || '').trim() || ('Chiết khấu thanh toán nhà cung cấp ' + (supplier.ten_ncc || supplier.ma_ncc || ''));
          var receipt = null;
          if (payment.isV2) {
              var receiptPayload = {
                  loai_phieu: 'thu',
                  loai_thu_chi: 'chiet_khau_thanh_toan',
                  gia_tri: amount,
                  nha_cung_cap_id: supplier._id,
                  nhom_doi_tuong: 'nha_cung_cap',
                  doi_tuong: supplier.ten_ncc || supplier.ten_cong_ty || supplier.ma_ncc || '',
                  nguoi_tao_id: req.user && req.user._id,
                  cua_hang_id: storeForTransaction,
                  trang_thai: 'paid',
                  ghi_chu: note,
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
          var transaction = await GiaoDichCongNoNhaCungCap.create({
              cua_hang_id: storeForTransaction,
              nha_cung_cap_id: supplier._id,
              ma_giao_dich: await makeSupplierDebtTransactionCode(storeForTransaction),
              loai_giao_dich: 'chiet_khau_thanh_toan',
              huong_cong_no: 'giam_no',
              gia_tri: amount,
              no_truoc: debt,
              no_sau: Math.max(0, debt - amount),
              ngay_giao_dich: new Date(),
              anh_huong_so_quy: Boolean(receipt),
              phieu_thu_chi_id: receipt ? receipt._id : null,
              ghi_chu: note,
              nguoi_tao_id: req.user && req.user._id
          });
          await NhaCungCap.updateOne(
              { _id: supplier._id },
              { $inc: { tong_no: -amount } }
          );
  
          return res.json({
              success: true,
              message: 'Đã tạo chiết khấu thanh toán nhà cung cấp',
              data: {
                  transaction: transaction,
                  discount: amount,
                  debt: debt - amount
              }
          });
      } catch (error) {
          return res.status(400).json({ success: false, message: error.message || 'Không tạo được chiết khấu thanh toán' });
      }
  };
