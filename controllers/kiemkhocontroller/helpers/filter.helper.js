function getSelectedStatuses(query) {
    if (Array.isArray(query.trang_thai)) return query.trang_thai;
    if (query.trang_thai) return String(query.trang_thai).split(',').filter(Boolean);
    return ['pending', 'completed'];
}

function buildKiemKhoFilter(query = {}) {
    const filter = activeKiemKhoDocumentFilter();
    const q = String(query.q || '').trim();
    const dateMode = query.date_mode || 'this_month';
    const statuses = getSelectedStatuses(query);

    if (q) {
        filter.ma_kiem_kho = { $regex: q, $options: 'i' };
    }

    if (statuses.length) {
        filter.trang_thai = { $in: statuses };
    }

    if (query.nguoi_tao_id) {
        filter.nguoi_tao_id = query.nguoi_tao_id;
    }

    const now = new Date();
    if (dateMode === 'this_month') {
        filter.created_at = {
            $gte: new Date(now.getFullYear(), now.getMonth(), 1),
            $lt: new Date(now.getFullYear(), now.getMonth() + 1, 1)
        };
    } else if (dateMode === 'custom' && (query.from_date || query.to_date)) {
        filter.created_at = {};
        if (query.from_date) filter.created_at.$gte = new Date(query.from_date);
        if (query.to_date) {
            const toDate = new Date(query.to_date);
            toDate.setDate(toDate.getDate() + 1);
            filter.created_at.$lt = toDate;
        }
    }

    return { filter, q, dateMode, statuses };
}

function activeKiemKhoDocumentFilter(extra) {
    return Object.assign({ trang_thai_du_lieu: { $ne: 'inactive' } }, extra || {});
}

module.exports = {
    getSelectedStatuses,
    buildKiemKhoFilter,
    activeKiemKhoDocumentFilter
};
