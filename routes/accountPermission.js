var express = require('express');
var router = express.Router();
var { isAuthenticated, isSuperAdmin } = require('../middlewares/auth.middleware');
var controller = require('../controllers/accountPermission.controller');

router.use(isAuthenticated);
router.use(isSuperAdmin);
router.get('/', controller.index);
router.post('/:id/role', controller.updateRole);

module.exports = router;
