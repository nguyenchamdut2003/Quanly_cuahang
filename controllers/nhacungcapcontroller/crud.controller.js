const {
  NhaCungCap,
  makeSupplierCode,
  normalizeIdList,
  normalizeIdParam,
  normalizeSupplierPayload
} = require('./helpers/common.helper');

exports.add = async function(req, res, next) {
      try {
          var payload = normalizeSupplierPayload(req?.body);
          if (!payload.ten_ncc) return res.redirect('/nha-cung-cap?mode=create&error=missing_name');
          if (!payload.ma_ncc) payload.ma_ncc = await makeSupplierCode();
          var supplier = await NhaCungCap.create(payload);
          res.redirect('/nha-cung-cap?success=created#s-' + String(supplier._id));
      } catch (error) {
          if (error && error.code === 11000) return res.redirect('/nha-cung-cap?mode=create&error=duplicate_code');
          next(error);
      }
  };

  exports.update = async function(req, res, next) {
      try {
          var supplierId = normalizeIdParam(req?.params?.id);
          if (!supplierId) return res.redirect('/nha-cung-cap?error=invalid_supplier');
  
          var payload = normalizeSupplierPayload(req?.body);
          if (!payload.ten_ncc) return res.redirect('/nha-cung-cap?error=missing_name#s-' + supplierId);
          if (!payload.ma_ncc) delete payload.ma_ncc;
          await NhaCungCap.findByIdAndUpdate(supplierId, payload, { runValidators: true });
          res.redirect('/nha-cung-cap?success=updated#s-' + supplierId);
      } catch (error) {
          if (error && error.code === 11000) return res.redirect('/nha-cung-cap?error=duplicate_code');
          next(error);
      }
  };

  exports.remove = async function(req, res, next) {
      try {
          var supplierId = normalizeIdParam(req?.params?.id);
          if (!supplierId) return res.redirect('/nha-cung-cap?error=invalid_supplier');
          await NhaCungCap.findByIdAndDelete(supplierId);
          res.redirect('/nha-cung-cap?success=deleted');
      } catch (error) {
          next(error);
      }
  };

  exports.removeSelected = async function(req, res, next) {
      try {
          var ids = normalizeIdList(req?.body?.ids);
          if (ids.length === 0) return res.redirect('/nha-cung-cap?error=no_selection');
          await NhaCungCap.deleteMany({ _id: { $in: ids } });
          res.redirect('/nha-cung-cap?success=deleted');
      } catch (error) {
          next(error);
      }
  };
