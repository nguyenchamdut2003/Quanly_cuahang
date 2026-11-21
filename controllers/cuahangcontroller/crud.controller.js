const { CuaHang } = require('../../models/kiot.model');
const { normalizeIdParam, normalizeStorePayload } = require('./helpers/common.helper');
const { makeStoreCode } = require('./helpers/code.helper');
const mongoose = require('mongoose');

const add = async function(req, res, next) {
    try {
        var payload = normalizeStorePayload(req?.body);

        if (!payload.ten_cua_hang) {
            return res.redirect('/cua-hang?mode=create&error=missing_name');
        }

        if (!payload.ma_cua_hang) {
            payload.ma_cua_hang = await makeStoreCode();
        }

        var store = await CuaHang.create(payload);
        res.redirect('/cua-hang?store=' + store._id + '&success=created');
    } catch (error) {
        if (error && error.code === 11000) {
            return res.redirect('/cua-hang?mode=create&error=duplicate_code');
        }

        next(error);
    }
};

const update = async function(req, res, next) {
    try {
        var storeId = normalizeIdParam(req?.params?.id);
        if (!storeId) return res.redirect('/cua-hang?error=invalid_store');

        var payload = normalizeStorePayload(req?.body);

        if (!payload.ten_cua_hang) {
            return res.redirect('/cua-hang?edit=' + storeId + '&error=missing_name');
        }

        if (!payload.ma_cua_hang) {
            delete payload.ma_cua_hang;
        }

        await CuaHang.findByIdAndUpdate(storeId, payload, { runValidators: true });
        res.redirect('/cua-hang?store=' + storeId + '&success=updated');
    } catch (error) {
        if (error && error.code === 11000) {
            return res.redirect('/cua-hang?error=duplicate_code');
        }

        next(error);
    }
};

const updateNotes = async function(req, res) {
    try {
        var storeId = normalizeIdParam(req?.params?.id);
        if (!mongoose.Types.ObjectId.isValid(storeId)) {
            return res.status(400).json({ success: false, message: 'Cửa hàng không hợp lệ.' });
        }
        if (typeof req?.body?.ghi_chu !== 'string') {
            return res.status(400).json({ success: false, message: 'Nội dung ghi chú không hợp lệ.' });
        }

        var notes = req.body.ghi_chu.trim();
        var store = await CuaHang.findByIdAndUpdate(
            storeId,
            { $set: { ghi_chu: notes } },
            { new: true, runValidators: true }
        ).select('_id ghi_chu').lean();
        if (!store) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy cửa hàng.' });
        }

        return res.json({
            success: true,
            message: notes ? 'Đã lưu ghi chú cửa hàng.' : 'Đã xóa ghi chú cửa hàng.',
            ghi_chu: store.ghi_chu || ''
        });
    } catch (error) {
        console.error('[StoreNotes]', error);
        return res.status(500).json({ success: false, message: 'Không thể lưu ghi chú cửa hàng. Vui lòng thử lại.' });
    }
};

module.exports = {
    add,
    update,
    updateNotes
};

