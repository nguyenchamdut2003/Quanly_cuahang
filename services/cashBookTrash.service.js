const mongoose = require('mongoose');
const { SoQuy, PhieuThuChi } = require('../models/kiot.model');
const { ThungRacItem } = require('../models/trash.model');
const { ENTITY_LABELS, buildTrashChildFields } = require('./trashLabels.service');

function createHttpError(statusCode, message) {
  const error = new Error(message || 'Yeu cau khong hop le');
  error.statusCode = statusCode || 400;
  return error;
}

function normalizeIds(rawIds) {
  if (!rawIds) return [];
  const list = Array.isArray(rawIds) ? rawIds : [rawIds];
  return [...new Set(list.map(function(id) {
    return String(id || '').trim();
  }).filter(function(id) {
    return mongoose.Types.ObjectId.isValid(id);
  }))];
}

function cashBookReceiptClause(bookObjectIds) {
  return {
    $or: [
      { so_quy_id: { $in: bookObjectIds } },
      { 'chi_tiet_thanh_toan.so_quy_tien_mat_id': { $in: bookObjectIds } },
      { 'chi_tiet_thanh_toan.so_quy_chuyen_khoan_id': { $in: bookObjectIds } }
    ]
  };
}

function cashBookDisplayName(book) {
  if (!book) return '';
  const bank = book.thong_tin_ngan_hang || {};
  if (String(book.loai_so_quy || '') === 'chuyen_khoan') {
    return [bank.ten_ngan_hang, bank.so_tai_khoan].filter(Boolean).join(' - ') || book.ten_so_quy || '';
  }
  return book.ten_so_quy || 'Tiền mặt';
}

async function loadReceiptsForCashBooks(bookIds, storeId) {
  if (!bookIds.length) return [];
  const filter = Object.assign(
    {
      trang_thai: { $ne: 'cancelled' },
      deleted_at: null
    },
    cashBookReceiptClause(bookIds)
  );
  if (storeId && mongoose.Types.ObjectId.isValid(String(storeId))) filter.cua_hang_id = storeId;
  return PhieuThuChi.find(filter)
    .select('_id ma_phieu loai_phieu gia_tri ngay_lap so_quy_id chi_tiet_thanh_toan')
    .sort({ ngay_lap: -1 })
    .lean();
}

function sampleTexts(rows, pickFn, limit) {
  if (!Array.isArray(rows) || !rows.length) return [];
  return rows.slice(0, limit || 3).map(pickFn).filter(Boolean);
}

async function buildCashBookImpact(book, storeId) {
  const inTrash = await ThungRacItem.exists({
    entity_type: 'SoQuy',
    entity_id: book._id,
    restored_at: null
  });
  let canTrash = true;
  let blockReason = '';
  if (book.deleted_at || inTrash) {
    canTrash = false;
    blockReason = 'Sổ quỹ đã nằm trong thùng rác.';
  }

  const receipts = await loadReceiptsForCashBooks([book._id], storeId);
  const groups = [{
    entity_type: 'PhieuThuChi',
    label: ENTITY_LABELS.PhieuThuChi,
    count: receipts.length,
    samples: sampleTexts(receipts, function(row) { return row.ma_phieu || ''; }, 5)
  }].filter(function(group) { return Number(group.count || 0) > 0; });

  return {
    so_quy_id: String(book._id),
    ten_so_quy: cashBookDisplayName(book),
    loai_so_quy: book.loai_so_quy || 'tien_mat',
    trang_thai: book.trang_thai || 'active',
    can_trash: canTrash,
    block_reason: blockReason,
    warnings: receipts.length ? ['Các phiếu thu/chi đang dùng sổ này sẽ được đưa vào thùng rác cùng sổ quỹ.'] : [],
    groups: groups,
    total_related: groups.reduce(function(sum, group) { return sum + Number(group.count || 0); }, 0)
  };
}

function aggregateGroupTotals(items) {
  const map = {};
  items.forEach(function(item) {
    (item.groups || []).forEach(function(group) {
      const key = group.entity_type;
      if (!map[key]) {
        map[key] = {
          entity_type: key,
          label: group.label,
          count: 0,
          samples: []
        };
      }
      map[key].count += Number(group.count || 0);
      (group.samples || []).forEach(function(sample) {
        if (map[key].samples.length < 5 && sample && map[key].samples.indexOf(sample) < 0) {
          map[key].samples.push(sample);
        }
      });
    });
  });
  return Object.keys(map).map(function(key) { return map[key]; }).sort(function(a, b) {
    return a.label.localeCompare(b.label, 'vi');
  });
}

