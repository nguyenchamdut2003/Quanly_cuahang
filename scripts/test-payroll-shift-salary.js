/* Quick sanity check for theo_ca payroll math (no DB). */
function money(value) {
  return Math.round(Number(value || 0));
}

function toNumber(value, fallback) {
  var num = Number(value);
  return Number.isFinite(num) ? num : (fallback || 0);
}

function normalizeCaId(value) {
  if (!value) return '';
  if (value && typeof value === 'object' && value._id) value = value._id;
  return String(value);
}

function getAdvancedSalarySetup(salarySetup, chamCongRow) {
  var advanced = salarySetup.muc_luong_nang_cao || {};
  var rows = Array.isArray(advanced.dieu_kien) ? advanced.dieu_kien : [];
  var caText = normalizeCaId(chamCongRow && chamCongRow.ca_lam_viec_id);
  if (caText) {
    var byId = rows.find(function(row) {
      return row && row.ca_lam_viec_id && normalizeCaId(row.ca_lam_viec_id) === caText;
    });
    if (byId) return byId;
  }
  var tenCa = String((chamCongRow && chamCongRow.ten_ca) || '').trim().toLowerCase();
  if (!tenCa) return null;
  return rows.find(function(row) {
    var rowName = String(row.ten_ca || row.ten_dieu_kien || '').trim().toLowerCase();
    return rowName && rowName === tenCa;
  }) || null;
}

function dayPayForBase(basePay) {
  return money(basePay);
}

function calcShiftSalary(salarySetup, chamCongs) {
  return chamCongs.reduce(function(total, row) {
    if (row.trang_thai === 'nghi_lam') return total;
    var condition = getAdvancedSalarySetup(salarySetup, row);
    var basePay = toNumber(condition && condition.muc_luong, 0) || toNumber(salarySetup.muc_luong, 0);
    return total + dayPayForBase(basePay);
  }, 0);
}

var salarySetup = {
  enabled: true,
  loai_luong: 'theo_ca',
  muc_luong: 200000,
  nang_cao: true,
  muc_luong_nang_cao: {
    dieu_kien: [
      { ca_lam_viec_id: 'aaaaaaaaaaaaaaaaaaaaaaa1', ten_ca: 'Ca Chiều', muc_luong: 250000 },
      { ca_lam_viec_id: 'aaaaaaaaaaaaaaaaaaaaaaa2', ten_ca: 'Ca Sáng', muc_luong: 200000 },
      { ca_lam_viec_id: 'aaaaaaaaaaaaaaaaaaaaaaa3', ten_ca: 'Ca Tối', muc_luong: 400000 }
    ]
  }
};

var chamCongs = [
  { trang_thai: 'dung_gio', ca_lam_viec_id: 'aaaaaaaaaaaaaaaaaaaaaaa2', ten_ca: 'Ca Sáng', cong_quy_doi: 0.5, so_phut_lam_viec: 240 },
  { trang_thai: 'dung_gio', ca_lam_viec_id: 'aaaaaaaaaaaaaaaaaaaaaaa2', ten_ca: 'Ca Sáng', cong_quy_doi: 0.5, so_phut_lam_viec: 240 }
];

var luong = calcShiftSalary(salarySetup, chamCongs);
if (luong !== 400000) {
  console.error('FAIL expected 400000 got', luong);
  process.exit(1);
}
console.log('PASS calcShiftSalary NV000002 scenario =', luong);
