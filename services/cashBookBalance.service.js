var mongoose = require('mongoose');
var { PhieuThuChi } = require('../models/kiot.model');

function toObjectId(value) {
  var raw = String(value || '').trim();
  if (!mongoose.Types.ObjectId.isValid(raw)) return null;
  return new mongoose.Types.ObjectId(raw);
}

function emptyBalance() {
  return {
    tong_thu: 0,
    tong_chi: 0,
    so_du_tinh_toan: 0
  };
}

async function calculateCashBookBalances(options) {
  options = options || {};
  var cashBookIds = Array.isArray(options.so_quy_ids)
    ? options.so_quy_ids.map(toObjectId).filter(Boolean)
    : [];

  var result = {};
  cashBookIds.forEach(function(id) {
    result[String(id)] = emptyBalance();
  });

  if (cashBookIds.length === 0) return result;

  var rows = await PhieuThuChi.aggregate([
    {
      $match: {
        so_quy_id: { $in: cashBookIds },
        trang_thai: { $ne: 'cancelled' }
      }
    },
    {
      $group: {
        _id: {
          so_quy_id: '$so_quy_id',
          loai_phieu: '$loai_phieu'
        },
        total: { $sum: { $ifNull: ['$gia_tri', 0] } }
      }
    }
  ]);

  rows.forEach(function(row) {
    var cashBookId = String(row && row._id && row._id.so_quy_id || '');
    var loaiPhieu = row && row._id && row._id.loai_phieu;
    if (!cashBookId || !result[cashBookId]) return;
    var total = Number(row.total || 0);
    if (loaiPhieu === 'thu') result[cashBookId].tong_thu += total;
    if (loaiPhieu === 'chi') result[cashBookId].tong_chi += total;
  });

  Object.keys(result).forEach(function(id) {
    result[id].so_du_tinh_toan = result[id].tong_thu - result[id].tong_chi;
  });

  return result;
}

module.exports = {
  calculateCashBookBalances
};
