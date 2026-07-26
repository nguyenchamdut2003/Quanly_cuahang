const path = require('path');
const pdfService = require('../services/pdf.service');
const report58Excel = require('../services/report58Excel.service');
const report58Data = require('../services/report58Data.service');
const report58Pdf = require('../services/report58Pdf.service');
const {
    buildProfitByLotReport,
    buildProfitByCustomerReport,
    buildProfitBySupplierReport
} = require('../services/profitReport.service');
const {
    DonHang,
    CTDonHang,
    HoaDonBanHang,
    CTHoaDonBanHang,
    PhieuTraHang,
    PhieuThuChi,
    KhachHang,
    NguoiDung,
    NhaCungCap,
    PhieuNhap,
    PhieuTraHangNhap,
    CuaHang,
    Kho,
    HangHoa,
    TonKhoLo
} = require('../models/kiot.model');

exports.index = async (req, res, next) => {
    try {
        res.redirect('/bao-cao/cuoi-ngay');
    } catch (error) {
        next(error);
    }
};

function getDayRange(value) {
    const date = value ? new Date(`${value}T00:00:00`) : new Date();
    if (Number.isNaN(date.getTime())) {
        const now = new Date();
        const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        return {
            day,
            start: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
            end: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
        };
    }
    const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    return {
        day,
        start: new Date(date.getFullYear(), date.getMonth(), date.getDate()),
        end: new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1)
    };
}

function formatDateInput(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatDisplayDate(date) {
    return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
}

/** Tránh lỗi khi form gửi trùng from/to (sidebar + thanh bar) → Express nhận mảng. */
function pickQueryParam(value) {
    if (value == null || value === '') return '';
    if (Array.isArray(value)) {
        const parts = value
            .map(item => String(item ?? '').trim())
            .filter(Boolean);
        return parts.length ? parts[parts.length - 1] : '';
    }
    return String(value).trim();
}

/** Gộp query khi form gửi trùng tên field (sidebar + thanh bar). */
function normalizeReport58Query(query = {}) {
    return {
        ...query,
        mau: pickQueryParam(query.mau),
        view: pickQueryParam(query.view),
        from: pickQueryParam(query.from),
        to: pickQueryParam(query.to),
        phieu_id: pickQueryParam(query.phieu_id),
        phieu_nhap_id: pickQueryParam(query.phieu_nhap_id),
        xuat_ref: pickQueryParam(query.xuat_ref),
        hang_hoa_id: pickQueryParam(query.hang_hoa_id),
        kho_id: pickQueryParam(query.kho_id),
        so_quy_id: pickQueryParam(query.so_quy_id),
        year: pickQueryParam(query.year),
        don_vi_tinh: pickQueryParam(query.don_vi_tinh)
    };
}

function getSalesRange(query = {}) {
    const fromStr = pickQueryParam(query.from);
    const toStr = pickQueryParam(query.to);
    const today = toStr ? new Date(`${toStr}T00:00:00`) : new Date();
    const endBase = Number.isNaN(today.getTime()) ? new Date() : today;
    let start;
    let end;

    if (fromStr && toStr) {
        start = new Date(`${fromStr}T00:00:00`);
        end = new Date(`${toStr}T00:00:00`);
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
            return getSalesRange({});
        }
        end = new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1);
    } else {
        end = new Date(endBase.getFullYear(), endBase.getMonth(), endBase.getDate() + 1);
        start = new Date(end);
        start.setDate(start.getDate() - 6);
    }

    const days = [];
    for (let cursor = new Date(start); cursor < end; cursor.setDate(cursor.getDate() + 1)) {
        days.push(new Date(cursor));
    }

    return {
        start,
        end,
        from: formatDateInput(start),
        to: formatDateInput(new Date(end.getFullYear(), end.getMonth(), end.getDate() - 1)),
        days
    };
}

async function buildSalesReport(query = {}) {
    const range = getSalesRange(query);
    const invoiceFilter = { ngay_ban: { $gte: range.start, $lt: range.end } };
    if (query.payment) invoiceFilter.phuong_thuc_tt = query.payment;

    const [invoices, returns] = await Promise.all([
        HoaDonBanHang.find(invoiceFilter).sort({ ngay_ban: 1 }),
        PhieuTraHang.find({ ngay_tra: { $gte: range.start, $lt: range.end } }).sort({ ngay_tra: 1 })
    ]);

    const rows = range.days.map(date => {
        const key = formatDateInput(date);
        const dayInvoices = invoices.filter(item => formatDateInput(new Date(item.ngay_ban)) === key);
        const dayReturns = returns.filter(item => formatDateInput(new Date(item.ngay_tra)) === key);
        const revenue = dayInvoices.reduce((sum, item) => sum + Number(item.thanh_toan || item.tong_tien || 0), 0);
        const returned = dayReturns.reduce((sum, item) => sum + Number(item.tong_tien_tra || 0), 0);
        return {
            key,
            label: formatDisplayDate(date),
            shortLabel: `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}`,
            invoiceCount: dayInvoices.length,
            returnCount: dayReturns.length,
            revenue,
            returned,
            netRevenue: revenue - returned
        };
    }).reverse();

    const chartRows = [...rows].reverse();
    const totals = rows.reduce((acc, row) => {
        acc.invoiceCount += row.invoiceCount;
        acc.returnCount += row.returnCount;
        acc.revenue += row.revenue;
        acc.returned += row.returned;
        acc.netRevenue += row.netRevenue;
        return acc;
    }, { invoiceCount: 0, returnCount: 0, revenue: 0, returned: 0, netRevenue: 0 });

    return {
        generatedAt: new Date(),
        branchName: 'Cửa hàng trung tâm',
        range,
        rows,
        chartRows,
        totals,
        filters: query,
        viewMode: query.view === 'report' ? 'report' : 'chart'
    };
}

