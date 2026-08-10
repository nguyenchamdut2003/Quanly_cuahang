const { DonHang } = require('../../models/kiot.model');
const reportTitles = require('./helpers/reportTitles');
const { normalizeReport58Query } = require('./helpers/query.helper');
const { buildEndOfDayReport } = require('./builders/cuoiNgay.builder');
const { buildSalesReport } = require('./builders/banHang.builder');
const { buildOrderReport } = require('./builders/datHang.builder');
const { buildCustomerReport } = require('./builders/khachHang.builder');
const { buildSupplierReport } = require('./builders/nhaCungCap.builder');
const { buildLotStockReport } = require('./builders/tonKhoLo.builder');
const { buildLotProfitAggregateReport } = require('./builders/loiNhuanLo.builder');
const { enrichReport58Data } = require('./builders/report58.builder');

const index = async (req, res, next) => {
    try {
        res.redirect('/bao-cao/cuoi-ngay');
    } catch (error) {
        next(error);
    }
};

const getData = async (req, res, next) => {
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

const getReportType = async (req, res, next) => {
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
                heading: reportTitles[reportType],
                reportType,
                report
            });
        }
        if (reportType === 'loi-nhuan-lo') {
            const report = await buildLotProfitAggregateReport(req.query || {}, res.locals.currentStore || null);
            return res.render('bao-cao/loi-nhuan-lo', {
                heading: reportTitles[reportType],
                reportType,
                report
            });
        }
        if (reportType === 'cuoi-ngay') {
            const report = await buildEndOfDayReport(req.query || {});
            return res.render('bao-cao/cuoi-ngay', {
                heading: reportTitles[reportType],
                reportType,
                report
            });
        }
        if (reportType === 'ban-hang') {
            const report = await buildSalesReport(req.query || {});
            return res.render('bao-cao/ban-hang', {
                heading: reportTitles[reportType],
                reportType,
                report
            });
        }
        if (reportType === 'dat-hang') {
            const report = await buildOrderReport(req.query || {});
            return res.render('bao-cao/dat-hang', {
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
                heading: reportTitles[reportType],
                reportType,
                report
            });
        }
        res.render('bao-cao/index', {
            heading: reportTitles[reportType],
            reportType
        });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    index,
    getData,
    getReportType
};
