var express = require('express');
var router = express.Router();
var { isAuthenticated } = require('../middlewares/auth.middleware');
var { SoQuy } = require('../models/kiot.model');
var { resolveStoreId } = require('../utils/storeScope');
var hrLog = require('../utils/hrPayrollLogger');

router.use(isAuthenticated);

router.get('/active', async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    hrLog.logPayrollInfo('cashbook.active.list.start', Object.assign({}, hrLog.buildRequestContext(req), {
      cua_hang_id: hrLog.idStr(storeId)
    }));
    if (!storeId) return res.status(400).json({ success: false, message: 'Chua chon cua hang' });
    var items = await SoQuy.find({
      cua_hang_id: storeId,
      trang_thai: 'active'
    }).select('ten_so_quy so_du cho_phep_am loai mac_dinh is_default default la_mac_dinh').sort({ ten_so_quy: 1, loai: 1 }).lean();
    hrLog.logPayrollInfo('cashbook.active.list.success', {
      cua_hang_id: hrLog.idStr(storeId),
      count: items.length,
      items: items.map(function(row) {
        return {
          _id: hrLog.idStr(row._id),
          ten_so_quy: row.ten_so_quy,
          so_du: row.so_du,
          cho_phep_am: row.cho_phep_am
        };
      })
    });
    return res.json({ success: true, items: items });
  } catch (error) {
    hrLog.logPayrollError('cashbook.active.list.error', error, hrLog.buildRequestContext(req));
    next(error);
  }
});

module.exports = router;
