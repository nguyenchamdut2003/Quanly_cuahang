const {
  loadSupplierDetailShellRenderLocals,
  loadSupplierDetailTabRenderLocals
} = require('./helpers/detail.helper');

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
