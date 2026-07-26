var express = require('express');
var router = express.Router();
var { isAuthenticated } = require('../middlewares/auth.middleware');
var profileController = require('../controllers/profile.controller');

router.use(isAuthenticated);
router.get('/', profileController.index);
router.post('/update', profileController.postUpdate);

module.exports = router;
