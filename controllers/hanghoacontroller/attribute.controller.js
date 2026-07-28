const service = require('./services/attribute.service');

exports.attributesPage = function(req, res, next) {
    return service.attributesPage(req, res, next);
};

exports.addAttribute = function(req, res, next) {
    return service.addAttribute(req, res, next);
};

exports.updateAttribute = function(req, res, next) {
    return service.updateAttribute(req, res, next);
};

exports.deleteAttribute = function(req, res, next) {
    return service.deleteAttribute(req, res, next);
};

exports.addAttributeValue = function(req, res, next) {
    return service.addAttributeValue(req, res, next);
};

exports.updateAttributeValue = function(req, res, next) {
    return service.updateAttributeValue(req, res, next);
};

exports.deleteAttributeValue = function(req, res, next) {
    return service.deleteAttributeValue(req, res, next);
};

exports.apiAttributes = function(req, res, next) {
    return service.apiAttributes(req, res, next);
};

exports.apiCreateAttribute = function(req, res, next) {
    return service.apiCreateAttribute(req, res, next);
};

exports.apiUpdateAttribute = function(req, res, next) {
    return service.apiUpdateAttribute(req, res, next);
};

exports.apiDeleteAttribute = function(req, res, next) {
    return service.apiDeleteAttribute(req, res, next);
};

exports.apiAttributeValues = function(req, res, next) {
    return service.apiAttributeValues(req, res, next);
};

exports.apiCreateAttributeValue = function(req, res, next) {
    return service.apiCreateAttributeValue(req, res, next);
};

exports.apiUpdateAttributeValue = function(req, res, next) {
    return service.apiUpdateAttributeValue(req, res, next);
};

exports.apiDeleteAttributeValue = function(req, res, next) {
    return service.apiDeleteAttributeValue(req, res, next);
};

exports.apiProductAttributes = function(req, res, next) {
    return service.apiProductAttributes(req, res, next);
};



