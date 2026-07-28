module.exports = {
    ...require('./list.controller'),
    ...require('./crud.controller'),
    ...require('./warehouse.controller'),
    ...require('./import.controller'),
    ...require('./export.controller')
};
