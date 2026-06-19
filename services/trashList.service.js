const { ThungRacItem } = require('../models/trash.model');
const {
  ENTITY_LABELS,
  entityLabel,
  formatTrashChildName,
  formatTrashChildDesc
} = require('./trashLabels.service');
const { enrichTrashGroupsWithCodes } = require('./trashDetail.service');
const {
  getTrashRetentionDays,
  getTrashRetentionCutoff,
  purgeExpiredTrashItems
} = require('./trashPurge.service');

function buildTrashGroups(items) {
  if (!Array.isArray(items) || !items.length) return [];

  const rootItems = [];
  const childrenByGroup = {};

  items.forEach(function(item) {
    if (item.is_trash_root) {
      rootItems.push(item);
    }
  });

  items.forEach(function(item) {
    if (item.is_trash_root) return;
    const groupId = item.trash_group_id ? String(item.trash_group_id) : '';
    if (!groupId) {
      rootItems.push(item);
      return;
    }
    if (!childrenByGroup[groupId]) childrenByGroup[groupId] = [];
    childrenByGroup[groupId].push(item);
  });

  rootItems.sort(function(a, b) {
    return new Date(b.deleted_at || 0) - new Date(a.deleted_at || 0);
  });

  Object.keys(childrenByGroup).forEach(function(groupId) {
    childrenByGroup[groupId].sort(function(a, b) {
      if (Number(a.sort_order || 0) !== Number(b.sort_order || 0)) {
        return Number(a.sort_order || 0) - Number(b.sort_order || 0);
      }
      return new Date(b.deleted_at || 0) - new Date(a.deleted_at || 0);
    });
  });

  return rootItems.map(function(root) {
    return {
      root: root,
      children: childrenByGroup[String(root._id)] || []
    };
  });
}

async function countActiveTrashRoots(storeId) {
  if (!storeId) return 0;
  await purgeExpiredTrashItems(storeId);
  return ThungRacItem.countDocuments({
    cua_hang_id: storeId,
    restored_at: null,
    is_trash_root: true,
    deleted_at: { $gte: getTrashRetentionCutoff() }
  });
}

async function loadTrashPageData(storeId) {
  if (!storeId) {
    return {
      groups: [],
      totalRoots: 0,
      totalItems: 0,
      retentionDays: getTrashRetentionDays()
    };
  }

  await purgeExpiredTrashItems(storeId);

  const cutoff = getTrashRetentionCutoff();
  const items = await ThungRacItem.find({
    cua_hang_id: storeId,
    restored_at: null,
    deleted_at: { $gte: cutoff }
  })
    .sort({ deleted_at: -1 })
    .populate('deleted_by', 'ho_ten email')
    .lean();

  const groups = buildTrashGroups(items);
  await enrichTrashGroupsWithCodes(groups);
  return {
    groups: groups,
    totalRoots: groups.length,
    totalItems: items.length,
    retentionDays: getTrashRetentionDays()
  };
}

module.exports = {
  ENTITY_LABELS,
  entityLabel,
  formatTrashChildName,
  formatTrashChildDesc,
  buildTrashGroups,
  countActiveTrashRoots,
  loadTrashPageData
};
