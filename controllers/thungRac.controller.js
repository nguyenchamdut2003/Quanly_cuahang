const { resolveStoreId } = require('../utils/storeScope');
const {
  loadTrashPageData,
  ENTITY_LABELS,
  formatTrashChildName,
  formatTrashChildDesc
} = require('../services/trashList.service');

exports.index = async function(req, res, next) {
  try {
    const storeId = await resolveStoreId(req);
    const pageData = await loadTrashPageData(storeId);
    res.locals.trashCount = pageData.totalRoots || 0;

    res.render('thung-rac/index', {
      activeMenu: 'thung-rac',
      groups: pageData.groups,
      totalRoots: pageData.totalRoots,
      totalItems: pageData.totalItems,
      retentionDays: pageData.retentionDays,
      entityLabels: ENTITY_LABELS,
      formatTrashChildName: formatTrashChildName,
      formatTrashChildDesc: formatTrashChildDesc
    });
  } catch (error) {
    next(error);
  }
};

exports.detail = async function(req, res, next) {
  try {
    const storeId = await resolveStoreId(req);
    const trashItemId = req.params && req.params.id;
    const { loadTrashItemDetail } = require('../services/trashDetail.service');
    const detail = await loadTrashItemDetail(trashItemId, storeId);
    return res.json({ success: true, data: detail });
  } catch (error) {
    const status = Number(error && error.statusCode) || 400;
    return res.status(status).json({ success: false, message: error.message || 'Không tải được chi tiết' });
  }
};

exports.purge = async function(req, res, next) {
  try {
    const storeId = await resolveStoreId(req);
    const rootIds = req.body && (req.body.root_ids || req.body.trash_ids);
    const { permanentDeleteTrashGroups } = require('../services/trashPurge.service');
    const result = await permanentDeleteTrashGroups(rootIds, storeId);
    return res.json({
      success: true,
      message: 'Đã xóa vĩnh viễn ' + result.deleted_roots + ' chứng từ khỏi thùng rác.',
      data: result
    });
  } catch (error) {
    const status = Number(error && error.statusCode) || 400;
    return res.status(status).json({ success: false, message: error.message || 'Không xóa được' });
  }
};

exports.restore = async function(req, res, next) {
  try {
    const storeId = await resolveStoreId(req);
    const rootIds = req.body && (req.body.root_ids || req.body.trash_ids);
    const normalizedIds = Array.isArray(rootIds) ? rootIds : (rootIds ? [rootIds] : []);
    const { ThungRacItem } = require('../models/trash.model');
    const roots = await ThungRacItem.find({
      _id: { $in: normalizedIds },
      cua_hang_id: storeId,
      restored_at: null,
      is_trash_root: true
    }).select('_id entity_type').lean();
    const byType = roots.reduce(function(map, root) {
      const type = String(root.entity_type || '');
      if (!map[type]) map[type] = [];
      map[type].push(String(root._id));
      return map;
    }, {});
    const results = [];
    const { restoreReturnFromTrash } = require('../services/returnTrash.service');
    if (byType.PhieuNhap && byType.PhieuNhap.length) {
      const { restorePurchasesFromTrash } = require('../services/purchaseTrash.service');
      results.push(await restorePurchasesFromTrash(byType.PhieuNhap, storeId, req.user && req.user._id));
    }
    if (byType.PhieuTraHang && byType.PhieuTraHang.length) {
      results.push(await restoreReturnFromTrash(byType.PhieuTraHang, storeId, req.user && req.user._id));
    }
    if (byType.PhieuTraHangNhap && byType.PhieuTraHangNhap.length) {
      const { restoreReturnImportFromTrash: restoreImport } = require('../services/returnImportTrash.service');
      results.push(await restoreImport(byType.PhieuTraHangNhap, storeId, req.user && req.user._id));
    }
    const restoredCount = results.reduce(function(sum, item) { return sum + Number(item && item.restored_count || 0); }, 0);
    if (restoredCount > 0) {
      return res.json({
        success: true,
        message: 'Đã khôi phục ' + restoredCount + ' chứng từ.',
        data: { restored_count: restoredCount, results: results }
      });
    }
    const { restoreReturnImportFromTrash } = require('../services/returnImportTrash.service');
    const result = await restoreReturnImportFromTrash(rootIds, storeId, req.user && req.user._id);
    return res.json({
      success: true,
      message: 'Đã khôi phục ' + result.restored_count + ' phiếu trả hàng nhập.',
      data: result
    });
  } catch (error) {
    const status = Number(error && error.statusCode) || 400;
    return res.status(status).json({ success: false, message: error.message || 'Không khôi phục được' });
  }
};
