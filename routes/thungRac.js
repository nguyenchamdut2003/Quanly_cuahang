const express = require('express');
const router = express.Router();
const { isAuthenticated } = require('../middlewares/auth.middleware');
const thungRacController = require('../controllers/thungRac.controller');

router.get('/', isAuthenticated, thungRacController.index);
router.get('/detail/:id', isAuthenticated, thungRacController.detail);
router.post('/restore', isAuthenticated, thungRacController.restore);
router.post('/purge', isAuthenticated, thungRacController.purge);

module.exports = router;