async function buildOrderReport(query = {}) {
    const range = getSalesRange(query);
    const orderFilter = {
        $or: [
            { ngay_dat: { $gte: range.start, $lt: range.end } },
            { ngay_tao: { $gte: range.start, $lt: range.end } }
        ]
    };

    if (query.status) orderFilter.trang_thai = query.status;
    if (query.creator?.trim()) {
        const creatorSearch = query.creator.trim();
        const creators = await NguoiDung.find({
            $or: [
                { ho_ten: { $regex: creatorSearch, $options: 'i' } },
                { email: { $regex: creatorSearch, $options: 'i' } },
                { sdt: { $regex: creatorSearch, $options: 'i' } }
            ]
        }).select('_id');
        orderFilter.nguoi_tao_id = { $in: creators.map(item => item._id) };
    }

    if (query.customer?.trim()) {
        const customerSearch = query.customer.trim();
        const customers = await KhachHang.find({
            $or: [
                { ma_khach_hang: { $regex: customerSearch, $options: 'i' } },
                { ten_khach_hang: { $regex: customerSearch, $options: 'i' } },
                { sdt: { $regex: customerSearch, $options: 'i' } }
            ]
        }).select('_id');
        orderFilter.khach_hang_id = { $in: customers.map(item => item._id) };
    }

    const orders = await DonHang.find(orderFilter)
        .populate('khach_hang_id')
        .populate('nguoi_tao_id')
        .sort({ ngay_dat: 1, ngay_tao: 1 });

    const orderIds = orders.map(item => item._id);
    let items = orderIds.length
        ? await CTDonHang.find({ don_hang_id: { $in: orderIds } }).populate('hang_hoa_id')
        : [];

    if (query.product?.trim()) {
        const productSearch = query.product.trim().toLowerCase();
        items = items.filter(item => {
            const product = item.hang_hoa_id || {};
            return String(product.ma_hang || '').toLowerCase().includes(productSearch)
                || String(product.ten_hang || '').toLowerCase().includes(productSearch);
        });
    }

    if (query.item_type?.trim()) {
        items = items.filter(item => String(item.hang_hoa_id?.loai_hang || '').toLowerCase().includes(query.item_type.trim().toLowerCase()));
    }

    const productMap = new Map();
    items.forEach(item => {
        const product = item.hang_hoa_id || {};
        const key = String(product._id || item.hang_hoa_id || item._id);
        const current = productMap.get(key) || {
            productId: key,
            code: product.ma_hang || '',
            name: product.ten_hang || 'Không xác định',
            quantity: 0,
            value: 0,
            orderCount: new Set()
        };
        current.quantity += Number(item.so_luong || 0);
        current.value += Number(item.thanh_tien || (Number(item.so_luong || 0) * Number(item.don_gia_ban || 0)));
        current.orderCount.add(String(item.don_hang_id));
        productMap.set(key, current);
    });

    const productRows = Array.from(productMap.values())
        .map(item => ({
            ...item,
            orderCount: item.orderCount.size
        }))
        .sort((a, b) => b.quantity - a.quantity || b.value - a.value);

    const topProducts = productRows.slice(0, 10);
    const totals = productRows.reduce((acc, row) => {
        acc.quantity += row.quantity;
        acc.value += row.value;
        acc.productCount += 1;
        return acc;
    }, { quantity: 0, value: 0, productCount: 0, orderCount: orders.length });

    return {
        generatedAt: new Date(),
        branchName: 'Cửa hàng trung tâm',
        range,
        orders,
        productRows,
        topProducts,
        totals,
        filters: query,
        viewMode: query.view === 'report' ? 'report' : 'chart'
    };
}

