const { HoaDonBanHang, KhachHang, PhieuTraHang } = require('../../../models/kiot.model');
const { buildProfitByCustomerReport } = require('../../../services/profitReport.service');
const { getSalesRange } = require('../helpers/date.helper');

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
        branchName: 'C?a hàng trung tâm',
        range,
        rows,
        topCustomers: rows.slice(0, 10),
        totals,
        filters: query,
        viewMode: query.view === 'report' ? 'report' : 'chart',
        focus: query.focus || 'ban-hang'
    };
}

module.exports = {
    buildCustomerReport
};

