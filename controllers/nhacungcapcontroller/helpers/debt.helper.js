const { mongoose, PhieuNhap, SoQuy, Counter, parseMoney, SUPPLIER_DEBT_WARN_DEFAULT_DAYS } = require('./common.helper');

function isVisibleSupplierDebtRow(row) {
    if (!row) return false;
    if (row.trang_thai === 'cancelled') return false;
    if (row.phieu_nhap_id && isDeletedDebtLinkedDoc(row.phieu_nhap_id)) return false;
    if (row.nhap_vat_chua_id && isDeletedDebtLinkedDoc(row.nhap_vat_chua_id)) return false;
    if (row.phieu_tra_nhap_id && isDeletedDebtLinkedDoc(row.phieu_tra_nhap_id)) return false;
    if (row.phieu_tra_hang_nhap_id && isDeletedDebtLinkedDoc(row.phieu_tra_hang_nhap_id)) return false;
    if (row.phieu_thu_chi_id && isDeletedDebtLinkedDoc(row.phieu_thu_chi_id)) return false;
    return true;
}

function isDeletedDebtLinkedDoc(doc) {
    if (!doc || typeof doc !== 'object') return false;
    var status = String(doc.trang_thai || '').trim();
    // Ẩn chứng từ đã hủy hoặc đã gộp vào phiếu nhận (chỉ hiện phiếu nhận).
    return status === 'cancelled' || status === 'merged';
}

function getDebtDocumentInfo(row) {
    if (row.phieu_tra_nhap_id) {
        return {
            type: 'tra_hang_nhap',
            label: 'Trả hàng nhập',
            doc: row.phieu_tra_nhap_id,
            code: row.phieu_tra_nhap_id.ma_phieu_tra_nhap || '--'
        };
    }
    if (row.phieu_thu_chi_id) {
        var receiptType = row.phieu_thu_chi_id.loai_phieu;
        var receiptKind = String(row.phieu_thu_chi_id.loai_thu_chi || '').toLowerCase();
        var isVatChuaReturn = receiptType === 'thu' && receiptKind.indexOf('trả vật chứa') >= 0;
        return {
            type: isVatChuaReturn ? 'tra_vat_chua' : 'phieu_thu_chi',
            label: receiptType === 'thu' ? 'Phiếu thu' : (receiptType === 'chi' ? 'Phiếu chi' : 'Phiếu thu/chi'),
            doc: row.phieu_thu_chi_id,
            code: row.phieu_thu_chi_id.ma_phieu || '--'
        };
    }
    if (row.phieu_nhap_id) {
        return {
            type: 'phieu_nhap',
            label: 'Phiếu nhập',
            doc: row.phieu_nhap_id,
            code: row.phieu_nhap_id.ma_phieu_nhap || '--'
        };
    }
    if (row.nhap_vat_chua_id) {
        return {
            type: 'nhap_vat_chua',
            label: 'Nhập vật chứa',
            doc: row.nhap_vat_chua_id,
            code: row.nhap_vat_chua_id.ma_nhap_vat_chua || '--'
        };
    }
    return { type: '', label: 'Khác', doc: null, code: '--' };
}

function getSupplierDebtAmountInfo(row, amount, runningDebt) {
    var docInfo = getDebtDocumentInfo(row);
    var doc = docInfo.doc || {};
    var value = Number(amount || 0);
    var paid = 0;
    var remaining = Math.max(0, Number(runningDebt || 0));
    var isDebtDecrease = row && (row.loai === 'giam_no' || row.loai === 'thanh_toan');

    if (docInfo.type === 'phieu_nhap') {
        value = Number(doc.can_tra_ncc || doc.tong_tien || amount || 0);
        paid = Number(doc.da_tra_ncc || 0);
        remaining = Number(doc.con_no_ncc || Math.max(0, value - paid));
    } else if (docInfo.type === 'tra_hang_nhap') {
        value = Number(doc.ncc_can_tra || doc.tong_tien_tra || amount || 0);
        paid = Number(doc.ncc_da_tra || 0);
        remaining = Math.max(0, value - paid);
    }

    if (isDebtDecrease && docInfo.type !== 'tra_hang_nhap') {
        if (row.loai === 'thanh_toan') paid = value;
        remaining = 0;
    }

    return {
        gia_tri: value,
        da_thanh_toan: paid,
        con_lai: remaining,
        tong_no: Number(runningDebt || 0)
    };
}

