module.exports = {
    ...require('./order.controller'),
    ...require('./invoice.controller'),
    ...require('./return.controller'),
    ...require('./shipment.controller'),
    ...require('./deliveryPartner.controller'),
    ...require('./merge.controller'),
    ...require('./legacy.controller'),
    ...require('./trash/orderTrash.controller'),
    ...require('./trash/invoiceTrash.controller'),
    ...require('./trash/returnTrash.controller'),
    ...require('./export/orderExport.controller'),
    ...require('./export/invoiceExport.controller'),
    ...require('./export/returnExport.controller'),
    ...require('./export/shipmentExport.controller'),
    ...require('./export/deliveryPartnerExport.controller')
};
