const service = require('./services/productTrash.service');

exports.previewTrash = function(req, res, next) {
    return service.previewTrash(req, res, next);
};

exports.moveToTrash = function(req, res, next) {
    return service.moveToTrash(req, res, next);
};



