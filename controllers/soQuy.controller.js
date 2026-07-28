const mongoose = require('mongoose');
const {
    PhieuThuChi,
    SoQuy,
    KhachHang,
    NhaCungCap,
    NguoiDung,
    CTPhieuNhap,
    DoiTacGiaoHang,
    HoaDonBanHang,
    PhieuNhap,
    PhieuTraHangNhap,
    PhieuTraHang,
    DonHang,
    NhapVatChua
} = require('../models/kiot.model');
const { NhanVien } = require('../models/hr.model');
const { ChamCongMoiBangLuong } = require('../models/chamcongmoi.model');
const { taoPhieuThuChi } = require('../services/soQuy.service');
const {
    buildReceiptPaymentInfo,
    hasV2PaymentPayload
} = require('../services/paymentCashBook.service');
const {
    listRelatedDocuments,
    validateReceiptDocumentAmount
} = require('../services/cashbookRelatedDocument.service');
const {
    resolveCashBookFilterScope,
    buildCashBookMeta,
    computeScopedTotals,
    attachScopedAmounts
} = require('../services/cashbookListScope.service');
const { resolveStoreId } = require('../utils/storeScope');
const hrLog = require('../utils/hrPayrollLogger');

function isObjectId(value) {
    return /^[0-9a-fA-F]{24}$/.test(String(value || ''));
}

function toObjectId(value) {
    return isObjectId(value) ? new mongoose.Types.ObjectId(String(value)) : value;
}

function receiptErrorMessage(error) {
    if (!error) return 'Khong tao duoc phieu';
    if (error.code === 11000) return 'Ma phieu da ton tai';
    if (error.name === 'CastError') return 'Dữ liệu phiếu thu chi không hợp lệ.';
    if (error.name === 'ValidationError') return 'Dữ liệu phiếu thu chi không hợp lệ.';
    return error.message || 'Khong tao duoc phieu';
}

function buildFilter(query = {}, storeId) {
    const filter = {};
    if (storeId) filter.cua_hang_id = toObjectId(storeId);
    filter.deleted_at = null;
    if (query.q && query.q.trim() !== '') filter.ma_phieu = { $regex: query.q.trim(), $options: 'i' };
    if (query.loai_phieu && ['thu', 'chi'].includes(query.loai_phieu)) filter.loai_phieu = query.loai_phieu;
    if (query.doi_tuong_search && query.doi_tuong_search.trim() !== '') filter.doi_tuong = { $regex: query.doi_tuong_search.trim(), $options: 'i' };
    if (query.loai_thu_chi && query.loai_thu_chi.trim() !== '') filter.loai_thu_chi = { $regex: query.loai_thu_chi.trim(), $options: 'i' };
    if (query.trang_thai === 'all') {
        // No status filter.
    } else if (query.trang_thai && query.trang_thai.trim() !== '') {
        filter.trang_thai = query.trang_thai.trim();
    } else {
        filter.trang_thai = { $ne: 'cancelled' };
    }
    if (query.hach_toan === 'yes') filter.hach_toan = true;
    if (query.hach_toan === 'no') filter.hach_toan = false;
    if (query.nhom_doi_tuong && query.nhom_doi_tuong !== 'all') filter.nhom_doi_tuong = query.nhom_doi_tuong;
    if (query.phuong_thuc_thanh_toan && query.phuong_thuc_thanh_toan !== 'all') filter.phuong_thuc_thanh_toan = query.phuong_thuc_thanh_toan;

    const dateFrom = query.date_from ? new Date(query.date_from + 'T00:00:00') : null;
    const dateTo = query.date_to ? new Date(query.date_to + 'T23:59:59') : null;
    if (dateFrom || dateTo || query.time_type === 'this_month') {
        filter.ngay_lap = {};
        if (query.time_type === 'this_month') {
            const now = new Date();
            filter.ngay_lap.$gte = new Date(now.getFullYear(), now.getMonth(), 1);
            filter.ngay_lap.$lte = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
        }
        if (dateFrom && !Number.isNaN(dateFrom.getTime())) filter.ngay_lap.$gte = dateFrom;
        if (dateTo && !Number.isNaN(dateTo.getTime())) filter.ngay_lap.$lte = dateTo;
    }
    if (query.nguoi_tao && isObjectId(query.nguoi_tao)) filter.nguoi_tao_id = query.nguoi_tao;
    if (query.doi_tuong_loai === 'khach_hang') filter.khach_hang_id = { $ne: null };
    if (query.doi_tuong_loai === 'nha_cung_cap') filter.nha_cung_cap_id = { $ne: null };
    if (query.doi_tuong_loai === 'khac') {
        filter.khach_hang_id = null;
        filter.nha_cung_cap_id = null;
    }
    return filter;
}

