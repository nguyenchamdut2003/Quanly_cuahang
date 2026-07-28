var express = require('express');
var router = express.Router();
var { isAuthenticated } = require('../middlewares/auth.middleware');
var bangLuongController = require('../controllers/chamcongcu/bangLuong.controller');
var hrLog = require('../utils/hrPayrollLogger');

function payrollApiRequestLog(req, res, next) {
  var startedAt = Date.now();
  var ctx = hrLog.buildRequestContext(req);
  hrLog.logPayrollInfo('payroll.api.request.start', ctx);
  res.on('finish', function() {
    hrLog.logPayrollInfo('payroll.api.request.finish', Object.assign({}, ctx, {
      status_code: res.statusCode,
      duration_ms: Date.now() - startedAt
    }));
    if (res.statusCode >= 400) {
      hrLog.logPayrollWarn('payroll.api.request.error_status', Object.assign({}, ctx, {
        status_code: res.statusCode
      }));
    }
  });
  next();
}

router.use(isAuthenticated);
router.use(payrollApiRequestLog);

router.post('/phieu-luong/:id/huy', bangLuongController.apiCancelPayrollReceipt);
router.get('/nhan-vien/:employeeId/export', bangLuongController.apiExportEmployeePayrollSlips);
router.get('/nhan-vien/:employeeId', bangLuongController.apiEmployeePayrollSlips);
router.post('/ct/:id/thanh-toan', bangLuongController.apiPayDetail);
router.post('/:id/tinh-luong', bangLuongController.apiCalculate);
router.post('/:id/chot', bangLuongController.apiLock);
router.post('/:id/huy', bangLuongController.apiCancel);
router.get('/:id', bangLuongController.apiDetail);
router.get('/', bangLuongController.apiList);
router.post('/', bangLuongController.apiCreate);
router.delete('/:id', bangLuongController.apiDelete);

module.exports = router;
