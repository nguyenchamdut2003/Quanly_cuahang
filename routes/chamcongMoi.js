var express = require('express');
var router = express.Router();
var { isAuthenticated } = require('../middlewares/auth.middleware');
var chamcongController = require('../controllers/chamcongmoicontroller');

router.use(isAuthenticated);

router.get('/', chamcongController.index);
router.get('/api/nhan-vien', chamcongController.apiEmployees);
router.post('/api/nhan-vien', chamcongController.apiCreateEmployee);
router.get('/api/nhan-vien/:id', chamcongController.apiGetEmployee);
router.put('/api/nhan-vien/:id', chamcongController.apiUpdateEmployee);
router.delete('/api/nhan-vien/:id', chamcongController.apiDeleteEmployee);
router.get('/api/bang-luong', chamcongController.apiPayrolls);
router.get('/api/bang-luong/:id/thanh-toan', chamcongController.apiPayrollPaymentPreview);
router.post('/api/bang-luong/:id/phieu-chi', chamcongController.apiPayrollCreatePhieuChi);
router.get('/api/tuan', chamcongController.apiWeek);
router.post('/api/tuan', chamcongController.apiSaveWeek);

module.exports = router;
