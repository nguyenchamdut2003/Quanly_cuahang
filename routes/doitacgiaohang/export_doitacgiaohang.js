var express = require('express');
var router = express.Router();
var { isAuthenticated } = require('../../middlewares/auth.middleware');
var doitacgiaohangcontroller = require('../../controllers/dotacgiaohangcontroller/export.controller');

router.use(isAuthenticated);
router.get('/export.xlsx', doitacgiaohangcontroller.getDoiTacGiaoHangExportXlsx);
router.get('/:id/export.xlsx', doitacgiaohangcontroller.getDoiTacGiaoHangIdExportXlsx);

module.exports = router;
