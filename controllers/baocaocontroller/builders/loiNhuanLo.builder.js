const { buildProfitByLotReport } = require('../../../services/profitReport.service');
const { getSalesRange } = require('../helpers/date.helper');

async function buildLotProfitAggregateReport(query = {}, store) {
    const range = getSalesRange(query);
    const storeId = query.cua_hang_id || (store && store._id ? String(store._id) : '');
    return buildProfitByLotReport(Object.assign({}, query, {
        range,
        cua_hang_id: storeId
    }));
}

module.exports = {
    buildLotProfitAggregateReport
};

