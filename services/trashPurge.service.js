const mongoose = require('mongoose');
const { ThungRacItem } = require('../models/trash.model');

const TRASH_RETENTION_DAYS = 30;

function createHttpError(statusCode, message) {
  const error = new Error(message || 'Yêu cầu không hợp lệ');
  error.statusCode = statusCode || 400;
  return error;
}

function getTrashRetentionDays() {
  return TRASH_RETENTION_DAYS;
}

function getTrashRetentionCutoff() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - TRASH_RETENTION_DAYS);
  return cutoff;
}

function normalizeRootIds(rawIds) {
  if (!rawIds) return [];
  const list = Array.isArray(rawIds) ? rawIds : [rawIds];
  return [...new Set(list.map(function(id) {
    return String(id || '').trim();
  }).filter(function(id) {
    return mongoose.Types.ObjectId.isValid(id);
  }))];
}

async function purgeExpiredTrashItems(storeId) {
  const filter = {
    restored_at: null,
    deleted_at: { $lt: getTrashRetentionCutoff() }
  };
  if (storeId && mongoose.Types.ObjectId.isValid(storeId)) {
    filter.cua_hang_id = storeId;
  }
  const result = await ThungRacItem.deleteMany(filter);
  return { deletedCount: Number(result.deletedCount || 0) };
}

async function permanentDeleteTrashGroups(rootTrashIds, storeId) {
  const ids = normalizeRootIds(rootTrashIds);
  if (!ids.length) {
    throw createHttpError(400, 'Vui lòng chọn ít nhất một chứng từ trong thùng rác.');
  }
  if (!storeId || !mongoose.Types.ObjectId.isValid(storeId)) {
    throw createHttpError(400, 'Không xác định được cửa hàng.');
  }

  const objectIds = ids.map(function(id) { return new mongoose.Types.ObjectId(id); });
  const roots = await ThungRacItem.find({
    _id: { $in: objectIds },
    cua_hang_id: storeId,
    restored_at: null,
    is_trash_root: true
  }).lean();

  if (!roots.length) {
    throw createHttpError(404, 'Không tìm thấy chứng từ đã chọn trong thùng rác.');
  }

  const foundIds = roots.map(function(row) { return String(row._id); });
  const missing = ids.filter(function(id) { return foundIds.indexOf(id) < 0; });
  if (missing.length) {
    throw createHttpError(404, 'Một hoặc nhiều mục không còn trong thùng rác.');
  }

  const rootObjectIds = roots.map(function(row) { return row._id; });
  const deleteResult = await ThungRacItem.deleteMany({
    cua_hang_id: storeId,
    restored_at: null,
    $or: [
      { _id: { $in: rootObjectIds } },
      { trash_group_id: { $in: rootObjectIds } }
    ]
  });

  return {
    deleted_roots: roots.length,
    deleted_items: Number(deleteResult.deletedCount || 0),
    roots: roots.map(function(row) {
      return {
        trash_id: String(row._id),
        ma_chung_tu: row.ma_chung_tu || '',
        entity_type: row.entity_type || ''
      };
    })
  };
}

module.exports = {
  TRASH_RETENTION_DAYS,
  getTrashRetentionDays,
  getTrashRetentionCutoff,
  purgeExpiredTrashItems,
  permanentDeleteTrashGroups
};
