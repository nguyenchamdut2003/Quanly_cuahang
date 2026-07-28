var { normalizeIdParam, shouldRespondJson } = require('./helpers/common.helper');
var addressTypeService = require('./services/addressType.service');

function jsonAddressTypeError(req, res, status, message, redirectError) {
    if (shouldRespondJson(req)) return res.status(status).json({ success: false, message: message });
    return res.redirect('/khach-hang?error=' + redirectError);
}

exports.addAddressType = async function(req, res, next) {
    try {
        var created = await addressTypeService.createAddressType(req.body || {});
        if (shouldRespondJson(req)) {
            return res.json({
                success: true,
                message: 'Đã thêm loại địa chỉ.',
                selectedId: String(created._id),
                addressTypes: await addressTypeService.loadAddressTypes()
            });
        }
        res.redirect('/khach-hang?success=created');
    } catch (error) {
        if (error.code === 'missing_address_type') return jsonAddressTypeError(req, res, 400, 'Vui lòng nhập tên loại địa chỉ.', 'missing_address_type');
        if (error.code === 'duplicate_address_type') return jsonAddressTypeError(req, res, 409, 'Loại địa chỉ đã tồn tại.', 'duplicate_address_type');
        if (shouldRespondJson(req)) return res.status(500).json({ success: false, message: 'Không thể thêm loại địa chỉ.' });
        next(error);
    }
};

exports.updateAddressType = async function(req, res, next) {
    try {
        var addressTypeId = normalizeIdParam(req?.params?.addressTypeId);
        if (!addressTypeId) return jsonAddressTypeError(req, res, 400, 'Loại địa chỉ không hợp lệ.', 'invalid_address_type');
        await addressTypeService.updateAddressType(addressTypeId, req.body || {});
        if (shouldRespondJson(req)) {
            return res.json({
                success: true,
                message: 'Đã cập nhật loại địa chỉ.',
                selectedId: addressTypeId,
                addressTypes: await addressTypeService.loadAddressTypes()
            });
        }
        res.redirect('/khach-hang?success=updated');
    } catch (error) {
        if (error.code === 'missing_address_type') return jsonAddressTypeError(req, res, 400, 'Vui lòng nhập tên loại địa chỉ.', 'missing_address_type');
        if (error.code === 'invalid_address_type') return jsonAddressTypeError(req, res, error.statusCode || 400, 'Không tìm thấy loại địa chỉ.', 'invalid_address_type');
        if (error.code === 'default_address_type') return jsonAddressTypeError(req, res, 400, 'Không thể sửa loại địa chỉ mặc định.', 'default_address_type');
        if (error.code === 'duplicate_address_type') return jsonAddressTypeError(req, res, 409, 'Tên loại địa chỉ đã tồn tại.', 'duplicate_address_type');
        if (shouldRespondJson(req)) return res.status(500).json({ success: false, message: 'Không thể cập nhật loại địa chỉ.' });
        next(error);
    }
};

exports.removeAddressType = async function(req, res, next) {
    try {
        var addressTypeId = normalizeIdParam(req?.params?.addressTypeId);
        if (!addressTypeId) return jsonAddressTypeError(req, res, 400, 'Loại địa chỉ không hợp lệ.', 'invalid_address_type');
        await addressTypeService.removeAddressType(addressTypeId);
        if (shouldRespondJson(req)) {
            return res.json({
                success: true,
                message: 'Đã xóa loại địa chỉ.',
                addressTypes: await addressTypeService.loadAddressTypes()
            });
        }
        res.redirect('/khach-hang?success=deleted');
    } catch (error) {
        if (error.code === 'invalid_address_type') return jsonAddressTypeError(req, res, error.statusCode || 400, 'Không tìm thấy loại địa chỉ.', 'invalid_address_type');
        if (error.code === 'default_address_type') return jsonAddressTypeError(req, res, 400, 'Không thể xóa loại địa chỉ mặc định.', 'default_address_type');
        if (shouldRespondJson(req)) return res.status(500).json({ success: false, message: 'Không thể xóa loại địa chỉ.' });
        next(error);
    }
};