function getLegacySupplierDebtDelta(row, amount) {
    var value = Number(amount || 0);
    var receiptType = row && row.phieu_thu_chi_id && row.phieu_thu_chi_id.loai_phieu;
    if (row && row.loai === 'tang_no' && row.phieu_nhap_id && typeof row.phieu_nhap_id === 'object') {
        value = Number(row.phieu_nhap_id.can_tra_ncc || row.phieu_nhap_id.tong_tien || row.phieu_nhap_id.con_no_ncc || amount || 0);
    }
    if (row && row.loai === 'giam_no' && row.phieu_tra_nhap_id && typeof row.phieu_tra_nhap_id === 'object') {
        value = Number(row.phieu_tra_nhap_id.ncc_da_tra || 0);
    }
    if (receiptType === 'thu') return value;
    if (row && row.loai === 'tang_no') return value;
    if (row && (row.loai === 'giam_no' || row.loai === 'thanh_toan')) return -value;
    return 0;
}

function getDebtEventTime(row) {
    if (!row) return 0;
    if (row.phieu_tra_nhap_id) {
        return new Date(row.phieu_tra_nhap_id.ngay_tra || row.ngay || row.phieu_tra_nhap_id.created_at || row.created_at || 0).getTime();
    }
    if (row.nhap_vat_chua_id) {
        return new Date(row.nhap_vat_chua_id.created_at || row.ngay || row.created_at || 0).getTime();
    }
    if (row.phieu_nhap_id) {
        return new Date(row.phieu_nhap_id.ngay_nhap || row.ngay || row.phieu_nhap_id.created_at || row.created_at || 0).getTime();
    }
    return new Date(row.ngay || row.created_at || 0).getTime();
}

function getDebtDisplayDate(row) {
    if (row && row.phieu_tra_nhap_id) return row.phieu_tra_nhap_id.ngay_tra || row.ngay || row.phieu_tra_nhap_id.created_at || row.created_at;
    if (row && row.nhap_vat_chua_id) return row.nhap_vat_chua_id.created_at || row.ngay || row.created_at;
    if (row && row.phieu_nhap_id) return row.phieu_nhap_id.ngay_nhap || row.ngay || row.phieu_nhap_id.created_at || row.created_at;
    return row ? (row.ngay || row.created_at) : null;
}

function getDebtSortCreatedTime(row) {
    if (!row) return 0;
    return new Date(row.created_at || row.updated_at || 0).getTime();
}

function getDebtSortCode(row) {
    if (!row) return '';
    return String(row._id || row.ma_giao_dich || row.ma_phieu || row.ma_phieu_tra_nhap || row.ma_nhap_vat_chua || '');
}

function sortDebtLedgerAsc(a, b) {
    var timeA = new Date(a && a.date || 0).getTime();
    var timeB = new Date(b && b.date || 0).getTime();
    if (timeA !== timeB) return timeA - timeB;

    var createdA = getDebtSortCreatedTime(a && a.row);
    var createdB = getDebtSortCreatedTime(b && b.row);
    if (createdA !== createdB) return createdA - createdB;

    return getDebtSortCode(a && a.row).localeCompare(getDebtSortCode(b && b.row));
}

function enrichSupplierDebtHistory(rows, warnMinDays) {
    var minDays = Number(warnMinDays) >= 0 ? Number(warnMinDays) : SUPPLIER_DEBT_WARN_DEFAULT_DAYS;
    var now = Date.now();
    return (rows || []).map(function(row) {
        var copy = Object.assign({}, row);
        var conLai = Number(copy.con_lai || 0);
        var thoiGian = copy.thoi_gian;
        var days = null;
        if (thoiGian) {
            var ts = new Date(thoiGian).getTime();
            if (ts > 0) days = Math.max(0, Math.floor((now - ts) / 86400000));
        }
        copy.so_ngay_no = days;
        copy.co_no_con_lai = conLai > 0;
        copy.is_debt_overdue = conLai > 0 && days != null && days >= minDays;
        return copy;
    });
}

