const { buildCustomerReport } = require('./builders/khachHang.builder');
const { escapeCsvValue } = require('./helpers/csv.helper');

const getKhachHangExportCsv = async (req, res, next) => {
    try {
        const report = await buildCustomerReport(Object.assign({}, req.query || {}, {
            cua_hang_id: res.locals.currentStore?._id
        }));

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
        res.send('\uFEFF' + rows.map(row => row.map(escapeCsvValue).join(',')).join('\n'));
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getKhachHangExportCsv
};
