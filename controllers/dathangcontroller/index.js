module.exports = {
    ...require('./order.controller'),
    ...require('./invoice.controller'),
    ...require('./return.controller'),
    ...require('./shipment.controller'),
    ...require('./merge.controller'),
    ...require('./legacy.controller'),
    ...require('./export/orderExport.controller'),
    ...require('./export/invoiceExport.controller'),
    ...require('./export/returnExport.controller'),
    ...require('./export/shipmentExport.controller')
};
