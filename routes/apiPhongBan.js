var express = require('express');
var router = express.Router();
var { isAuthenticated } = require('../middlewares/auth.middleware');
var phongBanController = require('../controllers/phongBan.controller');

router.use(isAuthenticated);

router.get('/', phongBanController.apiList);
router.post('/', phongBanController.apiCreate);
router.put('/:id', phongBanController.apiUpdate);
router.delete('/:id', phongBanController.apiDelete);

module.exports = router;
