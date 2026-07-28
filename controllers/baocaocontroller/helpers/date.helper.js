const { pickQueryParam } = require('./query.helper');

function getDayRange(value) {
    const date = value ? new Date(`${value}T00:00:00`) : new Date();
    if (Number.isNaN(date.getTime())) {
        const now = new Date();
        const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        return {
            day,
            start: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
            end: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
        };
    }
    const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    return {
        day,
        start: new Date(date.getFullYear(), date.getMonth(), date.getDate()),
        end: new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1)
    };
}

function formatDateInput(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatDisplayDate(date) {
    return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
}


function getSalesRange(query = {}) {
    const fromStr = pickQueryParam(query.from);
    const toStr = pickQueryParam(query.to);
    const today = toStr ? new Date(`${toStr}T00:00:00`) : new Date();
    const endBase = Number.isNaN(today.getTime()) ? new Date() : today;
    let start;
    let end;

    if (fromStr && toStr) {
        start = new Date(`${fromStr}T00:00:00`);
        end = new Date(`${toStr}T00:00:00`);
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
            return getSalesRange({});
        }
        end = new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1);
    } else {
        end = new Date(endBase.getFullYear(), endBase.getMonth(), endBase.getDate() + 1);
        start = new Date(end);
        start.setDate(start.getDate() - 6);
    }

    const days = [];
    for (let cursor = new Date(start); cursor < end; cursor.setDate(cursor.getDate() + 1)) {
        days.push(new Date(cursor));
    }

    return {
        start,
        end,
        from: formatDateInput(start),
        to: formatDateInput(new Date(end.getFullYear(), end.getMonth(), end.getDate() - 1)),
        days
    };
}

module.exports = {
    getDayRange,
    getSalesRange,
    formatDateInput,
    formatDisplayDate
};
