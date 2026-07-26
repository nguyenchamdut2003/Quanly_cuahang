var express = require('express');
var router = express.Router();
var { isAuthenticated } = require('../middlewares/auth.middleware');
var apiAddressController = require('../controllers/apiAddress.controller');

router.use(isAuthenticated);
router.get('/provinces', apiAddressController.getProvinces);
router.get('/districts', apiAddressController.getDistricts);
router.get('/wards', apiAddressController.getWards);
router.get('/wards-by-province', apiAddressController.getWardsByProvince);

module.exports = router;
