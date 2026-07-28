module.exports = {
    ...require('./list.controller'),
    ...require('./api.controller'),
    ...require('./crud.controller'),
    ...require('./warehouse.controller'),
    ...require('./import.controller'),
    ...require('./export.controller')
};
