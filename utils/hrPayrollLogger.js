/**
 * Debug logger cho HR / Bảng lương / Thanh toán / Hủy phiếu lương.
 *
 * Bật server log:
 *   HR_PAYROLL_DEBUG=true npm start
 *
 * INFO/WARN/ERROR luôn in; DEBUG chỉ khi HR_PAYROLL_DEBUG=true.
 */

var mongoose = require('mongoose');

var DEBUG_ENABLED = process.env.HR_PAYROLL_DEBUG === 'true';

var SENSITIVE_KEYS = [
  'session', 'cookie', 'cookies', 'token', 'access_token', 'refresh_token',
  'password', 'secret', 'authorization', 'google_id'
];

var PAYROLL_BODY_ALLOW = [
  'ten_bang_luong', 'tu_ngay', 'den_ngay', 'ghi_chu',
  'so_tien', 'so_quy_id', 'phuong_thuc_thanh_toan', 'ly_do_huy',
  'keyword', 'trang_thai'
];

function isObjectId(value) {
  return value && mongoose.Types.ObjectId.isValid(String(value));
}

function idStr(value) {
  if (value == null) return undefined;
  if (isObjectId(value)) return String(value);
  if (value && value._id != null) return String(value._id);
  return String(value);
}

function sanitizeKey(key) {
  var lower = String(key || '').toLowerCase();
  if (SENSITIVE_KEYS.indexOf(lower) >= 0) return true;
  if (lower.indexOf('token') >= 0) return true;
  if (lower.indexOf('cookie') >= 0) return true;
  return false;
}

function serializeValue(value, depth) {
  depth = depth || 0;
  if (depth > 6) return '[MaxDepth]';
  if (value == null) return value;
  if (value instanceof Date) return value.toISOString();
  if (isObjectId(value)) return String(value);
  if (value && value._bsontype === 'ObjectId') return String(value);
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      code: value.code
    };
  }
  if (Array.isArray(value)) {
    if (value.length > 50) {
      return value.slice(0, 50).map(function(item) {
        return serializeValue(item, depth + 1);
      }).concat(['...+' + (value.length - 50) + ' more']);
    }
    return value.map(function(item) {
      return serializeValue(item, depth + 1);
    });
  }
  if (typeof value === 'object') {
    var out = {};
    Object.keys(value).forEach(function(key) {
      if (sanitizeKey(key)) return;
      if (key === 'user' || key === 'req' || key === 'res') return;
      out[key] = serializeValue(value[key], depth + 1);
    });
    return out;
  }
  if (typeof value === 'string' && value.length > 500) {
    return value.slice(0, 500) + '...';
  }
  return value;
}

function formatPayload(data) {
  if (!data || typeof data !== 'object') return '{}';
  try {
    return JSON.stringify(serializeValue(data));
  } catch (err) {
    return JSON.stringify({ serialize_error: err.message });
  }
}

function writeLine(level, event, data) {
  var line = '[HR_PAYROLL][' + level + '][' + event + '] ' + formatPayload(data || {});
  if (level === 'ERROR') console.error(line);
  else if (level === 'WARN') console.warn(line);
  else console.log(line);
}

function logPayrollInfo(event, data) {
  writeLine('INFO', event, data);
}

function logPayrollWarn(event, data) {
  writeLine('WARN', event, data);
}

function logPayrollDebug(event, data) {
  if (!DEBUG_ENABLED) return;
  writeLine('DEBUG', event, data);
}

function logPayrollError(event, err, data) {
  var payload = Object.assign({}, serializeValue(data || {}));
  if (err) {
    payload.error = {
      name: err.name,
      message: err.message,
      code: err.code
    };
    if (DEBUG_ENABLED && err.stack) payload.error.stack = err.stack;
    payload.error_reason = classifyPayrollError(err);
  }
  writeLine('ERROR', event, payload);
}