async function buildCustomerReport(query = {}) {
    if (query.focus === 'loi-nhuan') {
        const range = getSalesRange(query);
        return buildProfitByCustomerReport(Object.assign({}, query, { range }));
    }
    const range = getSalesRange(query);
    const customerSearch = query.customer?.trim();
    const customerFilter = {};

    if (customerSearch) {
        customerFilter.$or = [
            { ma_khach_hang: { $regex: customerSearch, $options: 'i' } },
            { ten_khach_hang: { $regex: customerSearch, $options: 'i' } },
            { sdt: { $regex: customerSearch, $options: 'i' } }
        ];
    }

    const customers = await KhachHang.find(customerFilter).sort({ ma_khach_hang: 1 });
    const customerIds = customers.map(item => item._id);
    const invoiceFilter = {
        ngay_ban: { $gte: range.start, $lt: range.end },
        khach_hang_id: { $in: customerIds }
    };
    const returnFilter = {
        ngay_tra: { $gte: range.start, $lt: range.end },
        khach_hang_id: { $in: customerIds }
    };

    const [invoices, returns] = await Promise.all([
        HoaDonBanHang.find(invoiceFilter),
        PhieuTraHang.find(returnFilter)
    ]);

    const invoiceMap = new Map();
    invoices.forEach(item => {
        const key = String(item.khach_hang_id || '');
        const current = invoiceMap.get(key) || { revenue: 0, invoiceCount: 0 };
        current.revenue += Number(item.thanh_toan || item.tong_tien || 0);
        current.invoiceCount += 1;
        invoiceMap.set(key, current);
    });

    const returnMap = new Map();
    returns.forEach(item => {
        const key = String(item.khach_hang_id || '');
        const current = returnMap.get(key) || { returned: 0, returnCount: 0 };
        current.returned += Number(item.tong_tien_tra || 0);
        current.returnCount += 1;
        returnMap.set(key, current);
    });

    const rows = customers.map(customer => {
        const key = String(customer._id);
        const sale = invoiceMap.get(key) || {};
        const ret = returnMap.get(key) || {};
        const revenue = sale.revenue || 0;
        const returned = ret.returned || 0;
        return {
            id: key,
            code: customer.ma_khach_hang || '',
            name: customer.ten_khach_hang || '',
            phone: customer.sdt || '',
            revenue,
            returned,
            netRevenue: revenue - returned,
            invoiceCount: sale.invoiceCount || 0,
            returnCount: ret.returnCount || 0
        };
    }).sort((a, b) => b.netRevenue - a.netRevenue || a.code.localeCompare(b.code));

    const totals = rows.reduce((acc, row) => {
        acc.customerCount += 1;
        acc.revenue += row.revenue;
        acc.returned += row.returned;
        acc.netRevenue += row.netRevenue;
        acc.invoiceCount += row.invoiceCount;
        acc.returnCount += row.returnCount;
        return acc;
    }, { customerCount: 0, revenue: 0, returned: 0, netRevenue: 0, invoiceCount: 0, returnCount: 0 });

    return {
        generatedAt: new Date(),
        branchName: 'Cửa hàng trung tâm',
        range,
        rows,
        topCustomers: rows.slice(0, 10),
        totals,
        filters: query,
        viewMode: query.view === 'report' ? 'report' : 'chart',
        focus: query.focus || 'ban-hang'
    };
}

async function buildSupplierReport(query = {}) {
    if (query.focus === 'loi-nhuan') {
        const range = getSalesRange(query);
        return buildProfitBySupplierReport(Object.assign({}, query, { range }));
    }
    const range = getSalesRange(query);
    const supplierSearch = query.supplier?.trim();
    const supplierFilter = {};

    if (supplierSearch) {
        supplierFilter.$or = [
            { ma_ncc: { $regex: supplierSearch, $options: 'i' } },
            { ten_ncc: { $regex: supplierSearch, $options: 'i' } },
            { sdt: { $regex: supplierSearch, $options: 'i' } }
        ];
    }

    const suppliers = await NhaCungCap.find(supplierFilter).sort({ ma_ncc: 1 });
    const supplierIds = suppliers.map(item => item._id);
    const purchaseFilter = {
        ngay_nhap: { $gte: range.start, $lt: range.end },
        nha_cung_cap_id: { $in: supplierIds }
    };
    const returnFilter = {
        ngay_tra: { $gte: range.start, $lt: range.end },
        nha_cung_cap_id: { $in: supplierIds }
    };
    if (query.status) purchaseFilter.trang_thai = query.status;

    const [purchases, returns] = await Promise.all([
        PhieuNhap.find(purchaseFilter),
        PhieuTraHangNhap.find(returnFilter)
    ]);

    const purchaseMap = new Map();
    purchases.forEach(item => {
        const key = String(item.nha_cung_cap_id || '');
        const current = purchaseMap.get(key) || { value: 0, count: 0 };
        current.value += Number(item.tong_tien || 0);
        current.count += 1;
        purchaseMap.set(key, current);
    });

    const returnMap = new Map();
    returns.forEach(item => {
        const key = String(item.nha_cung_cap_id || '');
        const current = returnMap.get(key) || { value: 0, count: 0 };
        current.value += Number(item.tong_tien_tra || 0);
        current.count += 1;
        returnMap.set(key, current);
    });

    const rows = suppliers.map(supplier => {
        const key = String(supplier._id);
        const purchase = purchaseMap.get(key) || {};
        const returned = returnMap.get(key) || {};
        const importValue = purchase.value || 0;
        const returnValue = returned.value || 0;
        return {
            id: key,
            code: supplier.ma_ncc || '',
            name: supplier.ten_ncc || '',
            phone: supplier.sdt || '',
            importValue,
            returnValue,
            netValue: importValue - returnValue,
            purchaseCount: purchase.count || 0,
            returnCount: returned.count || 0
        };
    }).sort((a, b) => b.netValue - a.netValue || a.code.localeCompare(b.code));

    const totals = rows.reduce((acc, row) => {
        acc.supplierCount += 1;
        acc.importValue += row.importValue;
        acc.returnValue += row.returnValue;
        acc.netValue += row.netValue;
        acc.purchaseCount += row.purchaseCount;
        acc.returnCount += row.returnCount;
        return acc;
    }, { supplierCount: 0, importValue: 0, returnValue: 0, netValue: 0, purchaseCount: 0, returnCount: 0 });

    return {
        generatedAt: new Date(),
        branchName: 'Cửa hàng trung tâm',
        range,
        rows,
        topSuppliers: rows.slice(0, 10),
        totals,
        filters: query,
        viewMode: query.view === 'report' ? 'report' : 'chart',
        focus: query.focus || 'nhap-hang'
    };
}

