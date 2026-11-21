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

  var cashAmount = { $max: [0, { $ifNull: ['$chi_tiet_thanh_toan.tien_mat', 0] }] };
  var bankAmount = { $max: [0, { $ifNull: ['$chi_tiet_thanh_toan.chuyen_khoan', 0] }] };
  var cashRefund = { $max: [0, { $ifNull: ['$chi_tiet_thanh_toan.tien_tra_khach', 0] }] };
  var cashBook = { $ifNull: ['$chi_tiet_thanh_toan.so_quy_tien_mat_id', null] };
  var bankBook = { $ifNull: ['$chi_tiet_thanh_toan.so_quy_chuyen_khoan_id', null] };
  var isIncome = { $eq: ['$loai_phieu', 'thu'] };
  var isExpense = { $eq: ['$loai_phieu', 'chi'] };
  var hasDetailedPayment = {
    $or: [
      { $and: [{ $ne: [cashBook, null] }, { $or: [{ $gt: [cashAmount, 0] }, { $gt: [cashRefund, 0] }] }] },
      { $and: [{ $ne: [bankBook, null] }, { $gt: [bankAmount, 0] }] }
    ]
  };
  var rows = await PhieuThuChi.aggregate([
    {
      $match: {
        $or: [
          { so_quy_id: { $in: cashBookIds } },
          { 'chi_tiet_thanh_toan.so_quy_tien_mat_id': { $in: cashBookIds } },
          { 'chi_tiet_thanh_toan.so_quy_chuyen_khoan_id': { $in: cashBookIds } }
        ],
        trang_thai: { $ne: 'cancelled' },
        trang_thai_du_lieu: { $ne: 'inactive' },
        deleted_at: null
      }
    },
    {
      $project: {
        entries: {
          $cond: [hasDetailedPayment, [
            {
              so_quy_id: cashBook,
              tong_thu: { $cond: [isIncome, cashAmount, 0] },
              tong_chi: { $cond: [isExpense, cashAmount, { $cond: [isIncome, cashRefund, 0] }] }
            },
            {
              so_quy_id: bankBook,
              tong_thu: { $cond: [isIncome, bankAmount, 0] },
              tong_chi: { $cond: [isExpense, bankAmount, 0] }
            }
          ], [
            {
              so_quy_id: '$so_quy_id',
              tong_thu: { $cond: [isIncome, { $ifNull: ['$gia_tri', 0] }, 0] },
              tong_chi: { $cond: [isExpense, { $ifNull: ['$gia_tri', 0] }, 0] }
            }
          ]]
        }
      }
    },
    { $unwind: '$entries' },
    { $match: { 'entries.so_quy_id': { $in: cashBookIds } } },
    {
      $group: {
        _id: '$entries.so_quy_id',
        tong_thu: { $sum: '$entries.tong_thu' },
        tong_chi: { $sum: '$entries.tong_chi' }
      }
    }
  ]);

  rows.forEach(function(row) {
    var cashBookId = String(row && row._id || '');
    if (!cashBookId || !result[cashBookId]) return;
    result[cashBookId].tong_thu += Number(row.tong_thu || 0);
    result[cashBookId].tong_chi += Number(row.tong_chi || 0);
  });

  Object.keys(result).forEach(function(id) {
    result[id].so_du_tinh_toan = result[id].tong_thu - result[id].tong_chi;
  });

  return result;
}

module.exports = {
  calculateCashBookBalances
};
