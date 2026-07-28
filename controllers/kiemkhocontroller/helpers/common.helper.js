const { formatLotName } = require('../../../utils/kiemKhoDisplay');

function parseItems(rawItems) {
    if (Array.isArray(rawItems)) return rawItems;
    if (typeof rawItems === 'string' && rawItems.trim() !== '') {
        try {
            const parsed = JSON.parse(rawItems);
            return Array.isArray(parsed) ? parsed : [];
        } catch (_) {
            return [];
        }
    }
    return [];
}

function normalizeTenQuyCach(value) {
    return String(value || '').trim();
}

function lotDisplayFromPopulated(lo) {
    if (!lo) return '';
    return formatLotName(lo);
}

function isObjectId(value) {
    return /^[0-9a-fA-F]{24}$/.test(String(value || '').trim());
}

function normalizeKiemKhoIds(rawIds) {
    const list = Array.isArray(rawIds) ? rawIds : [rawIds];
    return [...new Set(list.map(id => String(id || '').trim()).filter(isObjectId))];
}

module.exports = {
    parseItems,
    normalizeTenQuyCach,
    lotDisplayFromPopulated,
    isObjectId,
    normalizeKiemKhoIds
};
