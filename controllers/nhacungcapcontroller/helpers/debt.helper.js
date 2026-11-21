const { mongoose, PhieuNhap, SoQuy, Counter, parseMoney, SUPPLIER_DEBT_WARN_DEFAULT_DAYS, NhapVatChua, XuatVatChua } = require('./common.helper');
const { loadNhapVatChuaPaymentTotals, loadNhapVatChuaReturnTotals } = require('../../../services/vatChuaPaymentTotals.service');

function isVisibleSupplierDebtRow(row) {
    if (!row) return false;
    if (row.trang_thai === 'cancelled') return false;
    var isPurchaseReturn = Boolean(row.phieu_tra_nhap_id || row.phieu_tra_hang_nhap_id);
    if (row.phieu_nhap_id && isDeletedDebtLinkedDoc(row.phieu_nhap_id, !isPurchaseReturn)) return false;
    if (row.nhap_vat_chua_id && isDeletedDebtLinkedDoc(row.nhap_vat_chua_id)) return false;
    if (row.xuat_vat_chua_id && isDeletedDebtLinkedDoc(row.xuat_vat_chua_id)) return false;
    if (row.phieu_tra_nhap_id && isDeletedDebtLinkedDoc(row.phieu_tra_nhap_id)) return false;
    if (row.phieu_tra_hang_nhap_id && isDeletedDebtLinkedDoc(row.phieu_tra_hang_nhap_id)) return false;
    if (row.phieu_thu_chi_id && isDeletedDebtLinkedDoc(row.phieu_thu_chi_id)) return false;
    return true;
}

function isManualNhapVatChuaDoc(doc) {
    if (!doc || typeof doc !== 'object') return false;
    if (String(doc.trang_thai || '').trim() === 'cancelled') return false;
    var sourceType = String(doc.source_type || 'manual').trim();
    // Chỉ nhập thủ công; bỏ nhập gắn phiếu nhập / chứng từ khác.
    return sourceType === 'manual';
}

function isIncludedInSupplierDebtHistory(row) {
    if (!isVisibleSupplierDebtRow(row)) return false;
    if (row.nhap_vat_chua_id) return isManualNhapVatChuaDoc(row.nhap_vat_chua_id);
    if (row.xuat_vat_chua_id) {
        var xuat = row.xuat_vat_chua_id;
        if (!xuat || typeof xuat !== 'object') return false;
        if (String(xuat.trang_thai || '').trim() === 'cancelled') return false;
        return String(xuat.source_type || '').trim() === 'manual';
    }
    return true;
}

function isDeletedDebtLinkedDoc(doc, checkDataStatus) {
    if (!doc || typeof doc !== 'object') return false;
    // Phiếu trả có trạng thái dữ liệu riêng, không phụ thuộc trạng thái dữ liệu phiếu nhập gốc.
    if (checkDataStatus !== false && doc.trang_thai_du_lieu === 'inactive') return true;
    var status = String(doc.trang_thai || '').trim();
    // Ẩn chứng từ đã hủy hoặc đã gộp vào phiếu nhận (chỉ hiện phiếu nhận).
    return status === 'cancelled' || status === 'merged';
}

function resolveDebtRelatedId(value) {
    if (!value) return '';
    if (typeof value === 'object') return String(value._id || value.id || '');
    return String(value);
}

/**
 * Sau gộp phiếu nhập, nhiều dòng CongNo.tang_no bị remap về cùng phieu_nhap_id.
 * Chỉ giữ 1 dòng tăng nợ / phiếu nhận (ưu tiên bản ghi tạo sớm nhất).
 */
