var express = require('express');
var router = express.Router();
var { isAuthenticated } = require('../middlewares/auth.middleware');
var { SoQuy } = require('../models/kiot.model');
var { resolveStoreId } = require('../utils/storeScope');
var { calculateCashBookBalances } = require('../services/cashBookBalance.service');
var hrLog = require('../utils/hrPayrollLogger');

router.use(isAuthenticated);

var CASH_BOOK_STATUSES = ['active', 'inactive'];

function isValidStatus(value) {
  return CASH_BOOK_STATUSES.indexOf(String(value || '').trim()) >= 0;
}

function isObjectId(value) {
  return /^[0-9a-fA-F]{24}$/.test(String(value || '').trim());
}

function formatCashBook(row, balances) {
  var id = String(row && row._id || '');
  var balance = balances && balances[id] ? balances[id] : { tong_thu: 0, tong_chi: 0, so_du_tinh_toan: 0 };
  return {
    _id: row._id,
    ten_so_quy: row.ten_so_quy || '',
    trang_thai: row.trang_thai || 'active',
    tong_thu: balance.tong_thu || 0,
    tong_chi: balance.tong_chi || 0,
    so_du_tinh_toan: balance.so_du_tinh_toan || 0
  };
}

async function buildCashBookResponse(row) {
  var balances = await calculateCashBookBalances({
    cua_hang_id: row.cua_hang_id,
    so_quy_ids: [row._id]
  });
  return formatCashBook(row, balances);
}

router.get('/', async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return res.status(400).json({ success: false, message: 'Chua chon cua hang' });

    var status = String(req.query.trang_thai || 'all').trim();
    if (status !== 'all' && !isValidStatus(status)) {
      return res.status(400).json({ success: false, message: 'Trang thai so quy khong hop le' });
    }

    var filter = { cua_hang_id: storeId };
    if (status !== 'all') filter.trang_thai = status;

    var rows = await SoQuy.find(filter)
      .select('ten_so_quy trang_thai cua_hang_id')
      .sort({ ten_so_quy: 1 })
      .lean();
    var balances = await calculateCashBookBalances({
      cua_hang_id: storeId,
      so_quy_ids: rows.map(function(row) { return row._id; })
    });
    var items = rows.map(function(row) { return formatCashBook(row, balances); });
    return res.json({ success: true, data: items, items: items });
  } catch (error) {
    next(error);
  }
});

router.get('/active', async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    hrLog.logPayrollInfo('cashbook.active.list.start', Object.assign({}, hrLog.buildRequestContext(req), {
      cua_hang_id: hrLog.idStr(storeId)
    }));
    if (!storeId) return res.status(400).json({ success: false, message: 'Chua chon cua hang' });

    var rows = await SoQuy.find({
      cua_hang_id: storeId,
      trang_thai: 'active'
    })
      .select('ten_so_quy trang_thai')
      .sort({ ten_so_quy: 1 })
      .lean();
    var items = rows.map(function(row) {
      return {
        _id: row._id,
        ten_so_quy: row.ten_so_quy || '',
        trang_thai: row.trang_thai || 'active'
      };
    });
    hrLog.logPayrollInfo('cashbook.active.list.success', {
      cua_hang_id: hrLog.idStr(storeId),
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
    next(error);
  }
});

router.post('/', async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return res.status(400).json({ success: false, message: 'Chua chon cua hang' });

    var name = String(req.body && req.body.ten_so_quy || '').trim();
    var status = String(req.body && req.body.trang_thai || 'active').trim();
    if (!name) return res.status(400).json({ success: false, message: 'Ten so quy la bat buoc' });
    if (!isValidStatus(status)) return res.status(400).json({ success: false, message: 'Trang thai so quy khong hop le' });

    var row = await SoQuy.create({
      cua_hang_id: storeId,
      ten_so_quy: name,
      trang_thai: status
    });
    var data = await buildCashBookResponse(row.toObject ? row.toObject() : row);
    return res.json({ success: true, message: 'Tao so quy thanh cong', data: data });
  } catch (error) {
    next(error);
  }
});

router.put('/:id', async function(req, res, next) {
  try {
    var storeId = await resolveStoreId(req);
    if (!storeId) return res.status(400).json({ success: false, message: 'Chua chon cua hang' });
    if (!isObjectId(req.params.id)) return res.status(400).json({ success: false, message: 'Id so quy khong hop le' });

    var update = {};
    if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'ten_so_quy')) {
      var name = String(req.body.ten_so_quy || '').trim();
      if (!name) return res.status(400).json({ success: false, message: 'Ten so quy la bat buoc' });
      update.ten_so_quy = name;
    }
    if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'trang_thai')) {
      var status = String(req.body.trang_thai || '').trim();
      if (!isValidStatus(status)) return res.status(400).json({ success: false, message: 'Trang thai so quy khong hop le' });
      update.trang_thai = status;
    }

    var query = { _id: req.params.id, cua_hang_id: storeId };
    var row = Object.keys(update).length
      ? await SoQuy.findOneAndUpdate(
        query,
        { $set: update },
        { new: true, runValidators: true }
      ).select('ten_so_quy trang_thai cua_hang_id')
      : await SoQuy.findOne(query).select('ten_so_quy trang_thai cua_hang_id');
    if (!row) return res.status(404).json({ success: false, message: 'Khong tim thay so quy.' });
    var data = await buildCashBookResponse(row.toObject ? row.toObject() : row);
    return res.json({ success: true, message: 'Cap nhat so quy thanh cong', data: data });
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', function(req, res) {
  if (!isObjectId(req.params.id)) return res.status(400).json({ success: false, message: 'Id so quy khong hop le' });
  return res.status(400).json({
    success: false,
    message: 'Khong duoc xoa so quy. Chi co the ngung su dung.'
  });
});

module.exports = router;