const reportTitles = {
    'cuoi-ngay': 'Báo cáo cuối ngày',
    'ban-hang': 'Báo cáo bán hàng',
    'dat-hang': 'Báo cáo đặt hàng',
    'hang-hoa': 'Báo cáo hàng hóa',
    'khach-hang': 'Báo cáo khách hàng',
    'nha-cung-cap': 'Báo cáo nhà cung cấp',
    'ton-kho-lo': 'Báo cáo tồn kho theo lô',
    'loi-nhuan-lo': 'Báo cáo lợi nhuận theo lô hàng',
    '58': 'Báo cáo 58'
};

async function buildLotProfitAggregateReport(query = {}, store) {
    const range = getSalesRange(query);
    const storeId = query.cua_hang_id || (store && store._id ? String(store._id) : '');
    return buildProfitByLotReport(Object.assign({}, query, {
        range,
        cua_hang_id: storeId
    }));
}

const REPORT_58_MAU = report58Excel.REPORT_58_MAU;

function resolveReport58Mau(value) {
    const mau = String(value || '').trim();
    return REPORT_58_MAU.includes(mau) ? mau : REPORT_58_MAU[0];
}

function buildReport58ViewData(query = {}, extras = {}) {
    const range = getSalesRange(query);
    const mau = resolveReport58Mau(query.mau);
    const store = extras.store || null;
    const year = query.year || (range.to ? String(range.to).slice(0, 4) : String(new Date().getFullYear()));
    return {
        title: reportTitles['58'],
        heading: reportTitles['58'],
        reportType: '58',
        range,
        mau,
        mauList: REPORT_58_MAU,
        generatedAt: new Date(),
        store,
        storeName: store?.ten_cua_hang || '',
        storeAddress: store?.dia_chi_day_du || [
            store?.dia_chi_chi_tiet,
            store?.phuong_xa,
            store?.tinh_thanh
        ].filter(Boolean).join(', '),
        year,
        donViTinh: query.don_vi_tinh || 'Đồng',
        s2aData: extras.s2aData || {},
        s2cData: extras.s2cData || {},
        s2dFilters: extras.s2dFilters || {},
        voucherFilters: extras.voucherFilters || {}
    };
}

async function buildInvoiceLedgerViewData(query = {}, store = null) {
    const range = getSalesRange(query);
    const rows = await report58Excel.fetchInvoiceLedgerRows({ range }, store);
    const detailRows = rows.map(row => ({
        so_hieu: row.so_chung_tu,
        ngay_thang: row.ngay ? new Date(row.ngay).toLocaleDateString('vi-VN') : '',
        dien_giai: row.dien_giai,
        so_tien: Number(row.tong_thanh_toan || 0),
        doanh_thu: Number(row.doanh_thu || 0),
        thue_gtgt: Number(row.thue_gtgt || 0),
        ghi_chu: row.ghi_chu || ''
    }));
    const totals = report58Excel.sumLedgerRows(rows);
    return {
        detailRows,
        ledgerRows: rows,
        totals,
        tongCong1: totals.tong_thanh_toan
    };
}

async function enrichReport58Data(query = {}, store = null) {
    const normalizedQuery = normalizeReport58Query(query);
    const base = buildReport58ViewData(normalizedQuery, { store });
    base.sheetMeta = await report58Excel.getMauSheetMeta(base.mau);
    if (base.mau === report58Excel.S2A_DNSN_MAU) {
        base.s2aData = await report58Excel.buildS2aDnsnData(normalizedQuery, store, base.range);
    } else if (base.mau === report58Excel.S2C_DNSN_MAU) {
        base.s2cData = await report58Excel.buildS2cDnsnData(normalizedQuery, store, base.range);
    } else if (report58Excel.INVOICE_LEDGER_MAU.has(base.mau)) {
        base.ledgerData = await buildInvoiceLedgerViewData(normalizedQuery, store);
    }
    if (base.mau === 'S2d-DNSN') {
        base.s2dFilters = await report58Data.loadS2dFilterOptions(store);
    }
    if (base.mau === '01-TT' || base.mau === '02-TT') {
        base.voucherFilters = await report58Data.loadVoucherFilterOptions(store);
    }
    if (base.mau === '01-VT') {
        base.purchaseFilters = { purchases: await report58Pdf.loadPurchaseVoucherOptions(store) };
    }
    if (base.mau === '02-VT') {
        base.exportFilters = { options: await report58Pdf.loadExportVoucherOptions(store) };
    }
    return base;
}

/**
 * Render PDF Báo cáo 58 qua report58Pdf.service (nguồn dữ liệu chuẩn hóa từng mẫu).
 * Excel/CSV vẫn dùng report58Excel.service — không đổi.
 */
