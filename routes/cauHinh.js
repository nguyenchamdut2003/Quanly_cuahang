var express = require('express');
var router = express.Router();
var { isAuthenticated } = require('../middlewares/auth.middleware');
var cauHinhController = require('../controllers/cauHinh.controller');

router.use(isAuthenticated);

router.get('/doanh-nghiep', cauHinhController.businessPage);
router.post('/doanh-nghiep', cauHinhController.saveBusiness);

module.exports = router;