async function previewCashBookTrash(cashBookIds, storeId) {
  const ids = normalizeIds(cashBookIds);
  if (!ids.length) throw createHttpError(400, 'Vui lòng chọn ít nhất một sổ quỹ.');

  const books = await SoQuy.find({ _id: { $in: ids } }).lean();
  if (books.length !== ids.length) throw createHttpError(404, 'Một hoặc nhiều sổ quỹ không tồn tại.');

  const bookMap = books.reduce(function(map, row) {
    map[String(row._id)] = row;
    return map;
  }, {});
  const items = [];
  for (const id of ids) {
    if (bookMap[id]) items.push(await buildCashBookImpact(bookMap[id], storeId));
  }
  const blocked = items.filter(function(item) { return !item.can_trash; });
  const allowed = items.filter(function(item) { return item.can_trash; });
  return {
    items: items,
    allowed_count: allowed.length,
    blocked_count: blocked.length,
    can_proceed: blocked.length === 0 && allowed.length > 0,
    aggregate_groups: aggregateGroupTotals(items),
    total_related: items.reduce(function(sum, item) { return sum + Number(item.total_related || 0); }, 0)
  };
}

async function moveCashBooksToTrash(cashBookIds, storeId, userId) {
  const preview = await previewCashBookTrash(cashBookIds, storeId);
  if (!preview.can_proceed) {
    const firstBlock = preview.items.find(function(item) { return !item.can_trash; });
    throw createHttpError(400, firstBlock?.block_reason || 'Không thể đưa sổ quỹ đã chọn vào thùng rác.');
  }

  const now = new Date();
  const moved = [];

  for (const item of preview.items) {
    if (!item.can_trash) continue;
    const book = await SoQuy.findById(item.so_quy_id);
    if (!book) continue;

    const originalName = cashBookDisplayName(book);
    const originalBank = book.thong_tin_ngan_hang && book.thong_tin_ngan_hang.toObject
      ? book.thong_tin_ngan_hang.toObject()
      : (book.thong_tin_ngan_hang || {});
    const suffix = ' [deleted-' + String(book._id).slice(-6) + ']';

    book.deleted_at = now;
    book.deleted_by = userId || null;
    book.trang_thai = 'inactive';
    book.mac_dinh = false;
    book.ten_so_quy = String(book.ten_so_quy || originalName || 'Sổ quỹ') + suffix;
    if (book.loai_so_quy === 'chuyen_khoan' && book.thong_tin_ngan_hang) {
      book.thong_tin_ngan_hang.so_tai_khoan = String(originalBank.so_tai_khoan || '') + suffix;
    }
    await book.save();

    const root = await ThungRacItem.create({
      entity_type: 'SoQuy',
      entity_id: book._id,
      ma_chung_tu: originalName,
      ten_hien_thi: originalName || 'Sổ quỹ',
      mo_ta_phu: book.loai_so_quy === 'chuyen_khoan' ? 'Tài khoản ngân hàng' : 'Tiền mặt',
      cua_hang_id: storeId || null,
      deleted_at: now,
      deleted_by: userId || null,
      is_trash_root: true,
      trash_group_id: null,
      sort_order: 0
    });

    const receipts = await loadReceiptsForCashBooks([book._id], storeId);
    if (receipts.length) {
      await PhieuThuChi.updateMany(
        { _id: { $in: receipts.map(function(row) { return row._id; }) } },
        { $set: { deleted_at: now, deleted_by: userId || null } }
      );
      const childFields = buildTrashChildFields({
        entity_type: 'PhieuThuChi',
        label: ENTITY_LABELS.PhieuThuChi,
        count: receipts.length,
        samples: sampleTexts(receipts, function(row) { return row.ma_phieu || ''; }, 5)
      });
      await ThungRacItem.create({
        entity_type: 'PhieuThuChi',
        entity_id: book._id,
        ma_chung_tu: childFields.ma_chung_tu,
        ten_hien_thi: childFields.ten_hien_thi,
        mo_ta_phu: childFields.mo_ta_phu,
        cua_hang_id: storeId || null,
        deleted_at: now,
        deleted_by: userId || null,
        is_trash_root: false,
        trash_group_id: root._id,
        sort_order: 1
      });
    }

    moved.push({
      so_quy_id: String(book._id),
      ten_so_quy: originalName,
      trash_root_id: String(root._id)
    });
  }

  return {
    moved_count: moved.length,
    moved: moved
  };
}

module.exports = {
  previewCashBookTrash,
  moveCashBooksToTrash
};
