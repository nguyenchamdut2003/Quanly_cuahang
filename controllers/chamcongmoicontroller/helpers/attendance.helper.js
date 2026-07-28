const { formatDate, formatAttendanceDayDisplay } = require('./date.helper');

function serializeAttendanceDays(rows) {
  return (Array.isArray(rows) ? rows : []).map(function(row) {
    return {
      ngay: formatDate(row.ngay_cham_cong),
      ngay_hien_thi: formatAttendanceDayDisplay(row.ngay_cham_cong),
      gio_vao: row.gio_vao || '',
      gio_ra: row.gio_ra || '',
      ghi_chu: row.ghi_chu || ''
    };
  });
}

module.exports = { serializeAttendanceDays };