async function buildReport58PdfBuffer(query = {}, store = null) {
    const normalizedQuery = normalizeReport58Query(query);
    const mau = resolveReport58Mau(normalizedQuery.mau);
    const range = getSalesRange(normalizedQuery);
    const pdfView = await report58Pdf.buildReport58PdfData({ mau, query: normalizedQuery, store, range });
    const viewPath = path.join(
        __dirname,
        '..',
        'views',
        'bao-cao',
        'mau',
        pdfView.view
    );
    const html = await pdfService.renderViewToHtml(viewPath, pdfView.locals);
    const buffer = await pdfService.generatePdfFromHtml(html, {
        format: 'A4',
        landscape: pdfView.landscape === true,
        printBackground: true,
        margin: pdfView.landscape
            ? { top: '10mm', right: '8mm', bottom: '10mm', left: '10mm' }
            : { top: '12mm', right: '12mm', bottom: '12mm', left: '14mm' }
    });
    return { buffer, mau };
}

async function buildLotStockReport(query = {}) {
    const filter = {};
    if (query.cua_hang_id) filter.cua_hang_id = query.cua_hang_id;
    if (query.kho_id) filter.kho_id = query.kho_id;
    if (query.hang_hoa_id) filter.hang_hoa_id = query.hang_hoa_id;

    const [rows, stores, warehouses, products] = await Promise.all([
        TonKhoLo.find(filter)
            .populate('hang_hoa_id')
            .populate('kho_id')
            .populate('lo_hang_id')
            .sort({ updated_at: -1 })
            .lean(),
        CuaHang.find().sort({ ten_cua_hang: 1 }).lean(),
        Kho.find({ trang_thai: 'active' }).sort({ ten_kho: 1 }).lean(),
        HangHoa.find({ trang_thai: 'active' }).sort({ ten_hang: 1 }).lean()
    ]);

    const reportRows = rows.map(row => {
        const product = row.hang_hoa_id || {};
        const lot = row.lo_hang_id || {};
        const quantity = Number(row.so_luong || row.so_luong_con_lai || 0);
        const cost = Number(row.gia_von || product.gia_von || 0);
        return {
            hang_hoa_id: product._id || row.hang_hoa_id,
            kho_id: row.kho_id?._id || row.kho_id,
            lo_hang_id: lot._id || row.lo_hang_id,
            ma_hang: product.ma_hang || '',
            ten_hang: product.ten_hang || '',
            kho: row.kho_id?.ten_kho || '',
            ma_lo: lot.ten_lo || lot.ma_lo || '',
            ngay_nhap: lot.ngay_nhap || row.created_at,
            han_su_dung: lot.han_su_dung,
            so_luong: quantity,
            gia_von: cost,
            tong_gia_tri: quantity * cost
        };
    });

    return {
        rows: reportRows,
        stores,
        warehouses,
        products,
        filters: query,
        totals: {
            quantity: reportRows.reduce((sum, row) => sum + row.so_luong, 0),
            value: reportRows.reduce((sum, row) => sum + row.tong_gia_tri, 0)
        }
    };
}

exports.getData = async (req, res, next) => {
    try {
        const { type } = req.query; // day, week, month
        let groupBy = {};
        let format = "";

        if (type === 'day') {
            groupBy = { $dateToString: { format: "%d-%m", date: { $ifNull: ["$ngay_dat", "$ngay_tao"] } } };
            format = "DD-MM";
        } else if (type === 'week') {
            groupBy = { $week: { $ifNull: ["$ngay_dat", "$ngay_tao"] } };
        } else {
            groupBy = { $dateToString: { format: "%m-%Y", date: { $ifNull: ["$ngay_dat", "$ngay_tao"] } } };
            format = "MM-YYYY";
        }

        const data = await DonHang.aggregate([
            {
                $group: {
                    _id: groupBy,
                    totalRevenue: { $sum: { $ifNull: ["$tong_tien", "$tong_thanh_toan"] } },
                    orderCount: { $sum: 1 }
                }
            },
            { $sort: { _id: 1 } },
            { $limit: 10 }
        ]);

        res.json({ success: true, data });
    } catch (error) {
        next(error);
    }
};

