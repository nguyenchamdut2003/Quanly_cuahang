module.exports = {
    ...require('./list.controller'),
    ...require('./detail.controller'),
    ...require('./crud.controller'),
    ...require('./debt.controller'),
    ...require('./group.controller'),
    ...require('./address.controller'),
    ...require('./addressType.controller'),
    ...require('./import.controller'),
    ...require('./export.controller')
};