function sortSupplierDebtHistoryRows(rows) {
    return rows.slice().sort(function(a, b) {
        return new Date(b.thoi_gian || 0).getTime() - new Date(a.thoi_gian || 0).getTime();
    });
}

function mapSupplierDebtTransactionLabel(value) {
    if (value === 'nhap_hang') return 'Phiếu nhập';
    if (value === 'tra_hang_nhap') return 'Trả hàng nhập';
    if (value === 'thanh_toan') return 'Thanh toán';
    if (value === 'chiet_khau_thanh_toan') return 'Chiết khấu thanh toán';
    if (value === 'dieu_chinh_tang') return 'Điều chỉnh tăng';
    if (value === 'dieu_chinh_giam') return 'Điều chỉnh giảm';
    return 'Khác';
}

function resolveSupplierDaThanhToan(supplier) {
    var totalBuy = Number(supplier && supplier.tong_mua || 0);
    var debt = Number(supplier && supplier.tong_no || 0);
    var paid = Number(supplier && supplier.da_tra_tong || 0);
    if (!Number.isFinite(paid) || paid < 0) paid = 0;
    if (!paid && (totalBuy || debt)) {
        paid = Math.max(0, totalBuy - debt);
    }
    return paid;
}

function normalizeSupplierPaymentInput(body) {
    body = body || {};
    var isV2 = supplierPaymentIsV2(body);
    var tienMat = parseMoney(supplierReadPaymentValue(body, 'tien_mat'));
    var chuyenKhoan = parseMoney(supplierReadPaymentValue(body, 'chuyen_khoan'));
    var tienTraKhach = parseMoney(supplierReadPaymentValue(body, 'tien_tra_khach'));
    var amount = tienMat + chuyenKhoan;
    if (!isV2 && amount <= 0) {
        amount = parseMoney(body.gia_tri);
        tienMat = amount;
        chuyenKhoan = 0;
    }
    if (isV2 && tienTraKhach > 0) {
        throw new Error('Tiền trả khách không áp dụng cho thanh toán nhà cung cấp.');
    }
    return {
        isV2: isV2,
        amount: amount,
        tien_mat: tienMat,
        chuyen_khoan: chuyenKhoan,
        tien_tra_khach: 0,
        so_quy_tien_mat_id: String(supplierReadPaymentValue(body, 'so_quy_tien_mat_id') || '').trim(),
        so_quy_chuyen_khoan_id: String(supplierReadPaymentValue(body, 'so_quy_chuyen_khoan_id') || '').trim()
    };
}

async function loadSupplierUnpaidPurchases(supplierId, storeId) {
    var query = {
        nha_cung_cap_id: supplierId,
        trang_thai: 'completed',
        con_no_ncc: { $gt: 0 }
    };
    if (storeId && mongoose.Types.ObjectId.isValid(storeId)) query.cua_hang_id = storeId;
    return await PhieuNhap.find(query)
        .sort({ ngay_nhap: 1, created_at: 1 })
        .select('ma_phieu_nhap ngay_nhap tong_tien can_tra_ncc da_tra_ncc con_no_ncc')
        .lean();
}

async function loadSupplierPayableDocuments(supplierId, storeId) {
    var purchases = await loadSupplierUnpaidPurchases(supplierId, storeId);
    var docs = purchases.map(function(row) {
        return Object.assign({}, row, {
            doc_type: 'phieu_nhap',
            doc_id: row._id,
            ma_chung_tu: row.ma_phieu_nhap || '',
            ngay_chung_tu: row.ngay_nhap || row.created_at,
            gia_tri_phai_tra: Number(row.can_tra_ncc || row.tong_tien || 0),
            da_thanh_toan: Number(row.da_tra_ncc || 0),
            con_no: Math.max(0, Number(row.con_no_ncc || 0))
        });
    });
    docs.sort(function(a, b) {
        return new Date(a.ngay_chung_tu || a.created_at || 0).getTime() - new Date(b.ngay_chung_tu || b.created_at || 0).getTime();
    });
    return docs;
}

