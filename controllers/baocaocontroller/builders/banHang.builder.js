const { HoaDonBanHang, PhieuTraHang } = require('../../../models/kiot.model');
const { getSalesRange, formatDateInput, formatDisplayDate } = require('../helpers/date.helper');

async function buildSalesReport(query = {}) {
    const range = getSalesRange(query);
    const invoiceFilter = { ngay_ban: { $gte: range.start, $lt: range.end } };
    if (query.payment) invoiceFilter.phuong_thuc_tt = query.payment;

    const [invoices, returns] = await Promise.all([
        HoaDonBanHang.find(invoiceFilter).sort({ ngay_ban: 1 }),
        PhieuTraHang.find({ ngay_tra: { $gte: range.start, $lt: range.end }, deleted_at: null }).sort({ ngay_tra: 1 })
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

module.exports = {
    buildSalesReport
};