function buildBookMatchConditions(bookIds = [], kind) {
    const ids = (Array.isArray(bookIds) ? bookIds : []).filter(Boolean);
    const conditions = [];
    if (ids.length) {
        conditions.push(
            { so_quy_id: { $in: ids } },
            { 'chi_tiet_thanh_toan.so_quy_tien_mat_id': { $in: ids } },
            { 'chi_tiet_thanh_toan.so_quy_chuyen_khoan_id': { $in: ids } }
        );
    }
    if (kind === 'tien_mat') {
        conditions.push({ 'chi_tiet_thanh_toan.tien_mat': { $gt: 0 } });
    }
    if (kind === 'chuyen_khoan') {
        conditions.push({ 'chi_tiet_thanh_toan.chuyen_khoan': { $gt: 0 } });
    }
    if (!conditions.length) {
        return [{ _id: new mongoose.Types.ObjectId('000000000000000000000000') }];
    }
    return conditions;
}

function mergeFilterClause(filter, clause) {
    if (!clause || !Object.keys(clause).length) return filter;
    if (filter.$or && !filter.$and) {
        filter.$and = [{ $or: filter.$or }, clause];
        delete filter.$or;
    } else if (filter.$and) {
        filter.$and.push(clause);
    } else {
        Object.assign(filter, clause);
    }
    return filter;
}

async function applyCashBookFilter(filter, query = {}) {
    const soQuyId = String(query.so_quy_id || 'all').trim();
    if (!soQuyId || soQuyId === 'all') return filter;

    let bookClause = null;
    if (soQuyId === 'unassigned') {
        bookClause = { $or: [{ so_quy_id: null }, { so_quy_id: { $exists: false } }] };
    } else if (soQuyId === 'tien_mat') {
        const books = await SoQuy.find({ loai_so_quy: 'tien_mat', $or: [{ deleted_at: null }, { deleted_at: { $exists: false } }] }).select('_id').lean();
        bookClause = { $or: buildBookMatchConditions(books.map(book => book._id), 'tien_mat') };
    } else if (soQuyId === 'chuyen_khoan') {
        const books = await SoQuy.find({ loai_so_quy: 'chuyen_khoan', $or: [{ deleted_at: null }, { deleted_at: { $exists: false } }] }).select('_id').lean();
        bookClause = { $or: buildBookMatchConditions(books.map(book => book._id), 'chuyen_khoan') };
    } else if (isObjectId(soQuyId)) {
        const bookId = toObjectId(soQuyId);
        bookClause = {
            $or: [
                { so_quy_id: bookId },
                { 'chi_tiet_thanh_toan.so_quy_tien_mat_id': bookId },
                { 'chi_tiet_thanh_toan.so_quy_chuyen_khoan_id': bookId }
            ]
        };
    }

    return mergeFilterClause(filter, bookClause);
}

async function buildFullFilter(query = {}, storeId) {
    const filter = buildFilter(query, storeId);
    await applyCashBookFilter(filter, query);
    return filter;
}

function getPeriodStart(query = {}) {
    if (query.date_from) {
        const from = new Date(query.date_from + 'T00:00:00');
        if (!Number.isNaN(from.getTime())) return from;
    }
    if (query.time_type === 'this_month') {
        const now = new Date();
        return new Date(now.getFullYear(), now.getMonth(), 1);
    }
    return null;
}

async function loadPartnerLists(storeId) {
    const storeFilter = storeId ? { cua_hang_id: toObjectId(storeId) } : {};
    const [employees, carriers] = await Promise.all([
        NhanVien.find({ ...storeFilter, trang_thai: 'dang_lam_viec' }).select('ma_nhan_vien ten_nhan_vien sdt').sort({ ten_nhan_vien: 1 }).lean(),
        DoiTacGiaoHang.find({ ...storeFilter, trang_thai: 'active' }).select('ma_doi_tac ten_doi_tac sdt').sort({ ten_doi_tac: 1 }).lean()
    ]);
    return { employees, carriers };
}

function isCustomerReturnDocCode(code) {
    return /^TH(?!N)/i.test(String(code || '').trim());
}

