function escapeCsvValue(value) {
    return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

module.exports = {
    escapeCsvValue
};
