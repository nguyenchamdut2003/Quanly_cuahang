const { buildSupplierReport } = require('./builders/nhaCungCap.builder');
const { escapeCsvValue } = require('./helpers/csv.helper');

const getNhaCungCapExportCsv = async (req, res, next) => {
    try {
        const report = await buildSupplierReport(Object.assign({}, req.query || {}, {
            cua_hang_id: res.locals.currentStore?._id
        }));

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
        res.send('\uFEFF' + rows.map(row => row.map(escapeCsvValue).join(',')).join('\n'));
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getNhaCungCapExportCsv
};