function relatedCode(item) {
    const firstAlloc = Array.isArray(item.allocations) ? item.allocations[0] : null;
    const allocPn = firstAlloc?.phieu_nhap_id;
    return item.don_hang_id?.ma_don_hang
        || item.hoa_don_id?.ma_hoa_don
        || item.phieu_nhap_id?.ma_phieu_nhap
        || firstAlloc?.ma_phieu_nhap
        || (allocPn && typeof allocPn === 'object' ? allocPn.ma_phieu_nhap : '')
        || item.phieu_tra_hang_nhap_id?.ma_phieu_tra_nhap
        || item.phieu_tra_hang_id?.ma_phieu_tra
        || item.van_don_id?.ma_van_don
        || item.chamcongmoi_bang_luong_id?.ma_bang_luong
        || item.bang_luong_id?.ma_bang_luong
        || item.ct_bang_luong_id?.ma_nhan_vien
        || item.nhap_vat_chua_id?.ma_nhap_vat_chua
        || item.ma_chung_tu_goc
        || '';
}

function hasReceiptDocRef(item) {
    if (!item) return false;
    if (item.hoa_don_id || item.don_hang_id || item.phieu_nhap_id) return true;
    if (item.phieu_tra_hang_id || item.phieu_tra_hang_nhap_id || item.van_don_id) return true;
    if (item.chamcongmoi_bang_luong_id || item.bang_luong_id || item.ct_bang_luong_id) return true;
    if (item.nhap_vat_chua_id) return true;
    if (Array.isArray(item.allocations) && item.allocations.length) return true;
    return !!(item._docLinkType && item._docLinkId);
}

async function attachMissingDocRefs(receipt) {
    if (!receipt || hasReceiptDocRef(receipt)) return receipt;
    const code = String(receipt.ma_chung_tu_goc || '').trim();
    if (!code) return receipt;
    if (/^HD/i.test(code) && !receipt.hoa_don_id) {
        const row = await HoaDonBanHang.findOne({ ma_hoa_don: code })
            .select('ma_hoa_don ngay_ban tong_tien thanh_toan trang_thai khach_hang_id')
            .populate({ path: 'khach_hang_id', select: 'ten_khach_hang ma_khach_hang' })
            .lean();
        if (row) receipt.hoa_don_id = row;
    } else if (/^PN/i.test(code) && !receipt.phieu_nhap_id) {
        const row = await PhieuNhap.findOne({ ma_phieu_nhap: code, deleted_at: null })
            .select('ma_phieu_nhap ngay_nhap tong_tien can_tra_ncc da_tra_ncc con_no_ncc trang_thai nha_cung_cap_id')
            .populate({ path: 'nha_cung_cap_id', select: 'ten_ncc ma_ncc' })
            .lean();
        if (row) receipt.phieu_nhap_id = row;
    } else if (/^DH/i.test(code) && !receipt.don_hang_id) {
        const row = await DonHang.findOne({ ma_don_hang: code })
            .select('ma_don_hang ngay_dat tong_tien tong_thanh_toan khach_can_tra khach_thanh_toan trang_thai khach_hang_id')
            .populate({ path: 'khach_hang_id', select: 'ten_khach_hang ma_khach_hang' })
            .lean();
        if (row) receipt.don_hang_id = row;
    } else if (/^NVC/i.test(code) && !receipt.nhap_vat_chua_id) {
        const row = await NhapVatChua.findOne({ ma_nhap_vat_chua: code })
            .select('ma_nhap_vat_chua tong_tien created_at doi_tuong_ten trang_thai')
            .lean();
        if (row) receipt.nhap_vat_chua_id = row;
    } else if (isCustomerReturnDocCode(code) && !receipt.phieu_tra_hang_id) {
        const row = await PhieuTraHang.findOne({ ma_phieu_tra: code, deleted_at: null })
            .select('ma_phieu_tra ngay_tra tong_tien_tra can_tra_khach trang_thai khach_hang_id')
            .populate({ path: 'khach_hang_id', select: 'ten_khach_hang ma_khach_hang' })
            .lean();
        if (row) receipt.phieu_tra_hang_id = row;
    } else if (/^BL/i.test(code) && !receipt.chamcongmoi_bang_luong_id) {
        const row = await ChamCongMoiBangLuong.findOne({ ma_bang_luong: code })
            .select('ma_bang_luong ma_nhan_vien ten_nhan_vien thang_bang_luong tong_tien trang_thai created_at nhan_vien_id')
            .lean();
        if (row) receipt.chamcongmoi_bang_luong_id = row;
    }
    return receipt;
}

