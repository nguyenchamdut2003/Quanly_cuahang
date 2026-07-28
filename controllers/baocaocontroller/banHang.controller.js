const { buildSalesReport } = require('./builders/banHang.builder');
const { escapeCsvValue } = require('./helpers/csv.helper');

const getBanHangExportCsv = async (req, res, next) => {
    try {
        const report = await buildSalesReport(req.query || {});

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
        res.send('\uFEFF' + rows.map(row => row.map(escapeCsvValue).join(',')).join('\n'));
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getBanHangExportCsv
};
