var { LoHang } = require('../models/kiot.model');

exports.redirectInvoice = async function(req, res, next) {
  try {
    res.redirect('/don-hang/hoa-don?invoice=' + encodeURIComponent(req.params.id));
  } catch (error) {
    next(error);
  }
};

exports.redirectLot = async function(req, res, next) {
  try {
    var lot = await LoHang.findById(req.params.id).select('hang_hoa_id').lean();
    var target = lot && lot.hang_hoa_id
      ? '/hang-hoa?lot=' + encodeURIComponent(req.params.id) + '#p-' + String(lot.hang_hoa_id)
      : '/hang-hoa?lot=' + encodeURIComponent(req.params.id);
    res.redirect(target);
  } catch (error) {
    next(error);
  }
};
