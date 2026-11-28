const { lotHasQuyCachStock } = require('../../../services/kho.service');

async function shouldSyncQuyCach(khoId, hangHoaId, loHangId, tenQuyCach) {
    if (tenQuyCach) return true;
    return lotHasQuyCachStock(khoId, hangHoaId, loHangId || null);
}

module.exports = { shouldSyncQuyCach };
