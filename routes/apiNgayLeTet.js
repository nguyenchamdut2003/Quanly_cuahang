var express = require('express');
var router = express.Router();
var { isAuthenticated } = require('../middlewares/auth.middleware');
var ngayLamNghiController = require('../controllers/ngayLamNghi.controller');

router.use(isAuthenticated);

router.get('/', ngayLamNghiController.apiListHolidays);
router.post('/', ngayLamNghiController.apiCreateHoliday);
router.put('/:id', ngayLamNghiController.apiUpdateHoliday);
router.delete('/:id', ngayLamNghiController.apiDeleteHoliday);

module.exports = router;
