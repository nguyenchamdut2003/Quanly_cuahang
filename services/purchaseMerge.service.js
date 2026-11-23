// Compatibility entry point. Historical GopPhieuNhap remains readable; new merges
// create a separate management group and never move source business records.
const { createPurchaseGroup } = require('./purchaseGroup.service');

async function mergePurchasesInSession(req, session) {
  const body = req.body || {};
  const storeId = req.purchaseGroupStoreId || req._resolvedStoreId || req.session && req.session.cua_hang_id || req.user && req.user.cua_hang_id;
  const group = await createPurchaseGroup({
    sourceIds: body.phieu_nhap_ids,
    storeId,
    userId: req.user && req.user._id,
    note: body.ghi_chu
  }, { session });
  return {
    _id: group._id,
    phieu_tong_hop_id: group._id,
    ma_phieu_tong_hop: group.ma_phieu_tong_hop,
    phieu_nguon_ids: group.phieu_nguon_ids,
    href: '/nhap-hang/tong-hop/' + encodeURIComponent(String(group._id))
  };
}

module.exports = { mergePurchasesInSession };