function classifyPayrollError(err) {
  var msg = String((err && err.message) || err || '').toLowerCase();
  var code = err && err.code;
  if (msg.indexOf('vuot qua') >= 0 || msg.indexOf('con can tra') >= 0) return 'overpay_or_ct_invalid';
  if (msg.indexOf('chua duoc chot') >= 0 || msg.indexOf('chi tiet') >= 0 && msg.indexOf('chot') >= 0) return 'ct_not_locked';
  if (msg.indexOf('bang luong da chot') >= 0 && msg.indexOf('chi thanh toan') < 0) return 'bl_state_invalid';
  if (msg.indexOf('chi thanh toan khi') >= 0) return 'bl_not_locked';
  if (msg.indexOf('so quy') >= 0) return 'cashbook_invalid_or_insufficient';
  if (msg.indexOf('transaction') >= 0 || msg.indexOf('replica set') >= 0) return 'transaction_unsupported';
  if (code === 11000 || msg.indexOf('duplicate key') >= 0 || msg.indexOf('ma_phieu') >= 0) return 'duplicate_ma_phieu';
  if (msg.indexOf('da duoc huy') >= 0 || msg.indexOf('khong hop le hoac') >= 0) return 'receipt_cancel_invalid_or_race';
  if (msg.indexOf('write conflict') >= 0) return 'race_write_conflict';
  if (msg.indexOf('khong cap nhat') >= 0) return 'atomic_update_no_match';
  return 'unknown';
}

function sanitizeUser(req) {
  var user = req && req.user;
  if (!user) return {};
  return {
    user_id: idStr(user._id || user.id),
    user_email: user.email || undefined
  };
}

function sanitizeBody(body) {
  body = body || {};
  var out = {};
  PAYROLL_BODY_ALLOW.forEach(function(key) {
    if (body[key] != null && body[key] !== '') out[key] = body[key];
  });
  if (body.ghi_chu != null) {
    var note = String(body.ghi_chu);
    out.ghi_chu = note.length > 120 ? note.slice(0, 120) + '...' : note;
  }
  return out;
}

function buildRequestContext(req) {
  return Object.assign({}, sanitizeUser(req), {
    method: req.method,
    path: req.originalUrl || req.url,
    route: req.route && req.route.path ? req.route.path : undefined,
    params: serializeValue(req.params || {}),
    query: serializeValue(req.query || {}),
    body: sanitizeBody(req.body),
    cua_hang_id: idStr(req.session && req.session.cua_hang_id) || idStr(req.user && req.user.cua_hang_id)
  });
}

function logEmployeeDetail(row) {
  var setup = row.snapshot_salary_setup || {};
  return {
    nhan_vien_id: idStr(row.nhan_vien_id),
    ma_nhan_vien: row.ma_nhan_vien,
    loai_luong: setup.loai_luong,
    tong_ca: row.tong_ca,
    tong_cong_quy_doi: row.tong_cong_quy_doi,
    tong_phut_lam_viec: row.tong_phut_lam_viec,
    luong_chinh: row.luong_chinh,
    phu_cap: row.tien_phu_cap,
    giam_tru: row.tien_giam_tru,
    tong_luong: row.tong_luong
  };
}

function logPayrollSummary(payroll) {
  if (!payroll) return {};
  return {
    bang_luong_id: idStr(payroll._id),
    trang_thai: payroll.trang_thai,
    tong_nhan_vien: payroll.tong_nhan_vien,
    tong_luong: payroll.tong_luong,
    da_tra_nhan_vien: payroll.da_tra_nhan_vien,
    con_can_tra: payroll.con_can_tra
  };
}

module.exports = {
  logPayrollInfo: logPayrollInfo,
  logPayrollWarn: logPayrollWarn,
  logPayrollError: logPayrollError,
  logPayrollDebug: logPayrollDebug,
  buildRequestContext: buildRequestContext,
  sanitizeBody: sanitizeBody,
  idStr: idStr,
  serializeValue: serializeValue,
  classifyPayrollError: classifyPayrollError,
  logEmployeeDetail: logEmployeeDetail,
  logPayrollSummary: logPayrollSummary,
  isDebugEnabled: function() { return DEBUG_ENABLED; }
};