async function enrichReceiptListDocRefs(list) {
    if (!Array.isArray(list) || !list.length) return list;
    const invoiceCodes = [];
    const purchaseCodes = [];
    const supplierReturnCodes = [];
    const customerReturnCodes = [];
    const orderCodes = [];
    const nhapVatChuaCodes = [];
    const chamcongPayrollCodes = [];
    list.forEach(item => {
        if (hasReceiptDocRef(item)) return;
        const code = String(item.ma_chung_tu_goc || '').trim();
        if (!code) return;
        if (/^HD/i.test(code)) invoiceCodes.push(code);
        else if (/^PN/i.test(code)) purchaseCodes.push(code);
        else if (/^THN/i.test(code)) supplierReturnCodes.push(code);
        else if (isCustomerReturnDocCode(code)) customerReturnCodes.push(code);
        else if (/^DH/i.test(code)) orderCodes.push(code);
        else if (/^NVC/i.test(code)) nhapVatChuaCodes.push(code);
        else if (/^BL/i.test(code)) chamcongPayrollCodes.push(code);
    });
    const unique = arr => [...new Set(arr.filter(Boolean))];
    const [invoices, purchases, supplierReturns, customerReturns, orders, nhapVatChuas, chamcongPayrolls] = await Promise.all([
        unique(invoiceCodes).length
            ? HoaDonBanHang.find({ ma_hoa_don: { $in: unique(invoiceCodes) } }).select('_id ma_hoa_don').lean()
            : [],
        unique(purchaseCodes).length
            ? PhieuNhap.find({ ma_phieu_nhap: { $in: unique(purchaseCodes) }, deleted_at: null }).select('_id ma_phieu_nhap').lean()
            : [],
        unique(supplierReturnCodes).length
            ? PhieuTraHangNhap.find({ ma_phieu_tra_nhap: { $in: unique(supplierReturnCodes) }, deleted_at: null, trang_thai: { $ne: 'cancelled' } }).select('_id ma_phieu_tra_nhap').lean()
            : [],
        unique(customerReturnCodes).length
            ? PhieuTraHang.find({ ma_phieu_tra: { $in: unique(customerReturnCodes) }, deleted_at: null }).select('_id ma_phieu_tra').lean()
            : [],
        unique(orderCodes).length
            ? DonHang.find({ ma_don_hang: { $in: unique(orderCodes) } }).select('_id ma_don_hang').lean()
            : [],
        unique(nhapVatChuaCodes).length
            ? NhapVatChua.find({ ma_nhap_vat_chua: { $in: unique(nhapVatChuaCodes) } }).select('_id ma_nhap_vat_chua').lean()
            : [],
        unique(chamcongPayrollCodes).length
            ? ChamCongMoiBangLuong.find({ ma_bang_luong: { $in: unique(chamcongPayrollCodes) } }).select('_id ma_bang_luong').lean()
            : []
    ]);
    const invoiceByCode = new Map(invoices.map(row => [row.ma_hoa_don, row._id]));
    const purchaseByCode = new Map(purchases.map(row => [row.ma_phieu_nhap, row._id]));
    const supplierReturnByCode = new Map(supplierReturns.map(row => [row.ma_phieu_tra_nhap, row._id]));
    const customerReturnByCode = new Map(customerReturns.map(row => [row.ma_phieu_tra, row._id]));
    const orderByCode = new Map(orders.map(row => [row.ma_don_hang, row._id]));
    const nhapVatChuaByCode = new Map(nhapVatChuas.map(row => [row.ma_nhap_vat_chua, row._id]));
    const chamcongPayrollByCode = new Map(chamcongPayrolls.map(row => [row.ma_bang_luong, row._id]));
    list.forEach(item => {
        if (hasReceiptDocRef(item)) return;
        const code = String(item.ma_chung_tu_goc || '').trim();
        if (invoiceByCode.has(code)) {
            item._docLinkType = 'invoice';
            item._docLinkId = invoiceByCode.get(code);
        } else if (purchaseByCode.has(code)) {
            item._docLinkType = 'purchase';
            item._docLinkId = purchaseByCode.get(code);
        } else if (supplierReturnByCode.has(code)) {
            item._docLinkType = 'supplier_return';
            item._docLinkId = supplierReturnByCode.get(code);
        } else if (customerReturnByCode.has(code)) {
            item._docLinkType = 'customer_return';
            item._docLinkId = customerReturnByCode.get(code);
        } else if (orderByCode.has(code)) {
            item._docLinkType = 'order';
            item._docLinkId = orderByCode.get(code);
        } else if (nhapVatChuaByCode.has(code)) {
            item._docLinkType = 'nhap_vat_chua';
            item._docLinkId = nhapVatChuaByCode.get(code);
        } else if (chamcongPayrollByCode.has(code)) {
            item._docLinkType = 'chamcong_payroll';
            item._docLinkId = chamcongPayrollByCode.get(code);
        }
    });
    return list;
}