async function buildEndOfDayReport(query = {}) {
    const { day, start, end } = getDayRange(query.date);
    const customerSearch = query.customer?.trim();
    const sellerSearch = query.seller?.trim();
    const creatorSearch = query.creator?.trim();

    const invoiceFilter = { ngay_ban: { $gte: start, $lt: end } };
    if (query.payment) invoiceFilter.phuong_thuc_tt = query.payment;
    if (customerSearch) {
        const customers = await KhachHang.find({
            $or: [
                { ma_khach_hang: { $regex: customerSearch, $options: 'i' } },
                { ten_khach_hang: { $regex: customerSearch, $options: 'i' } },
                { sdt: { $regex: customerSearch, $options: 'i' } }
            ]
        }).select('_id');
        invoiceFilter.khach_hang_id = { $in: customers.map(item => item._id) };
    }
    if (sellerSearch) {
        const sellers = await NguoiDung.find({
            $or: [
                { ho_ten: { $regex: sellerSearch, $options: 'i' } },
                { email: { $regex: sellerSearch, $options: 'i' } },
                { sdt: { $regex: sellerSearch, $options: 'i' } }
            ]
        }).select('_id');
        invoiceFilter.nguoi_ban_id = { $in: sellers.map(item => item._id) };
    }

    const [invoices, returns, receipts] = await Promise.all([
        HoaDonBanHang.find(invoiceFilter)
            .populate('khach_hang_id')
            .populate('nguoi_ban_id')
            .sort({ ngay_ban: 1 }),
        PhieuTraHang.find({ ngay_tra: { $gte: start, $lt: end } })
            .populate('hoa_don_id')
            .populate('khach_hang_id')
            .populate('nguoi_tao_id')
            .sort({ ngay_tra: 1 }),
        PhieuThuChi.find({ ngay_lap: { $gte: start, $lt: end } }).sort({ ngay_lap: 1 })
    ]);

    if (creatorSearch) {
        const creatorRegex = new RegExp(creatorSearch, 'i');
        const invoiceCreators = invoices.filter(item => creatorRegex.test(item.nguoi_ban_id?.ho_ten || '') || creatorRegex.test(item.nguoi_ban_id?.email || ''));
        invoices.splice(0, invoices.length, ...invoiceCreators);
    }

    const invoiceIds = invoices.map(item => item._id);
    const invoiceItems = invoiceIds.length
        ? await CTHoaDonBanHang.find({ hoa_don_id: { $in: invoiceIds } })
        : [];

    const qtyByInvoice = new Map();
    invoiceItems.forEach(item => {
        const id = String(item.hoa_don_id);
        qtyByInvoice.set(id, (qtyByInvoice.get(id) || 0) + Number(item.so_luong || 0));
    });

    const totalQuantity = invoiceItems.reduce((sum, item) => sum + Number(item.so_luong || 0), 0);
    const invoiceRevenue = invoices.reduce((sum, item) => sum + Number(item.tong_tien || 0), 0);
    const invoiceDiscount = invoices.reduce((sum, item) => sum + Number(item.giam_gia || 0), 0);
    const invoicePaid = invoices.reduce((sum, item) => sum + Number(item.thanh_toan || 0), 0);
    const returnTotal = returns.reduce((sum, item) => sum + Number(item.tong_tien_tra || 0), 0);
    const otherReceiptTotal = receipts
        .filter(item => item.loai_phieu === 'thu')
        .reduce((sum, item) => sum + Number(item.gia_tri || 0), 0);
    const otherPaymentTotal = receipts
        .filter(item => item.loai_phieu === 'chi')
        .reduce((sum, item) => sum + Number(item.gia_tri || 0), 0);

    return {
        date: day,
        generatedAt: new Date(),
        branchName: 'Cửa hàng trung tâm',
        invoices,
        returns,
        receipts,
        qtyByInvoice,
        summary: {
            invoiceCount: invoices.length,
            returnCount: returns.length,
            totalQuantity,
            invoiceRevenue,
            invoiceDiscount,
            invoicePaid,
            returnTotal,
            otherReceiptTotal,
            otherPaymentTotal,
            netRevenue: invoicePaid - returnTotal + otherReceiptTotal - otherPaymentTotal
        },
        filters: query
    };
}

exports.getCuoiNgayExportCsv = async (req, res, next) => {
    try {
        const report = await buildEndOfDayReport(req.query || {});
        const escape = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
        const rows = [
            ['loai', 'ma_giao_dich', 'thoi_gian', 'khach_hang_nguoi_nop_nhan', 'so_luong', 'doanh_thu', 'giam_gia', 'thuc_thu'],
            ...report.invoices.map(item => [
                'Hoa don',
                item.ma_hoa_don,
                item.ngay_ban ? item.ngay_ban.toISOString() : '',
                item.khach_hang_id?.ten_khach_hang || '',
                report.qtyByInvoice.get(String(item._id)) || 0,
                item.tong_tien || 0,
                item.giam_gia || 0,
                item.thanh_toan || 0
            ]),
            ...report.returns.map(item => [
                'Tra hang',
                item.ma_phieu_tra,
                item.ngay_tra ? item.ngay_tra.toISOString() : '',
                item.khach_hang_id?.ten_khach_hang || '',
                '',
                -(item.tong_tien_tra || 0),
                '',
                -(item.tong_tien_tra || 0)
            ])
        ];
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="bao-cao-cuoi-ngay-${report.date}.csv"`);
        res.send('\uFEFF' + rows.map(row => row.map(escape).join(',')).join('\n'));
    } catch (error) {
        next(error);
    }
};

exports.getBanHangExportCsv = async (req, res, next) => {
    try {
        const report = await buildSalesReport(req.query || {});
        const escape = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
        const rows = [
            ['thoi_gian', 'so_hoa_don', 'so_tra_hang', 'doanh_thu', 'gia_tri_tra', 'doanh_thu_thuan'],
            ...report.rows.map(item => [
                item.label,
                item.invoiceCount,
                item.returnCount,
                item.revenue,
                item.returned,
                item.netRevenue
            ])
        ];
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="bao-cao-ban-hang-${report.range.from}-${report.range.to}.csv"`);
        res.send('\uFEFF' + rows.map(row => row.map(escape).join(',')).join('\n'));
    } catch (error) {
        next(error);
    }
};

