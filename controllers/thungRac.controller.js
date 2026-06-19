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
