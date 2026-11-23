const {
  loadSupplierDetailShellRenderLocals,
  loadSupplierDetailTabRenderLocals
} = require('./helpers/detail.helper');
const mongoose = require('mongoose');
const { resolveStoreId } = require('../../utils/storeScope');
const { getPurchaseSourceDetail } = require('../../services/purchaseGroupQuery.service');
const { loadPurchaseLinkedVatChuaLines } = require('../../services/vatChuaDetail.service');
const { createPurchaseDetailViewHelpers } = require('../../utils/purchaseDetailView');

exports.apiSupplierPurchaseDetail = async function(req, res, next) {
  try {
    const supplierId = String(req.params.id || '').trim();
    const purchaseId = String(req.params.purchaseId || '').trim();
    res.set('Cache-Control', 'no-store');
    const notFound = () => res.status(404).type('html').send('<div class="empty-cell">Không tìm thấy phiếu nhập của nhà cung cấp.</div>');
    if (!mongoose.Types.ObjectId.isValid(supplierId) || !mongoose.Types.ObjectId.isValid(purchaseId)) return notFound();
    const storeId = String(await resolveStoreId(req) || '').trim();
    if (!mongoose.Types.ObjectId.isValid(storeId)) return res.status(400).type('html').send('<div class="empty-cell">Chưa chọn cửa hàng làm việc hợp lệ.</div>');
    const source = await getPurchaseSourceDetail(purchaseId, storeId, { supplierId });
    const idOf = value => String(value && value._id || value || '');
    if (!source || idOf(source.cua_hang_id) !== storeId || idOf(source.nha_cung_cap_id) !== supplierId) return notFound();
    const vatChuaLines = await loadPurchaseLinkedVatChuaLines(purchaseId, storeId);
    const helpers = createPurchaseDetailViewHelpers({ refLink: res.locals && res.locals.refLink });
    return res.render('nhap-hang/_purchase-detail', Object.assign({}, helpers, {
      t: Object.assign({}, source, { vat_chua_lines: vatChuaLines }),
      showPurchaseActions: false
    }));
  } catch (err) {
    next(err);
  }
};

exports.apiSupplierDetail = async function(req, res, next) {
  try {
    var ctx = await loadSupplierDetailShellRenderLocals(req, req.params.id);
    if (!ctx) {
      return res.status(404).type('html').send('<div class="kv-detail-panel product-detail kv-detail-error"><p>Không tìm thấy nhà cung cấp.</p></div>');
    }
    res.set('Cache-Control', 'no-store');
    res.render('nha-cung-cap/_detail-panel', ctx);
  } catch (err) {
    next(err);
  }
};

exports.apiSupplierDetailTab = async function(req, res, next) {
  try {
    var tab = String(req.params.tab || '').trim();
    var allowedTabs = ['address', 'history', 'vat-chua', 'debt', 'xnb'];
    if (allowedTabs.indexOf(tab) < 0) {
      return res.status(404).type('html').send('<div class="empty-cell">Không tìm thấy tab.</div>');
    }

    var ctx = await loadSupplierDetailTabRenderLocals(req, req.params.id, tab);
    if (!ctx) {
      return res.status(404).type('html').send('<div class="empty-cell">Không tìm thấy nhà cung cấp.</div>');
    }

    res.set('Cache-Control', 'no-store');
    res.render('nha-cung-cap/partials/_tab-' + tab, ctx);
  } catch (err) {
    next(err);
  }
};

exports.redirectDetail = async function(req, res) {
  return res.redirect('/nha-cung-cap#s-' + encodeURIComponent(req.params.id));
};