exports.getDatHangExportCsv = async (req, res, next) => {
    try {
        const report = await buildOrderReport(req.query || {});
        const escape = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
        const rows = [
            ['ma_hang', 'ten_hang', 'so_luong_dat', 'gia_tri_hang_dat', 'so_don_dat'],
            ...report.productRows.map(item => [
                item.code,
                item.name,
                item.quantity,
                item.value,
                item.orderCount
            ])
        ];
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="bao-cao-dat-hang-${report.range.from}-${report.range.to}.csv"`);
        res.send('\uFEFF' + rows.map(row => row.map(escape).join(',')).join('\n'));
    } catch (error) {
        next(error);
    }
};

exports.getKhachHangExportCsv = async (req, res, next) => {
    try {
        const report = await buildCustomerReport(Object.assign({}, req.query || {}, {
            cua_hang_id: res.locals.currentStore?._id
        }));
        const escape = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
        const isProfit = report.focus === 'loi-nhuan';
        const rows = isProfit
            ? [
                ['ma_khach_hang', 'khach_hang', 'dien_thoai', 'doanh_thu', 'gia_von', 'loi_nhuan', 'ty_le_loi_nhuan', 'dong_thieu_gia_von'],
                ...report.rows.map(item => [
                    item.code,
                    item.name,
                    item.phone,
                    item.doanh_thu,
                    item.gia_von,
                    item.loi_nhuan,
                    item.ty_le_loi_nhuan,
                    item.dong_thieu_gia_von
                ])
            ]
            : [
                ['ma_khach_hang', 'khach_hang', 'dien_thoai', 'doanh_thu', 'gia_tri_tra', 'doanh_thu_thuan', 'so_hoa_don'],
                ...report.rows.map(item => [
                    item.code,
                    item.name,
                    item.phone,
                    item.revenue,
                    item.returned,
                    item.netRevenue,
                    item.invoiceCount
                ])
            ];
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="bao-cao-khach-hang-${report.range.from}-${report.range.to}.csv"`);
        res.send('\uFEFF' + rows.map(row => row.map(escape).join(',')).join('\n'));
    } catch (error) {
        next(error);
    }
};

exports.getNhaCungCapExportCsv = async (req, res, next) => {
    try {
        const report = await buildSupplierReport(Object.assign({}, req.query || {}, {
            cua_hang_id: res.locals.currentStore?._id
        }));
        const escape = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
        const isProfit = report.focus === 'loi-nhuan';
        const rows = isProfit
            ? [
                ['ma_nha_cung_cap', 'ten_nha_cung_cap', 'dien_thoai', 'doanh_thu', 'gia_von', 'loi_nhuan', 'ty_le_loi_nhuan', 'dong_thieu_gia_von'],
                ...report.rows.map(item => [
                    item.code,
                    item.name,
                    item.phone,
                    item.doanh_thu,
                    item.gia_von,
                    item.loi_nhuan,
                    item.ty_le_loi_nhuan,
                    item.dong_thieu_gia_von
                ])
            ]
            : [
                ['ma_nha_cung_cap', 'ten_nha_cung_cap', 'dien_thoai', 'gia_tri_nhap', 'gia_tri_tra', 'gia_tri_thuan', 'so_phieu_nhap'],
                ...report.rows.map(item => [
                    item.code,
                    item.name,
                    item.phone,
                    item.importValue,
                    item.returnValue,
                    item.netValue,
                    item.purchaseCount
                ])
            ];
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="bao-cao-nha-cung-cap-${report.range.from}-${report.range.to}.csv"`);
        res.send('\uFEFF' + rows.map(row => row.map(escape).join(',')).join('\n'));
    } catch (error) {
        next(error);
    }
};

exports.get58ExportCsv = async (req, res, next) => {
    try {
        const mau = resolveReport58Mau(req.query.mau);
        const range = getSalesRange(req.query || {});
        const store = res.locals.currentStore || null;
        const workbook = await report58Excel.exportMauExcel(mau, req.query || {}, store, range);
        const sheet = workbook.getWorksheet(mau);
        const csv = await report58Excel.sheetToCsvBuffer(sheet);
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="bao-cao-58-${mau}.csv"`);
        res.send(csv);
    } catch (error) {
        next(error);
    }
};

exports.get58ExportXlsx = async (req, res, next) => {
    try {
        const range = getSalesRange(req.query || {});
        const store = res.locals.currentStore || null;
        const exportAll = req.query.all === '1' || req.query.all === 'true';
        const workbook = exportAll
            ? await report58Excel.exportAllMauExcel(req.query || {}, store, range)
            : await report58Excel.exportMauExcel(
                resolveReport58Mau(req.query.mau),
                req.query || {},
                store,
                range
            );
        const buffer = await report58Excel.workbookToBuffer(workbook);
        const filename = exportAll
            ? 'TT58-2026-bo-mau-excel.xlsx'
            : `${resolveReport58Mau(req.query.mau)}.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(Buffer.from(buffer));
    } catch (error) {
        next(error);
    }
};

exports.get58PreviewPdf = async (req, res, next) => {
    try {
        const mau = resolveReport58Mau(req.query.mau);
        if (!REPORT_58_MAU.includes(mau)) {
            return res.status(404).send('Không tìm thấy mẫu báo cáo.');
        }
        const { buffer } = await buildReport58PdfBuffer(req.query || {}, res.locals.currentStore || null);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${mau}-preview.pdf"`);
        return res.send(Buffer.from(buffer));
    } catch (error) {
        next(error);
    }
};

exports.get58PreviewExcel = async (req, res, next) => {
    try {
        const mau = resolveReport58Mau(req.query.mau);
        const range = getSalesRange(req.query || {});
        const store = res.locals.currentStore || null;
        const workbook = await report58Excel.exportMauExcel(mau, req.query || {}, store, range);
        const sheet = workbook.getWorksheet(mau);
        const preview = report58Excel.worksheetToPreviewModel(sheet);
        res.render('bao-cao/58-excel-preview', {
            mau,
            preview
        });
    } catch (error) {
        next(error);
    }
};

