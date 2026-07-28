const { resolveSalePrice } = require('../../services/salePrice.service');

module.exports = {
    ...require('./list.controller'),
    ...require('./detail.controller'),
    ...require('./crud.controller'),
    ...require('./trash.controller'),
    ...require('./group.controller'),
    ...require('./unit.controller'),
    ...require('./attribute.controller'),
    ...require('./price.controller'),
    ...require('./allocation.controller'),
    ...require('./report.controller'),
    ...require('./print.controller'),
    ...require('./export.controller'),
    resolveSalePrice
};