exports.index = async (req, res, next) => {
    try {
        const storeId = await resolveStoreId(req);
        if (!storeId) return res.status(400).send('Chưa chọn cửa hàng');
        const filter = await buildFullFilter(req.query, storeId);

        if (req.query?.nguoi_tao && req.query.nguoi_tao.trim() !== '' && !filter.nguoi_tao_id) {
            const usersByName = await NguoiDung.find({
                $or: [
                    { ho_ten: { $regex: req.query.nguoi_tao.trim(), $options: 'i' } },
                    { username: { $regex: req.query.nguoi_tao.trim(), $options: 'i' } },
                    { email: { $regex: req.query.nguoi_tao.trim(), $options: 'i' } }
                ]
            }).select('_id');
            filter.nguoi_tao_id = { $in: usersByName.map(user => user._id) };
        }
        if (req.query?.doi_tuong_phone && req.query.doi_tuong_phone.trim() !== '') {
            const phone = req.query.doi_tuong_phone.trim();
            const [phoneCustomers, phoneSuppliers] = await Promise.all([
                KhachHang.find({ sdt: { $regex: phone, $options: 'i' } }).select('_id'),
                NhaCungCap.find({ sdt: { $regex: phone, $options: 'i' } }).select('_id')
            ]);
            filter.$or = [
                { khach_hang_id: { $in: phoneCustomers.map(item => item._id) } },
                { nha_cung_cap_id: { $in: phoneSuppliers.map(item => item._id) } }
            ];
        }
        hrLog.logPayrollInfo('cashbook.page.list.start', {
            method: req.method,
            path: req.originalUrl || req.url,
            cua_hang_id: String(storeId || ''),
            so_quy_id: req.query.so_quy_id || 'all',
            q: req.query.q || '',
            nhom_doi_tuong: req.query.nhom_doi_tuong || '',
            loai_phieu: req.query.loai_phieu || '',
            loai_thu_chi: req.query.loai_thu_chi || '',
            trang_thai: req.query.trang_thai || '',
            date_from: req.query.date_from || '',
            date_to: req.query.date_to || ''
        });

        const [list, cashBooks, filterCashBooks, customers, suppliers, users, partnerLists] = await Promise.all([
            PhieuThuChi.find(filter)
                .populate('cua_hang_id')
                .populate('nguoi_tao_id')
                .populate('khach_hang_id')
                .populate('nha_cung_cap_id')
                .populate('so_quy_id')
                .populate('chi_tiet_thanh_toan.so_quy_tien_mat_id', 'ten_so_quy loai_so_quy mac_dinh thong_tin_ngan_hang trang_thai')
                .populate('chi_tiet_thanh_toan.so_quy_chuyen_khoan_id', 'ten_so_quy loai_so_quy mac_dinh thong_tin_ngan_hang trang_thai')
                .populate('don_hang_id')
                .populate('hoa_don_id')
                .populate('phieu_nhap_id')
                .populate('phieu_tra_hang_id')
                .populate('phieu_tra_hang_nhap_id')
                .populate('van_don_id')
                .populate('nhap_vat_chua_id')
                .populate('chamcongmoi_bang_luong_id', 'ma_bang_luong ma_nhan_vien ten_nhan_vien thang_bang_luong tong_tien trang_thai created_at')
                .populate('allocations.phieu_nhap_id')
                .sort({ ngay_lap: -1 }),
            SoQuy.find({ trang_thai: 'active', $or: [{ deleted_at: null }, { deleted_at: { $exists: false } }] }).sort({ ten_so_quy: 1 }),
            SoQuy.find({ $or: [{ deleted_at: null }, { deleted_at: { $exists: false } }] }).sort({ trang_thai: 1, ten_so_quy: 1 }),
            KhachHang.find({ trang_thai: { $ne: 'inactive' } }).sort({ ten_khach_hang: 1 }),
            NhaCungCap.find({ trang_thai: 'active' }).sort({ ten_ncc: 1 }),
            NguoiDung.find().sort({ ho_ten: 1, username: 1 }),
            loadPartnerLists(storeId)
        ]);
        await enrichReceiptListDocRefs(list);
        const cashBookScope = resolveCashBookFilterScope(req.query);
        const cashBookMeta = await buildCashBookMeta(cashBookScope);
        attachScopedAmounts(list, cashBookScope, cashBookMeta);
        const selectedCashBook = cashBooks.find(book => String(book._id) === String(req.query.so_quy_id || '')) || cashBooks[0] || null;

        const periodStart = getPeriodStart(req.query);
        const openingFilter = { ...filter };
        if (periodStart) openingFilter.ngay_lap = { $lt: periodStart };
        const [openingTotals, periodTotals] = await Promise.all([
            periodStart ? computeScopedTotals(openingFilter, cashBookScope, cashBookMeta) : Promise.resolve({ totalThu: 0, totalChi: 0 }),
            computeScopedTotals(filter, cashBookScope, cashBookMeta)
        ]);
        const opening = periodStart ? (openingTotals.totalThu || 0) - (openingTotals.totalChi || 0) : 0;
        const totalThu = periodTotals.totalThu || 0;
        const totalChi = periodTotals.totalChi || 0;
        const summary = {
            opening,
            totalThu,
            totalChi,
            balance: opening + totalThu - totalChi
        };

        hrLog.logPayrollInfo('cashbook.page.list.success', {
            so_quy_id: req.query.so_quy_id || 'all',
            result_count: list.length,
            nhom_doi_tuong: req.query.nhom_doi_tuong || 'all',
            loai_phieu: req.query.loai_phieu || 'all',
            q: req.query.q || ''
        });

        res.render('so-quy/index', {
            title: 'Sổ quỹ tiền mặt',
            list,
            cashBooks,
            filterCashBooks,
            customers,
            suppliers,
            users,
            employees: partnerLists.employees,
            carriers: partnerLists.carriers,
            selectedCashBook,
            summary,
            cashBookScope,
            filters: req.query || {},
            relatedCode
        });
    } catch (error) {
        hrLog.logPayrollError('cashbook.page.list.error', error, {
            path: req.originalUrl || req.url,
            query: req.query || {}
        });
        next(error);
    }
};

