const {
  NhaCungCap,
  NhomNhaCungCap,
  loadSupplierGroups,
  makeSupplierGroupCode,
  mongoose,
  normalizeIdParam,
  resolveStoreId,
  respondSupplierGroupError,
  shouldRespondJson
} = require('./helpers/common.helper');

exports.addGroup = async function(req, res, next) {
      try {
          var tenNhom = String(req?.body?.ten_nhom_ncc || '').trim();
          var moTa = String(req?.body?.mo_ta || '').trim();
          var maNhom = String(req?.body?.ma_nhom_ncc || '').trim().toUpperCase();
          if (!tenNhom) return respondSupplierGroupError(req, res, 400, 'Vui lòng nhập tên nhóm nhà cung cấp.');
          if (!maNhom) maNhom = await makeSupplierGroupCode();
  
          var doc = {
              ma_nhom_ncc: maNhom,
              ten_nhom_ncc: tenNhom,
              mo_ta: moTa,
              trang_thai: 'active'
          };
          var storeId = await resolveStoreId(req);
          if (storeId && mongoose.Types.ObjectId.isValid(storeId)) doc.cua_hang_id = storeId;
  
          var created = await NhomNhaCungCap.create(doc);
  
          if (shouldRespondJson(req)) {
              return res.json({
                  success: true,
                  message: 'Đã thêm nhóm nhà cung cấp.',
                  data: created,
                  selectedId: String(created._id),
                  supplierGroups: await loadSupplierGroups()
              });
          }
  
          res.redirect('/nha-cung-cap?success=created');
      } catch (error) {
          console.error('[SupplierGroup] add failed:', error && error.message ? error.message : error);
          if (error && error.code === 11000) {
              return respondSupplierGroupError(req, res, 409, 'Mã nhóm nhà cung cấp đã tồn tại');
          }
          if (error && error.name === 'ValidationError') {
              return respondSupplierGroupError(req, res, 400, error.message || 'Dữ liệu nhóm nhà cung cấp không hợp lệ.');
          }
          if (shouldRespondJson(req)) {
              return res.status(500).json({ success: false, message: error && error.message ? error.message : 'Có lỗi khi xử lý nhóm nhà cung cấp.' });
          }
          next(error);
      }
  };

  exports.updateGroup = async function(req, res, next) {
      try {
          var groupId = normalizeIdParam(req?.params?.groupId);
          if (!groupId || !mongoose.Types.ObjectId.isValid(groupId)) {
              return respondSupplierGroupError(req, res, 400, 'Nhóm nhà cung cấp không hợp lệ.');
          }
  
          var tenNhom = String(req?.body?.ten_nhom_ncc || '').trim();
          var moTa = String(req?.body?.mo_ta || '').trim();
          if (!tenNhom) return respondSupplierGroupError(req, res, 400, 'Vui lòng nhập tên nhóm nhà cung cấp.');
  
          var updated = await NhomNhaCungCap.findByIdAndUpdate(groupId, { ten_nhom_ncc: tenNhom, mo_ta: moTa }, { runValidators: true, new: true });
          if (!updated) return respondSupplierGroupError(req, res, 404, 'Không tìm thấy nhóm nhà cung cấp.');
  
          if (shouldRespondJson(req)) {
              return res.json({
                  success: true,
                  message: 'Đã cập nhật nhóm nhà cung cấp.',
                  data: updated,
                  selectedId: groupId,
                  supplierGroups: await loadSupplierGroups()
              });
          }
  
          res.redirect('/nha-cung-cap?success=updated');
      } catch (error) {
          console.error('[SupplierGroup] update failed:', error && error.message ? error.message : error);
          if (error && error.name === 'ValidationError') {
              return respondSupplierGroupError(req, res, 400, error.message || 'Dữ liệu nhóm nhà cung cấp không hợp lệ.');
          }
          if (shouldRespondJson(req)) {
              return res.status(500).json({ success: false, message: error && error.message ? error.message : 'Có lỗi khi xử lý nhóm nhà cung cấp.' });
          }
          next(error);
      }
  };

  exports.removeGroup = async function(req, res, next) {
      try {
          var groupId = normalizeIdParam(req?.params?.groupId);
          if (!groupId || !mongoose.Types.ObjectId.isValid(groupId)) {
              return respondSupplierGroupError(req, res, 400, 'Nhóm nhà cung cấp không hợp lệ.');
          }
  
          await NhaCungCap.updateMany(
              { nhom_nha_cung_cap_id: groupId },
              { $unset: { nhom_nha_cung_cap_id: 1 } }
          );
          var deleted = await NhomNhaCungCap.findByIdAndDelete(groupId);
          if (!deleted) return respondSupplierGroupError(req, res, 404, 'Không tìm thấy nhóm nhà cung cấp.');
  
          if (shouldRespondJson(req)) {
              return res.json({
                  success: true,
                  message: 'Đã xóa nhóm nhà cung cấp.',
                  supplierGroups: await loadSupplierGroups()
              });
          }
  
          res.redirect('/nha-cung-cap?success=deleted');
      } catch (error) {
          console.error('[SupplierGroup] delete failed:', error && error.message ? error.message : error);
          if (shouldRespondJson(req)) {
              return res.status(500).json({ success: false, message: error && error.message ? error.message : 'Có lỗi khi xử lý nhóm nhà cung cấp.' });
          }
          next(error);
      }
  };