function sumInvoiceDebt(purchases) {
    return (Array.isArray(purchases) ? purchases : []).reduce(function(sum, row) {
        return sum + Math.max(0, Number(row.con_no_ncc != null ? row.con_no_ncc : row.con_no || 0));
    }, 0);
}

function buildDebtReconciliation(invoiceDebt, ledgerDebt) {
    var debtByInvoices = Math.max(0, Number(invoiceDebt || 0));
    var currentDebt = Math.max(0, Number(ledgerDebt || 0));
    var debtByLedger = Math.abs(debtByInvoices - currentDebt);
    var debtDiff = debtByInvoices - debtByLedger;
    return {
        debtByInvoices: debtByInvoices,
        debtByLedger: debtByLedger,
        currentDebt: currentDebt,
        debtDiff: debtDiff,
        hasDebtMismatch: debtByLedger > 1
    };
}

async function makeSupplierDebtTransactionCode(storeId) {
    var counterKey = 'giao_dich_cong_no_nha_cung_cap';
    if (storeId && mongoose.Types.ObjectId.isValid(storeId)) counterKey += ':' + String(storeId);
    var counter = await Counter.findOneAndUpdate(
        { _id: counterKey },
        { $inc: { seq: 1 } },
        { new: true, upsert: true }
    ).lean();
    return 'GDNCC' + String(Number(counter?.seq || 1)).padStart(6, '0');
}

async function loadActiveCashBooks() {
    return SoQuy.find({ trang_thai: 'active' }).sort({ ten_so_quy: 1 }).lean();
}

function supplierReadNestedPayment(body) {
    body = body || {};
    if (body.chi_tiet_thanh_toan && typeof body.chi_tiet_thanh_toan === 'object') return body.chi_tiet_thanh_toan;
    return {};
}

function supplierReadPaymentValue(body, key) {
    var nested = supplierReadNestedPayment(body);
    if (nested[key] !== undefined) return nested[key];
    var bracketKey = 'chi_tiet_thanh_toan[' + key + ']';
    if (body && body[bracketKey] !== undefined) return body[bracketKey];
    return body ? body[key] : undefined;
}

function supplierHasPaymentBookId(body, key) {
    return String(supplierReadPaymentValue(body, key) || '').trim() !== '';
}

function supplierPaymentIsV2(body) {
    var flag = body && body.payment_v2;
    return flag === true
        || flag === 'true'
        || flag === '1'
        || supplierHasPaymentBookId(body, 'so_quy_tien_mat_id')
        || supplierHasPaymentBookId(body, 'so_quy_chuyen_khoan_id');
}

module.exports = {
  isVisibleSupplierDebtRow,
  isDeletedDebtLinkedDoc,
  getDebtDocumentInfo,
  getSupplierDebtAmountInfo,
  getLegacySupplierDebtDelta,
  getDebtEventTime,
  getDebtDisplayDate,
  getDebtSortCreatedTime,
  getDebtSortCode,
  sortDebtLedgerAsc,
  enrichSupplierDebtHistory,
  sortSupplierDebtHistoryRows,
  mapSupplierDebtTransactionLabel,
  resolveSupplierDaThanhToan,
  normalizeSupplierPaymentInput,
  loadSupplierUnpaidPurchases,
  loadSupplierPayableDocuments,
  sumInvoiceDebt,
  buildDebtReconciliation,
  makeSupplierDebtTransactionCode,
  loadActiveCashBooks,
  supplierReadNestedPayment,
  supplierReadPaymentValue,
  supplierHasPaymentBookId,
  supplierPaymentIsV2
};
