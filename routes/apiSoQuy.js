var express = require('express');
var router = express.Router();
var { isAuthenticated } = require('../middlewares/auth.middleware');
var { calculateCashBookBalances } = require('../services/cashBookBalance.service');
var hrLog = require('../utils/hrPayrollLogger');
var catalog = require('../services/soQuyCatalog.service');
var {
  previewCashBookTrash,
  moveCashBooksToTrash
} = require('../services/cashBookTrash.service');
var { resolveStoreId } = require('../utils/storeScope');

router.use(isAuthenticated);

async function buildCashBookResponse(row) {
  var balances = await calculateCashBookBalances({
    so_quy_ids: [row._id]
  });
  return catalog.formatCashBook(row, balances);
}

function jsonError(res, error, fallbackStatus) {
  var status = error && error.statusCode ? error.statusCode : (fallbackStatus || 400);
  return res.status(status).json({
    success: false,
    message: catalog.userMessageFromMongoError(error)
  });
}

router.get('/', async function(req, res, next) {
  try {
    var rows = await catalog.listCashBooks({
      query: req.query || {}
    });
    var balances = await calculateCashBookBalances({
      so_quy_ids: rows.map(function(row) { return row._id; })
    });
    var items = rows.map(function(row) { return catalog.formatCashBook(row, balances); });
    return res.json({ success: true, data: items, items: items });
  } catch (error) {
    return jsonError(res, error);
  }
});

router.get('/active', async function(req, res, next) {
  try {
    hrLog.logPayrollInfo('cashbook.active.list.start', hrLog.buildRequestContext(req));
    var rows = await catalog.listCashBooks({
      query: Object.assign({}, req.query || {}, { activeOnly: 1 })
    });
    var items = rows.map(function(row) {
      return {
        _id: row._id,
        ten_so_quy: row.ten_so_quy || '',
        loai_so_quy: row.loai_so_quy || 'tien_mat',
        mac_dinh: !!row.mac_dinh,
        thong_tin_ngan_hang: row.thong_tin_ngan_hang || {},
        trang_thai: row.trang_thai || 'active'
      };
    });
    hrLog.logPayrollInfo('cashbook.active.list.success', {
      count: items.length,
      items: items.map(function(row) {
        return {
          _id: hrLog.idStr(row._id),
          ten_so_quy: row.ten_so_quy
        };
      })
    });
    return res.json({ success: true, items: items });
  } catch (error) {
    hrLog.logPayrollError('cashbook.active.list.error', error, hrLog.buildRequestContext(req));
    return jsonError(res, error);
  }
});

router.post('/', async function(req, res, next) {
  try {
    var row = await catalog.createCashBook({
      body: req.body || {}
    });
    var data = await buildCashBookResponse(row.toObject ? row.toObject() : row);
    return res.json({ success: true, message: 'Tạo sổ quỹ thành công', data: data });
  } catch (error) {
    return jsonError(res, error);
  }
});

router.put('/:id', async function(req, res, next) {
  try {
    var row = await catalog.updateCashBook({
      id: req.params.id,
      body: req.body || {}
    });
    var data = await buildCashBookResponse(row.toObject ? row.toObject() : row);
    return res.json({ success: true, message: 'Cập nhật sổ quỹ thành công', data: data });
  } catch (error) {
    return jsonError(res, error);
  }
});

router.post('/trash/preview', async function(req, res) {
  try {
    var storeId = await resolveStoreId(req);
    var ids = req.body && (req.body.so_quy_ids || req.body.ids || req.body.id);
    var preview = await previewCashBookTrash(ids, storeId);
    return res.json({ success: true, data: preview });
  } catch (error) {
    return jsonError(res, error);
  }
});

router.post('/trash/move', async function(req, res) {
  try {
    var storeId = await resolveStoreId(req);
    var ids = req.body && (req.body.so_quy_ids || req.body.ids || req.body.id);
    var result = await moveCashBooksToTrash(ids, storeId, req.user && req.user._id);
    return res.json({
      success: true,
      message: 'Đã đưa ' + result.moved_count + ' sổ quỹ vào thùng rác.',
      data: result
    });
  } catch (error) {
    return jsonError(res, error);
  }
});

router.delete('/:id', async function(req, res) {
  try {
    var storeId = await resolveStoreId(req);
    var result = await moveCashBooksToTrash([req.params.id], storeId, req.user && req.user._id);
    return res.json({
      success: true,
      message: 'Đã đưa sổ quỹ vào thùng rác.',
      data: result
    });
  } catch (error) {
    return jsonError(res, error);
  }
});

module.exports = router;
