var express = require('express');
var router = express.Router();
var { isAuthenticated } = require('../../middlewares/auth.middleware');
var controller = require('../../controllers/chamcongcontroller/chamcong.controller');

router.use(isAuthenticated);

router.get('/', controller.index);
router.get('/tuan', controller.getTuan);
router.post('/tuan', controller.saveTuan);
router.get('/bang-luong', controller.listBangLuong);
router.get('/bang-luong/:id/export.xlsx', controller.exportBangLuongExcel);
router.get('/bang-luong/:id/thanh-toan', controller.getBangLuongThanhToan);
router.post('/bang-luong/:id/phieu-chi', controller.createBangLuongPhieuChi);
router.delete('/bang-luong/:id', controller.deleteBangLuong);

module.exports = router;
