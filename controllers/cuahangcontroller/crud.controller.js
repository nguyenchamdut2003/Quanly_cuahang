const { CuaHang } = require('../../models/kiot.model');
const { normalizeIdParam, normalizeStorePayload } = require('./helpers/common.helper');
const { makeStoreCode } = require('./helpers/code.helper');

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

module.exports = {
    add,
    update
};

