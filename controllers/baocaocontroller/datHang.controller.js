const { buildOrderReport } = require('./builders/datHang.builder');
const { escapeCsvValue } = require('./helpers/csv.helper');

const getDatHangExportCsv = async (req, res, next) => {
    try {
        const report = await buildOrderReport(req.query || {});

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
        res.send('\uFEFF' + rows.map(row => row.map(escapeCsvValue).join(',')).join('\n'));
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getDatHangExportCsv
};
