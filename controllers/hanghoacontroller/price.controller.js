const service = require('./services/priceSetup.service');

exports.priceSetup = function(req, res, next) {
    return service.priceSetup(req, res, next);
};

exports.updateRetailPrice = function(req, res, next) {
    return service.updateRetailPrice(req, res, next);
};

exports.upsertGiaBanHangHoaPrice = function(req, res, next) {
    return service.upsertGiaBanHangHoaPrice(req, res, next);
};

exports.updateCTBangGiaPrice = function(req, res, next) {
    return service.updateCTBangGiaPrice(req, res, next);
};

exports.addBangGia = function(req, res, next) {
    return service.addBangGia(req, res, next);
};