exports.getExportCsv = async (req, res, next) => {
    try {
        const storeId = await resolveStoreId(req);
        if (!storeId) return res.status(400).send('Chưa chọn cửa hàng');
        const cashBookScope = resolveCashBookFilterScope(req.query);
        const cashBookMeta = await buildCashBookMeta(cashBookScope);
        const list = await PhieuThuChi.find(await buildFullFilter(req.query, storeId)).populate('so_quy_id').sort({ ngay_lap: -1 });
        attachScopedAmounts(list, cashBookScope, cashBookMeta);
        const escape = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
        const rows = [
            ['ma_phieu', 'thoi_gian', 'loai_phieu', 'loai_thu_chi', 'doi_tuong', 'gia_tri', 'tien_mat', 'chuyen_khoan', 'so_quy', 'chung_tu_lien_quan', 'phuong_thuc_thanh_toan', 'ghi_chu'],
            ...list.map(item => {
                const displayValue = cashBookScope.mode === 'all' || cashBookScope.mode === 'unassigned'
                    ? (item.gia_tri || 0)
                    : (item._scoped_gia_tri != null ? item._scoped_gia_tri : item.gia_tri || 0);
                return [
                item.ma_phieu,
                item.ngay_lap ? item.ngay_lap.toISOString() : '',
                item.loai_phieu,
                item.loai_thu_chi || '',
                item.doi_tuong,
                displayValue,
                item.chi_tiet_thanh_toan?.tien_mat || 0,
                item.chi_tiet_thanh_toan?.chuyen_khoan || 0,
                item.so_quy_id?.ten_so_quy || '',
                item.ma_chung_tu_goc || '',
                item.phuong_thuc_thanh_toan || '',
                item.ghi_chu || ''
            ];
            })
        ];
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="so-quy.csv"');
        res.send('\uFEFF' + rows.map(row => row.map(escape).join(',')).join('\n'));
    } catch (error) {
        next(error);
    }
};

exports.getPhieuThuChiId = async function(req, res) {
    res.redirect('/so-quy?receipt=' + encodeURIComponent(req.params.id));
};

exports.getRelatedDocuments = async (req, res, next) => {
    try {
        const storeId = await resolveStoreId(req);
        if (!storeId) {
            return res.status(400).json({ success: false, message: 'Chua chon cua hang' });
        }
        const result = await listRelatedDocuments({
            cua_hang_id: storeId,
            loai_phieu: req.query.loai_phieu,
            document_type: req.query.document_type,
            nhom_doi_tuong: req.query.nhom_doi_tuong,
            doi_tuong_entity_id: req.query.doi_tuong_entity_id
        });
        return res.json({
            success: true,
            items: result.items || [],
            message: result.message || ''
        });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message || 'Khong tai duoc chung tu' });
    }
};