function getSupplierDebtDedupeKey(row) {
    if (!row) return '';
    var purchaseId = resolveDebtRelatedId(row.phieu_nhap_id);
    if (!purchaseId) return '';
    if (row.phieu_thu_chi_id || row.phieu_tra_nhap_id || row.phieu_tra_hang_nhap_id) return '';

    var loai = String(row.loai || '').trim();
    var loaiGiaoDich = String(row.loai_giao_dich || '').trim();
    var huong = String(row.huong_cong_no || '').trim();

    if (loai === 'tang_no' || loaiGiaoDich === 'nhap_hang' || (huong === 'tang_no' && loaiGiaoDich === 'nhap_hang')) {
        return 'pn_tang:' + purchaseId;
    }
    return '';
}

function dedupeSupplierDebtSourceRows(rows) {
    var list = Array.isArray(rows) ? rows.slice() : [];
    list.sort(function(a, b) {
        var timeA = new Date(a && (a.created_at || a.ngay || a.ngay_giao_dich) || 0).getTime();
        var timeB = new Date(b && (b.created_at || b.ngay || b.ngay_giao_dich) || 0).getTime();
        if (timeA !== timeB) return timeA - timeB;
        return resolveDebtRelatedId(a && a._id).localeCompare(resolveDebtRelatedId(b && b._id));
    });
    var seen = Object.create(null);
    var result = [];
    list.forEach(function(row) {
        var key = getSupplierDebtDedupeKey(row);
        if (key) {
            if (seen[key]) return;
            seen[key] = true;
        }
        result.push(row);
    });
    return result;
}

