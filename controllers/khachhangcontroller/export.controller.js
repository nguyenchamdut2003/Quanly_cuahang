var { KhachHang } = require('../../models/kiot.model');
var { normalizeIdParam } = require('./helpers/common.helper');
var { handleCustomerDebtExport } = require('../../services/customerDebtExport.service');
var { buildCustomerListWorkbook } = require('./services/export/customerListExport.service');
var { buildCustomerDetailWorkbook } = require('./services/export/customerDetailExport.service');
var { buildCustomerSectionWorkbook } = require('./services/export/customerSectionExport.service');

async function sendWorkbook(res, pack) {
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="' + pack.filename + '"');
    await pack.workbook.xlsx.write(res);
    res.end();
}

exports.exportExcel = async function(req, res, next) {
    try {
        var pack = await buildCustomerListWorkbook(req?.query || {});
        await sendWorkbook(res, pack);
    } catch (error) {
        next(error);
    }
};

exports.exportOneExcel = async function(req, res, next) {
    try {
        var pack = await buildCustomerDetailWorkbook(req?.params?.id);
        await sendWorkbook(res, pack);
    } catch (error) {
        if (error && error.code === 'invalid_customer') {
            return res.redirect('/khach-hang?error=invalid_customer');
        }
        next(error);
    }
};

exports.exportSectionExcel = async function(req, res, next) {
    try {
        var pack = await buildCustomerSectionWorkbook(req?.params?.id, req?.params?.section);
        await sendWorkbook(res, pack);
    } catch (error) {
        var customerId = normalizeIdParam(req?.params?.id);
        if (error && error.code === 'invalid_customer') {
            return res.redirect('/khach-hang?error=invalid_customer');
        }
        if (error && error.code === 'invalid_export_section') {
            return res.redirect('/khach-hang?error=invalid_export_section#c-' + customerId);
        }
        next(error);
    }
};

exports.exportCustomerDebt = async function(req, res, next) {
    try {
        var customerId = normalizeIdParam(req?.params?.id);
        if (!customerId) return res.redirect('/khach-hang?error=invalid_customer');
        var customer = await KhachHang.findOne({ _id: customerId }).lean();
        if (!customer) return res.redirect('/khach-hang?error=invalid_customer');
        await handleCustomerDebtExport(res, customer, req.query || {});
    } catch (error) {
        if (error && error.code === 'INVALID_DEBT_PERIOD') {
            var cid = normalizeIdParam(req?.params?.id);
            return res.redirect('/khach-hang?error=' + encodeURIComponent(error.message || 'invalid_debt_period') + '#c-' + cid);
        }
        next(error);
    }
};