const RECEIPT_DETAIL_POPULATES = [
    { path: 'nguoi_tao_id', select: 'ho_ten email username' },
    { path: 'nha_cung_cap_id', select: 'ten_ncc ma_ncc' },
    { path: 'khach_hang_id', select: 'ten_khach_hang ma_khach_hang' },
    { path: 'so_quy_id', select: 'ten_so_quy ma_so_quy' },
    { path: 'chi_tiet_thanh_toan.so_quy_tien_mat_id', select: 'ten_so_quy loai_so_quy mac_dinh thong_tin_ngan_hang trang_thai' },
    { path: 'chi_tiet_thanh_toan.so_quy_chuyen_khoan_id', select: 'ten_so_quy loai_so_quy mac_dinh thong_tin_ngan_hang trang_thai' },
    { path: 'cua_hang_id', select: 'ten_cua_hang' },
    {
        path: 'hoa_don_id',
        select: 'ma_hoa_don ngay_ban tong_tien thanh_toan trang_thai khach_hang_id',
        populate: { path: 'khach_hang_id', select: 'ten_khach_hang ma_khach_hang' }
    },
    {
        path: 'don_hang_id',
        select: 'ma_don_hang ngay_dat tong_tien tong_thanh_toan khach_can_tra khach_thanh_toan trang_thai khach_hang_id',
        populate: { path: 'khach_hang_id', select: 'ten_khach_hang ma_khach_hang' }
    },
    {
        path: 'phieu_nhap_id',
        select: 'ma_phieu_nhap ngay_nhap tong_tien can_tra_ncc da_tra_ncc con_no_ncc trang_thai nha_cung_cap_id',
        populate: { path: 'nha_cung_cap_id', select: 'ten_ncc ma_ncc' }
    },
    {
        path: 'phieu_tra_hang_id',
        select: 'ma_phieu_tra ngay_tra tong_tien_tra can_tra_khach khach_can_tra_them trang_thai khach_hang_id',
        populate: { path: 'khach_hang_id', select: 'ten_khach_hang ma_khach_hang' }
    },
    {
        path: 'phieu_tra_hang_nhap_id',
        select: 'ma_phieu_tra_nhap ngay_tra tong_tien_tra ncc_can_tra ncc_da_tra trang_thai nha_cung_cap_id',
        populate: { path: 'nha_cung_cap_id', select: 'ten_ncc ma_ncc' }
    },
    {
        path: 'van_don_id',
        select: 'ma_van_don cod_amount trang_thai_cod trang_thai doi_tac_giao_hang_id khach_hang_id created_at',
        populate: [
            { path: 'doi_tac_giao_hang_id', select: 'ten_doi_tac ma_doi_tac' },
            { path: 'khach_hang_id', select: 'ten_khach_hang ma_khach_hang' }
        ]
    },
    {
        path: 'chamcongmoi_bang_luong_id',
        select: 'ma_bang_luong ma_nhan_vien ten_nhan_vien thang_bang_luong loai_luong tong_tien trang_thai created_at nhan_vien_id',
        populate: { path: 'nhan_vien_id', select: 'ma_nhan_vien ten_nhan_vien' }
    },
    {
        path: 'bang_luong_id',
        select: 'ma_bang_luong ten_bang_luong tu_ngay den_ngay tong_luong da_tra_nhan_vien con_can_tra trang_thai created_at'
    },
    {
        path: 'ct_bang_luong_id',
        select: 'ma_nhan_vien ten_nhan_vien tu_ngay den_ngay tong_luong da_tra con_can_tra trang_thai bang_luong_id nhan_vien_id',
        populate: [
            { path: 'nhan_vien_id', select: 'ma_nhan_vien ten_nhan_vien' },
            { path: 'bang_luong_id', select: 'ma_bang_luong ten_bang_luong tu_ngay den_ngay trang_thai' }
        ]
    },
    {
        path: 'nhap_vat_chua_id',
        select: 'ma_nhap_vat_chua tong_tien created_at doi_tuong_ten trang_thai items'
    },
    {
        path: 'allocations.phieu_nhap_id',
        select: 'ma_phieu_nhap ngay_nhap tong_tien can_tra_ncc da_tra_ncc con_no_ncc trang_thai nha_cung_cap_id',
        populate: { path: 'nha_cung_cap_id', select: 'ten_ncc ma_ncc' }
    }
];

