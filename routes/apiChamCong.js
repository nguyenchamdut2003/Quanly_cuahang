var express = require('express');
var router = express.Router();
var { isAuthenticated } = require('../middlewares/auth.middleware');
var chamCongController = require('../controllers/chamCong.controller');

router.use(isAuthenticated);

router.get('/lookup-options', chamCongController.apiLookupOptions);
router.get('/weekly-board', chamCongController.apiWeeklyBoard);
router.get('/available-schedules', chamCongController.apiAvailableSchedules);
router.post('/from-lich-lam-viec', chamCongController.apiCreateFromSchedule);
router.post('/:id/duyet', chamCongController.apiApprove);
router.get('/', chamCongController.apiList);
router.post('/', chamCongController.apiCreate);
router.put('/:id', chamCongController.apiUpdate);
router.delete('/:id', chamCongController.apiDelete);

module.exports = router;
