const SUMMARY_EXPORT_COLUMNS = [
    { key: 'stt', header: 'STT', width: 8 },
    { key: 'ma_doi_tuong', header: 'Mã đối tượng', width: 16 },
    { key: 'ten_doi_tuong', header: 'Tên đối tượng', width: 28 },
    { key: 'so_du_dau_ky', header: 'Số dư đầu kỳ', width: 18, numeric: true },
    { key: 'phat_sinh_trong_ky', header: 'Phát sinh trong kỳ', width: 18, numeric: true },
    { key: 'da_tra_giam_trong_ky', header: 'Đã trả / Giảm trong kỳ', width: 20, numeric: true },
    { key: 'con_lai_cuoi_ky', header: 'Còn lại cuối kỳ', width: 18, numeric: true },
    { key: 'ghi_chu', header: 'Ghi chú', width: 36 }
];

function isIncreaseDebtLoai(loai) {
    return String(loai || '').trim() === 'tang_no';
}

function isDecreaseDebtLoai(loai) {
    const value = String(loai || '').trim();
    return value === 'giam_no' || value === 'thanh_toan';
}

function normalizeDebtPeriodQuery(query) {
    query = query || {};
    const rawMode = String(query.periodMode || query.period || 'all').trim().toLowerCase();
    const periodMode = rawMode === 'range' || rawMode === 'theo-ngay' || rawMode === 'theo_ngay' ? 'range' : 'all';

    if (periodMode === 'all') {
        return { periodMode: 'all', dateFrom: '', dateTo: '', error: null };
    }

    const dateFrom = String(query.dateFrom || '').trim();
    const dateTo = String(query.dateTo || '').trim();
    if (!dateFrom || !dateTo) {
        return { periodMode: 'range', dateFrom, dateTo, error: 'missing_dates' };
    }

    const start = new Date(dateFrom + 'T00:00:00');
    const end = new Date(dateTo + 'T23:59:59.999');
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        return { periodMode: 'range', dateFrom, dateTo, error: 'invalid_dates' };
    }
    if (start.getTime() > end.getTime()) {
        return { periodMode: 'range', dateFrom, dateTo, error: 'date_order' };
    }

    return {
        periodMode: 'range',
        dateFrom,
        dateTo,
        rangeStart: start,
        rangeEnd: end,
        fileSuffix: dateFrom.replace(/-/g, '') + '-' + dateTo.replace(/-/g, ''),
        error: null
    };
}

function getLedgerRowDate(row) {
    return row.ngay || row.created_at || row.ngay_giao_dich;
}

function aggregateLedgerByPeriod(rows, rangeStart, rangeEnd) {
    const startMs = rangeStart.getTime();
    const endMs = rangeEnd.getTime();
    let opening = 0;
    let periodIncrease = 0;
    let periodDecrease = 0;

    (Array.isArray(rows) ? rows : []).forEach((row) => {
        const dateValue = getLedgerRowDate(row);
        const rowDate = dateValue ? new Date(dateValue) : null;
        if (!rowDate || Number.isNaN(rowDate.getTime())) return;

        const amount = Math.max(0, Number(row.so_tien ?? row.gia_tri ?? 0));
        const ms = rowDate.getTime();
        const loai = row.loai || row.huong_cong_no;

        if (ms < startMs) {
            if (isIncreaseDebtLoai(loai)) opening += amount;
            if (isDecreaseDebtLoai(loai)) opening -= amount;
            return;
        }
        if (ms > endMs) return;

        if (isIncreaseDebtLoai(loai)) periodIncrease += amount;
        if (isDecreaseDebtLoai(loai)) periodDecrease += amount;
    });

    const closing = opening + periodIncrease - periodDecrease;
    return {
        opening: Math.floor(opening),
        periodIncrease: Math.floor(periodIncrease),
        periodDecrease: Math.floor(periodDecrease),
        closing: Math.floor(closing)
    };
}

function buildPeriodNote(period, kindLabel) {
    if (!period || period.periodMode !== 'range') return kindLabel || '';
    return (kindLabel || '') + ' — Kỳ ' + period.dateFrom + ' đến ' + period.dateTo;
}

module.exports = {
    SUMMARY_EXPORT_COLUMNS,
    isIncreaseDebtLoai,
    isDecreaseDebtLoai,
    normalizeDebtPeriodQuery,
    aggregateLedgerByPeriod,
    buildPeriodNote,
    getLedgerRowDate
};
