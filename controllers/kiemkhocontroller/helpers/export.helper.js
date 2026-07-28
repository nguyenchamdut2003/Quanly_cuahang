function escapeCsv(value) {
    return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function buildCsvContent(rows) {
    return '\uFEFF' + rows.map(row => row.map(escapeCsv).join(',')).join('\r\n');
}

module.exports = { escapeCsv, buildCsvContent };