function applySupplierDebtHistoryDisplayTotals(rows) {
    var runningDebt = 0;
    var result = Array.isArray(rows) ? rows : [];
    for (var i = result.length - 1; i >= 0; i--) {
        var row = result[i] || {};
        var type = String(row.loai || '').trim();
        if (type === 'tang_no') {
            // Cộng phần còn nợ của phiếu (đã net thanh toán trên phiếu nhập).
            runningDebt += Math.max(0, Number(row.con_lai || 0));
        } else if (type === 'giam_no') {
            var decrease = row.phieu_tra_nhap_id
                ? Math.max(0, Number(row.da_thanh_toan || 0))
                : Math.max(0, Number(row.gia_tri || 0));
            runningDebt -= decrease;
        }
        row.tong_no = Math.max(0, runningDebt);
        row.no_con_lai = row.tong_no;
    }
    return result;
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
    if (row.xuat_vat_chua_id) {
        var xuatDoc = row.xuat_vat_chua_id;
        var isReturn = xuatDoc && String(xuatDoc.loai_xuat || '').trim() === 'tra_hang_nhap';
        return {
            type: 'xuat_vat_chua',
            label: isReturn ? 'Trả vật chứa' : 'Xuất vật chứa',
            doc: xuatDoc,
            code: (xuatDoc && xuatDoc.ma_xuat_vat_chua) || '--'
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
    } else if (docInfo.type === 'nhap_vat_chua') {
        value = Number(doc.tong_tien || amount || 0);
        paid = Number(doc.da_tra || 0);
        remaining = Number(doc.con_no != null ? doc.con_no : Math.max(0, value - paid));
    } else if (docInfo.type === 'xuat_vat_chua') {
        value = Number(doc.tong_tien || amount || 0);
        paid = 0;
        remaining = 0;
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
    if (row.xuat_vat_chua_id) {
        return new Date(row.xuat_vat_chua_id.created_at || row.ngay || row.created_at || 0).getTime();
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
    if (row && row.xuat_vat_chua_id) return row.xuat_vat_chua_id.created_at || row.ngay || row.created_at;
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
        trang_thai_du_lieu: { $ne: 'inactive' },
        con_no_ncc: { $gt: 0 }
    };
    if (storeId && mongoose.Types.ObjectId.isValid(storeId)) query.cua_hang_id = storeId;
    return await PhieuNhap.find(query)
        .sort({ ngay_nhap: 1, created_at: 1 })
        .select('ma_phieu_nhap ngay_nhap tong_tien can_tra_ncc da_tra_ncc con_no_ncc')
        .lean();
}

function attachManualNhapVatChuaPaidAmounts(debtRows) {
    var paidMap = Object.create(null);
    (debtRows || []).forEach(function(row) {
        if (!row || !row.nhap_vat_chua_id) return;
        if (row.loai !== 'thanh_toan' && row.loai !== 'giam_no') return;
        if (!row.phieu_thu_chi_id) return;
        var key = resolveDebtRelatedId(row.nhap_vat_chua_id);
        if (!key) return;
        paidMap[key] = Number(paidMap[key] || 0) + Math.max(0, Number(row.so_tien || 0));
    });
    (debtRows || []).forEach(function(row) {
        if (!(row && row.loai === 'tang_no' && row.nhap_vat_chua_id && typeof row.nhap_vat_chua_id === 'object')) return;
        var key = String(row.nhap_vat_chua_id._id || '');
        var paid = Math.max(0, Number(paidMap[key] || 0));
        var total = Math.max(0, Number(row.nhap_vat_chua_id.tong_tien || row.so_tien || 0));
        row.nhap_vat_chua_id.da_tra = paid;
        row.nhap_vat_chua_id.con_no = Math.max(0, total - paid);
    });
    return debtRows;
}

function buildManualNhapVatChuaMatch(supplierId, storeId) {
    var supplierOid = mongoose.Types.ObjectId.isValid(String(supplierId || ''))
        ? new mongoose.Types.ObjectId(String(supplierId))
        : null;
    var doiTuongIds = [];
    if (supplierOid) doiTuongIds.push(supplierOid);
    if (supplierId) doiTuongIds.push(String(supplierId));
    var match = {
        doi_tuong_type: 'nha_cung_cap',
        doi_tuong_id: doiTuongIds.length > 1 ? { $in: doiTuongIds } : supplierId,
        trang_thai: 'active',
        tong_tien: { $gt: 0 },
        // Thủ công: manual hoặc bản ghi cũ chưa ghi source_type.
        $or: [
            { source_type: 'manual' },
            { source_type: { $exists: false } },
            { source_type: null },
            { source_type: '' }
        ]
    };
    if (storeId && mongoose.Types.ObjectId.isValid(storeId)) match.cua_hang_id = storeId;
    return match;
}

async function loadManualNhapVatChuaDebtSourceRows(supplierId, storeId) {
    if (!NhapVatChua || !supplierId) return [];
    var query = buildManualNhapVatChuaMatch(supplierId, storeId);
    var rows = await NhapVatChua.find(query).sort({ created_at: 1 }).lean();
    if (!rows.length) return [];

    var paidMap = await loadNhapVatChuaPaymentTotals(rows, { storeId: storeId });
    var returnedMap = await loadNhapVatChuaReturnTotals(rows, { storeId: storeId });

    return rows.map(function(row) {
        var total = Math.max(0, Number(row.tong_tien || 0));
        var paid = Math.max(0, Number(paidMap.get(String(row._id)) || 0));
        var returned = Math.max(0, Number(returnedMap.get(String(row._id)) || 0));
        var doc = Object.assign({}, row, {
            source_type: row.source_type || 'manual',
            da_tra: paid,
            returned_amount: returned,
            con_no: Math.max(0, total - paid - returned)
        });
        return {
            _id: row._id,
            cua_hang_id: row.cua_hang_id,
            nha_cung_cap_id: supplierId,
            nhap_vat_chua_id: doc,
            so_tien: total,
            loai: 'tang_no',
            ghi_chu: row.ghi_chu || '',
            ngay: row.created_at,
            created_at: row.created_at,
            _synthetic_nhap_vat_chua: true
        };
    });
}

async function loadManualXuatVatChuaDebtSourceRows(supplierId, storeId) {
    if (!XuatVatChua || !supplierId) return [];
    var query = {
        doi_tuong_type: 'nha_cung_cap',
        doi_tuong_id: supplierId,
        source_type: 'manual',
        trang_thai: 'active',
        tong_tien: { $gt: 0 }
    };
    if (storeId && mongoose.Types.ObjectId.isValid(storeId)) query.cua_hang_id = storeId;
    var rows = await XuatVatChua.find(query).sort({ created_at: 1 }).lean();
    if (!rows.length) return [];

    var sourceIds = rows.map(function(row) { return row.source_id; }).filter(Boolean);
    var nhapById = Object.create(null);
    if (sourceIds.length && NhapVatChua) {
        var nhapRows = await NhapVatChua.find({ _id: { $in: sourceIds } })
            .select('source_type trang_thai')
            .lean();
        nhapRows.forEach(function(nhap) {
            nhapById[String(nhap._id)] = nhap;
        });
    }

    return rows.filter(function(row) {
        if (!row.source_id) return true;
        var nhap = nhapById[String(row.source_id)];
        if (!nhap) return true;
        // Xuất trả theo nhập gắn phiếu nhập → không đưa vào sổ nợ VC thủ công.
        return isManualNhapVatChuaDoc(nhap);
    }).map(function(row) {
        return {
            _id: row._id,
            cua_hang_id: row.cua_hang_id,
            nha_cung_cap_id: supplierId,
            xuat_vat_chua_id: row,
            so_tien: Number(row.tong_tien || 0),
            loai: 'giam_no',
            ghi_chu: row.ghi_chu || '',
            ngay: row.created_at,
            created_at: row.created_at,
            _synthetic_xuat_vat_chua: true
        };
    });
}

async function loadSupplierUnpaidManualVatChua(supplierId, storeId) {
    if (!NhapVatChua || !supplierId) return [];
    var query = buildManualNhapVatChuaMatch(supplierId, storeId);
    var rows = await NhapVatChua.find(query)
        .sort({ created_at: 1 })
        .select('ma_nhap_vat_chua created_at tong_tien cua_hang_id')
        .lean();
    if (!rows.length) return [];

    var paidMap = await loadNhapVatChuaPaymentTotals(rows, { storeId: storeId });
    var returnedMap = await loadNhapVatChuaReturnTotals(rows, { storeId: storeId });

    return rows.map(function(row) {
        var total = Math.max(0, Number(row.tong_tien || 0));
        var paid = Math.max(0, Number(paidMap.get(String(row._id)) || 0));
        var returned = Math.max(0, Number(returnedMap.get(String(row._id)) || 0));
        var conNo = Math.max(0, total - paid - returned);
        return Object.assign({}, row, {
            doc_type: 'nhap_vat_chua',
            doc_id: row._id,
            ma_chung_tu: row.ma_nhap_vat_chua || '',
            ma_nhap_vat_chua: row.ma_nhap_vat_chua || '',
            ngay_chung_tu: row.created_at,
            gia_tri_phai_tra: total,
            da_thanh_toan: paid,
            da_tra_ncc: paid,
            returned_amount: returned,
            con_no: conNo,
            con_no_ncc: conNo
        });
    }).filter(function(row) {
        return Number(row.con_no || 0) > 0;
    });
}

async function loadSupplierPayableDocuments(supplierId, storeId) {
    var purchases = await loadSupplierUnpaidPurchases(supplierId, storeId);
    var vatChuaDocs = await loadSupplierUnpaidManualVatChua(supplierId, storeId);
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
    }).concat(vatChuaDocs);
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
  isManualNhapVatChuaDoc,
  isIncludedInSupplierDebtHistory,
  resolveDebtRelatedId,
  getSupplierDebtDedupeKey,
  dedupeSupplierDebtSourceRows,
  applySupplierDebtHistoryDisplayTotals,
  attachManualNhapVatChuaPaidAmounts,
  loadManualNhapVatChuaDebtSourceRows,
  loadManualXuatVatChuaDebtSourceRows,
  loadSupplierUnpaidManualVatChua,
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
