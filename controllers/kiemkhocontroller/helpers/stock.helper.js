const { lotHasQuyCachStock } = require('../../../services/kho.service');

async function shouldSyncQuyCach(khoId, hangHoaId, loHangId, tenQuyCach) {
    if (tenQuyCach) return true;
    if (!loHangId) return false;
    return lotHasQuyCachStock(khoId, hangHoaId, loHangId);
}

module.exports = { shouldSyncQuyCach };
