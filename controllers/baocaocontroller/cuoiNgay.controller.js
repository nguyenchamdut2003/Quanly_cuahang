const { buildEndOfDayReport } = require('./builders/cuoiNgay.builder');
const { escapeCsvValue } = require('./helpers/csv.helper');

const getCuoiNgayExportCsv = async (req, res, next) => {
    try {
        const report = await buildEndOfDayReport(req.query || {});

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
        res.send('\uFEFF' + rows.map(row => row.map(escapeCsvValue).join(',')).join('\n'));
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getCuoiNgayExportCsv
};
