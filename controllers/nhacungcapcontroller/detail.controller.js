const {
  loadSupplierDetailRenderLocals
} = require('./helpers/detail.helper');

exports.apiSupplierDetail = async function(req, res, next) {
      try {
          var ctx = await loadSupplierDetailRenderLocals(req, req.params.id);
          if (!ctx) {
              return res.status(404).type('html').send('<div class="kv-detail-panel product-detail kv-detail-error"><p>Không tìm thấy nhà cung cấp.</p></div>');
          }
          res.render('nha-cung-cap/_detail-panel', ctx);
      } catch (err) {
          next(err);
      }
  };

  exports.redirectDetail = async function(req, res) {
      return res.redirect('/nha-cung-cap#s-' + encodeURIComponent(req.params.id));
  };
