var { calculateCashBookBalances } = require('../../services/cashBookBalance.service');
var catalog = require('../../services/soQuyCatalog.service');
var { resolveStoreId } = require('../../utils/storeScope');
var { uploadImageBuffer } = require('../../utils/cloudinaryUpload');

function parseBodyObject(body) {
  var parsed = Object.assign({}, body || {});
  if (typeof parsed.thong_tin_ngan_hang === 'string') {
    try {
      parsed.thong_tin_ngan_hang = JSON.parse(parsed.thong_tin_ngan_hang);
    } catch (error) {
      parsed.thong_tin_ngan_hang = {};
    }
  }
  return parsed;
}

async function buildCashBookBody(req) {
  var body = parseBodyObject(req.body || {});
  if (req.file) {
    body.anh_so_quy = await uploadImageBuffer(req.file, { folder: 'quanly-cuahang/so-quy' });
  }
  return body;
}

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

exports.index = async function(req, res, next) {
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
};

exports.getActive = async function(req, res, next) {
  try {
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
        anh_so_quy: row.anh_so_quy || null,
        trang_thai: row.trang_thai || 'active'
      };
    });
    return res.json({ success: true, items: items });
  } catch (error) {
    return jsonError(res, error);
  }
};

exports.create = async function(req, res, next) {
  try {
    var row = await catalog.createCashBook({
      body: await buildCashBookBody(req)
    });
    var data = await buildCashBookResponse(row.toObject ? row.toObject() : row);
    return res.json({ success: true, message: 'Tạo sổ quỹ thành công', data: data });
  } catch (error) {
    return jsonError(res, error);
  }
};

exports.putId = async function(req, res, next) {
  try {
    var row = await catalog.updateCashBook({
      id: req.params.id,
      body: await buildCashBookBody(req)
    });
    var data = await buildCashBookResponse(row.toObject ? row.toObject() : row);
    return res.json({ success: true, message: 'Cập nhật sổ quỹ thành công', data: data });
  } catch (error) {
    return jsonError(res, error);
  }
};

exports.postTrashPreview = async function(req, res) {
  return res.status(410).json({ success: false, message: 'Chức năng xóa/đưa vào thùng rác đã được tắt.' });
};

exports.postTrashMove = async function(req, res) {
  return res.status(410).json({ success: false, message: 'Chức năng xóa/đưa vào thùng rác đã được tắt.' });
};

exports.deleteId = async function(req, res) {
  return res.status(410).json({ success: false, message: 'Chức năng xóa/đưa vào thùng rác đã được tắt.' });
};


