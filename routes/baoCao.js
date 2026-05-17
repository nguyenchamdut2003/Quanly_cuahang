const express = require('express');
const router = express.Router();
const { isAuthenticated } = require('../middlewares/auth.middleware');
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

router.use(isAuthenticated);

router.get('/', async (req, res, next) => {
    try {
        res.redirect('/bao-cao/cuoi-ngay');
    } catch (error) {
        next(error);
    }
});

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

function getSalesRange(query = {}) {
    const today = query.to ? new Date(`${query.to}T00:00:00`) : new Date();
    const endBase = Number.isNaN(today.getTime()) ? new Date() : today;
    let start;
    let end;

    if (query.from && query.to) {
        start = new Date(`${query.from}T00:00:00`);
        end = new Date(`${query.to}T00:00:00`);
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
        branchName: 'Chi nhánh trung tâm',
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
        branchName: 'Chi nhánh trung tâm',
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
        branchName: 'Chi nhánh trung tâm',
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
        branchName: 'Chi nhánh trung tâm',
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
    'ton-kho-lo': 'Báo cáo tồn kho theo lô'
};

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
            ma_lo: lot.ma_lo || lot.ten_lo || '',
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

router.get('/data', async (req, res, next) => {
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
});

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
        branchName: 'Chi nhánh trung tâm',
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

router.get('/cuoi-ngay/export.csv', async (req, res, next) => {
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
});

router.get('/ban-hang/export.csv', async (req, res, next) => {
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
});

router.get('/dat-hang/export.csv', async (req, res, next) => {
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
});

router.get('/khach-hang/export.csv', async (req, res, next) => {
    try {
        const report = await buildCustomerReport(req.query || {});
        const escape = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
        const rows = [
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
});

router.get('/nha-cung-cap/export.csv', async (req, res, next) => {
    try {
        const report = await buildSupplierReport(req.query || {});
        const escape = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
        const rows = [
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
});

router.get('/:reportType', async (req, res, next) => {
    try {
        const reportType = req.params.reportType;
        if (!reportTitles[reportType]) return next();
        if (reportType === 'ton-kho-lo') {
            const report = await buildLotStockReport(req.query || {});
            return res.render('bao-cao/ton-kho-lo', {
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
            const report = await buildCustomerReport(req.query || {});
            return res.render('bao-cao/khach-hang', {
                title: reportTitles[reportType],
                heading: reportTitles[reportType],
                reportType,
                report
            });
        }
        if (reportType === 'nha-cung-cap') {
            const report = await buildSupplierReport(req.query || {});
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
});

module.exports = router;
