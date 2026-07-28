const reportTitles = require('./helpers/reportTitles');
const { escapeCsvValue } = require('./helpers/csv.helper');
const { buildLotProfitAggregateReport } = require('./builders/loiNhuanLo.builder');

const getLoiNhuanLoExportCsv = async (req, res, next) => {
    try {
        const report = await buildLotProfitAggregateReport(req.query || {}, res.locals.currentStore || null);

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
        res.send('\uFEFF' + rows.map(row => row.map(escapeCsvValue).join(',')).join('\n'));
    } catch (error) {
        next(error);
    }
};

const getLoiNhuanLo = async (req, res, next) => {
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

module.exports = {
    getLoiNhuanLoExportCsv,
    getLoiNhuanLo
};
