const { Kho } = require('../../models/kiot.model');
const { normalizeIdParam, normalizeWarehousePayload } = require('./helpers/common.helper');
const { makeWarehouseCode } = require('./helpers/code.helper');

const addWarehouse = async function(req, res, next) {
    try {
        var storeId = normalizeIdParam(req?.params?.id);
        if (!storeId) {
            return res.redirect('/cua-hang?error=invalid_store');
        }

        var payload = normalizeWarehousePayload(req?.body);
        if (!payload.ten_kho) {
            return res.redirect('/cua-hang?store=' + storeId + '&error=missing_warehouse_name');
        }

        if (!payload.ma_kho) {
            payload.ma_kho = await makeWarehouseCode();
        }

        payload.cua_hang_id = storeId;
        await Kho.create(payload);
        res.redirect('/cua-hang?store=' + storeId + '&success=created');
    } catch (error) {
        if (error && error.code === 11000) {
            return res.redirect('/cua-hang?store=' + req.params.id + '&error=duplicate_code');
        }
        next(error);
    }
};

const updateWarehouse = async function(req, res, next) {
    try {
        var payload = normalizeWarehousePayload(req?.body);
        var warehouseId = normalizeIdParam(req?.params?.warehouseId);
        var storeId = normalizeIdParam(req?.params?.id);

        if (!warehouseId || !storeId) {
            return res.redirect('/cua-hang?error=invalid_warehouse');
        }

        if (!payload.ten_kho) {
            return res.redirect('/cua-hang?store=' + storeId + '&error=missing_warehouse_name');
        }

        if (!payload.ma_kho) {
            delete payload.ma_kho;
        }

        await Kho.findOneAndUpdate(
            { _id: warehouseId, cua_hang_id: storeId },
            payload,
            { runValidators: true }
        );

        res.redirect('/cua-hang?store=' + storeId + '&success=updated');
    } catch (error) {
        if (error && error.code === 11000) {
            return res.redirect('/cua-hang?store=' + req.params.id + '&error=duplicate_code');
        }
        next(error);
    }
};

const removeWarehouse = async function(req, res, next) {
    try {
        var warehouseId = normalizeIdParam(req?.params?.warehouseId);
        var storeId = normalizeIdParam(req?.params?.id);

        if (!warehouseId || !storeId) {
            return res.redirect('/cua-hang?error=invalid_warehouse');
        }

        await Kho.findOneAndDelete({ _id: warehouseId, cua_hang_id: storeId });
        res.redirect('/cua-hang?store=' + storeId + '&success=deleted');
    } catch (error) {
        next(error);
    }
};

module.exports = {
    addWarehouse,
    updateWarehouse,
    removeWarehouse
};