exports.getIdDetail = async (req, res, next) => {
    try {
        if (!isObjectId(req.params.id)) return res.status(400).json({ success: false, message: 'id khong hop le' });
        let query = PhieuThuChi.findById(req.params.id);
        RECEIPT_DETAIL_POPULATES.forEach(spec => {
            query = query.populate(spec);
        });
        const receipt = await query.lean();
        if (!receipt) return res.status(404).json({ success: false, message: 'Không tìm thấy phiếu thu chi' });
        await attachMissingDocRefs(receipt);
        const phieuNhapRef = receipt.phieu_nhap_id;
        const phieuNhapId = phieuNhapRef && (phieuNhapRef._id || phieuNhapRef);
        const items = phieuNhapId
            ? await CTPhieuNhap.find({ phieu_nhap_id: phieuNhapId })
                .populate({ path: 'hang_hoa_id', select: 'ma_hang ten_hang' })
                .lean()
            : [];
        return res.json({ success: true, data: { receipt, items } });
    } catch (error) {
        next(error);
    }
};

exports.postAdd = async (req, res, next) => {
    try {
        const storeId = await resolveStoreId(req);
        if (!storeId) return res.status(400).json({ success: false, message: 'Chưa chọn cửa hàng' });

        const body = req.body || {};
        const paymentV2 = hasV2PaymentPayload(body, { includeNestedAmounts: true });
        const receiptInput = Object.assign({}, body, {
            cua_hang_id: storeId,
            payment_v2: paymentV2
        });
        const paymentInfo = await buildReceiptPaymentInfo(receiptInput, {
            cuaHangId: storeId,
            chiNhanhId: body.chi_nhanh_id
        });
        await validateReceiptDocumentAmount({
            cua_hang_id: storeId,
            loai_phieu: body.loai_phieu,
            document_type: body.document_type,
            gia_tri: paymentInfo.gia_tri,
            don_hang_id: body.don_hang_id,
            hoa_don_id: body.hoa_don_id,
            phieu_nhap_id: body.phieu_nhap_id,
            phieu_tra_hang_nhap_id: body.phieu_tra_hang_nhap_id,
            phieu_tra_hang_id: body.phieu_tra_hang_id,
            van_don_id: body.van_don_id,
            bang_luong_id: body.bang_luong_id,
            ct_bang_luong_id: body.ct_bang_luong_id
        });
        const receipt = await taoPhieuThuChi({
            cua_hang_id: storeId,
            loai_phieu: body.loai_phieu,
            loai_thu_chi: body.loai_thu_chi,
            gia_tri: paymentInfo.gia_tri,
            ngay_lap: body.ngay_lap,
            so_quy_id: body.so_quy_id,
            chi_tiet_thanh_toan: body.chi_tiet_thanh_toan,
            so_quy_tien_mat_id: body.so_quy_tien_mat_id,
            so_quy_chuyen_khoan_id: body.so_quy_chuyen_khoan_id,
            tien_mat: body.tien_mat,
            chuyen_khoan: body.chuyen_khoan,
            tien_tra_khach: body.tien_tra_khach,
            payment_v2: paymentV2,
            _paymentInfo: paymentInfo,
            nhom_doi_tuong: body.nhom_doi_tuong,
            doi_tuong_entity_id: body.doi_tuong_entity_id,
            doi_tuong: body.doi_tuong,
            document_type: body.document_type,
            don_hang_id: body.don_hang_id,
            hoa_don_id: body.hoa_don_id,
            phieu_nhap_id: body.phieu_nhap_id,
            phieu_tra_hang_nhap_id: body.phieu_tra_hang_nhap_id,
            phieu_tra_hang_id: body.phieu_tra_hang_id,
            van_don_id: body.van_don_id,
            bang_luong_id: body.bang_luong_id,
            ct_bang_luong_id: body.ct_bang_luong_id,
            ma_chung_tu_goc: body.ma_chung_tu_goc,
            ma_phieu: body.ma_phieu,
            ghi_chu: body.ghi_chu,
            nguoi_tao_id: req.user?._id,
            hach_toan: body.hach_toan
        });
        res.json({ success: true, message: `Da tao phieu ${receipt.loai_phieu}`, data: receipt });
    } catch (error) {
        return res.status(400).json({ success: false, message: receiptErrorMessage(error) });
    }
};