exports.get58ExportPdf = async (req, res, next) => {
    try {
        const mau = resolveReport58Mau(req.query.mau);
        if (REPORT_58_MAU.includes(mau)) {
            const { buffer } = await buildReport58PdfBuffer(req.query || {}, res.locals.currentStore || null);
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="${mau}.pdf"`);
            return res.send(Buffer.from(buffer));
        }
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="bao-cao-58-${mau}.txt"`);
        res.send(`Mẫu PDF cho ${mau} sẽ được bổ sung sau khi nhận file mẫu.\n`);
    } catch (error) {
        next(error);
    }
};

exports.getLoiNhuanLoExportCsv = async (req, res, next) => {
    try {
        const report = await buildLotProfitAggregateReport(req.query || {}, res.locals.currentStore || null);
        const escape = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
        const rows = [
            ['ma_hang', 'ten_hang', 'ma_lo', 'ten_lo', 'quy_cach', 'so_luong', 'doanh_thu', 'gia_von', 'loi_nhuan', 'ty_le_loi_nhuan', 'thieu_gia_von'],
            ...report.rows.map(item => [
                item.ma_hang,
                item.ten_hang,
                item.ma_lo,
                item.ten_lo,
                item.ten_quy_cach,
                item.so_luong,
                item.doanh_thu,
                item.gia_von,
                item.loi_nhuan,
                item.ty_le_loi_nhuan,
                item.thieu_gia_von ? 1 : 0
            ])
        ];
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="bao-cao-loi-nhuan-lo-${report.range.from}-${report.range.to}.csv"`);
        res.send('\uFEFF' + rows.map(row => row.map(escape).join(',')).join('\n'));
    } catch (error) {
        next(error);
    }
};

exports.getLoiNhuanLo = async (req, res, next) => {
    try {
        const report = await buildLotProfitAggregateReport(req.query || {}, res.locals.currentStore || null);
        return res.render('bao-cao/loi-nhuan-lo', {
            title: reportTitles['loi-nhuan-lo'],
            heading: reportTitles['loi-nhuan-lo'],
            reportType: 'loi-nhuan-lo',
            report
        });
    } catch (error) {
        next(error);
    }
};

exports.get58 = async (req, res, next) => {
    try {
        const query = normalizeReport58Query(req.query || {});
        const data = await enrichReport58Data(query, res.locals.currentStore || null);
        data.view = query.view === 'excel' ? 'excel' : 'pdf';
        data.query = query;
        res.render('bao-cao/58', data);
    } catch (error) {
        next(error);
    }
};

exports.getReportType = async (req, res, next) => {
    try {
        const reportType = req.params.reportType;
        if (!reportTitles[reportType]) return next();
        if (reportType === '58') {
            const query = normalizeReport58Query(req.query || {});
            const data = await enrichReport58Data(query, res.locals.currentStore || null);
            data.view = query.view === 'excel' ? 'excel' : 'pdf';
            data.query = query;
            return res.render('bao-cao/58', data);
        }
        if (reportType === 'ton-kho-lo') {
            const report = await buildLotStockReport(req.query || {});
            return res.render('bao-cao/ton-kho-lo', {
                title: reportTitles[reportType],
                heading: reportTitles[reportType],
                reportType,
                report
            });
        }
        if (reportType === 'loi-nhuan-lo') {
            const report = await buildLotProfitAggregateReport(req.query || {}, res.locals.currentStore || null);
            return res.render('bao-cao/loi-nhuan-lo', {
                title: reportTitles[reportType],
                heading: reportTitles[reportType],
                reportType,
                report
            });
        }
        if (reportType === 'cuoi-ngay') {
            const report = await buildEndOfDayReport(req.query || {});
            return res.render('bao-cao/cuoi-ngay', {
                title: reportTitles[reportType],
                heading: reportTitles[reportType],
                reportType,
                report
            });
        }
        if (reportType === 'ban-hang') {
            const report = await buildSalesReport(req.query || {});
            return res.render('bao-cao/ban-hang', {
                title: reportTitles[reportType],
                heading: reportTitles[reportType],
                reportType,
                report
            });
        }
        if (reportType === 'dat-hang') {
            const report = await buildOrderReport(req.query || {});
            return res.render('bao-cao/dat-hang', {
                title: reportTitles[reportType],
                heading: reportTitles[reportType],
                reportType,
                report
            });
        }
        if (reportType === 'khach-hang') {
            const report = await buildCustomerReport(Object.assign({}, req.query || {}, {
                cua_hang_id: res.locals.currentStore?._id
            }));
            return res.render('bao-cao/khach-hang', {
                title: reportTitles[reportType],
                heading: reportTitles[reportType],
                reportType,
                report
            });
        }
        if (reportType === 'nha-cung-cap') {
            const report = await buildSupplierReport(Object.assign({}, req.query || {}, {
                cua_hang_id: res.locals.currentStore?._id
            }));
            return res.render('bao-cao/nha-cung-cap', {
                title: reportTitles[reportType],
                heading: reportTitles[reportType],
                reportType,
                report
            });
        }
        res.render('bao-cao/index', {
            title: reportTitles[reportType],
            heading: reportTitles[reportType],
            reportType
        });
    } catch (error) {
        next(error);
    }
};
