var express = require('express');
var router = express.Router();
var { isAuthenticated } = require('../../middlewares/auth.middleware');
var doitacgiaohangcontroller = require('../../controllers/dotacgiaohangcontroller/page.controller');

router.use(isAuthenticated);
router.get('/', doitacgiaohangcontroller.getDoiTacGiaoHang);
router.post('/add', doitacgiaohangcontroller.postDoiTacGiaoHangAdd);
router.post('/:id/update', doitacgiaohangcontroller.postDoiTacGiaoHangIdUpdate);

module.exports = router;
