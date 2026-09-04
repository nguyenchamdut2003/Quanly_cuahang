var mongoose = require('mongoose');
var { HoaDonBanHang, PhieuTraHang, CongNoKhachHang } = require('../../../models/kiot.model');

async function loadCustomerFinancialMetrics(customerIds) {
    var ids = Array.isArray(customerIds) ? customerIds.filter(Boolean) : [];
    if (!ids.length) return {};

    var salesRows = await HoaDonBanHang.aggregate([
        { $match: { khach_hang_id: { $in: ids }, trang_thai: { $ne: 'cancelled' } } },
        { $group: { _id: '$khach_hang_id', tong_ban: { $sum: { $ifNull: ['$tong_tien', 0] } } } }
    ]);
    var returnRows = await PhieuTraHang.aggregate([
        { $match: { khach_hang_id: { $in: ids }, trang_thai: { $ne: 'cancelled' } } },
        { $group: { _id: '$khach_hang_id', tong_tra_hang: { $sum: { $ifNull: ['$tong_tien_tra', 0] } } } }
    ]);
    var debtRows = await CongNoKhachHang.aggregate([
        { $match: { khach_hang_id: { $in: ids } } },
        {
            $group: {
                _id: '$khach_hang_id',
                tang_no: {
                    $sum: { $cond: [{ $eq: ['$loai', 'tang_no'] }, { $ifNull: ['$so_tien', 0] }, 0] }
                },
                giam_no: {
                    $sum: { $cond: [{ $in: ['$loai', ['giam_no', 'thanh_toan']] }, { $ifNull: ['$so_tien', 0] }, 0] }
                }
            }
        }
    ]);

    var map = {};
    ids.forEach(function(id) {
        map[String(id)] = { tong_ban: 0, tong_tra_hang: 0, tong_ban_tru_tra_hang: 0, tong_no: 0, tam_ung: 0, tong_no_cuoi: 0 };
    });
    salesRows.forEach(function(row) {
        if (!row || !row._id) return;
        var key = String(row._id);
        if (!map[key]) map[key] = { tong_ban: 0, tong_tra_hang: 0, tong_ban_tru_tra_hang: 0, tong_no: 0, tam_ung: 0, tong_no_cuoi: 0 };
        map[key].tong_ban = Number(row.tong_ban || 0);
    });
    returnRows.forEach(function(row) {
        if (!row || !row._id) return;
        var key = String(row._id);
        if (!map[key]) map[key] = { tong_ban: 0, tong_tra_hang: 0, tong_ban_tru_tra_hang: 0, tong_no: 0, tam_ung: 0, tong_no_cuoi: 0 };
        map[key].tong_tra_hang = Number(row.tong_tra_hang || 0);
    });
    debtRows.forEach(function(row) {
        if (!row || !row._id) return;
        var key = String(row._id);
        if (!map[key]) map[key] = { tong_ban: 0, tong_tra_hang: 0, tong_ban_tru_tra_hang: 0, tong_no: 0, tam_ung: 0, tong_no_cuoi: 0 };
        map[key].tong_no = Number(row.tang_no || 0) - Number(row.giam_no || 0);
    });
    Object.keys(map).forEach(function(key) {
        map[key].tong_ban_tru_tra_hang = Number(map[key].tong_ban || 0) - Number(map[key].tong_tra_hang || 0);
        map[key].tong_no_cuoi = Number(map[key].tong_no || 0) - Number(map[key].tam_ung || 0);
    });
    return map;
}

async function aggregateCustomerAdvanceBalances(customerIds, storeId) {
    var map = {};
    var PhieuTamUng;
    try {
        PhieuTamUng = require('../../../models/tamung.model').PhieuTamUng;
    } catch (err) {
        return map;
    }
    if (!PhieuTamUng) return map;

    var ids = (Array.isArray(customerIds) ? customerIds : [])
        .map(function(id) { return String(id || '').trim(); })
        .filter(function(id) { return mongoose.Types.ObjectId.isValid(id); })
        .map(function(id) { return new mongoose.Types.ObjectId(id); });
    if (!ids.length) return map;

    var match = {
        loai_doi_tuong: 'khach_hang',
        trang_thai_du_lieu: 'active',
        trang_thai: { $in: ['active', 'da_dung_het'] },
        khach_hang_id: { $in: ids },
        con_lai: { $gt: 0 }
    };
    if (storeId && mongoose.Types.ObjectId.isValid(String(storeId))) {
        match.cua_hang_id = new mongoose.Types.ObjectId(String(storeId));
    }

    var rows = await PhieuTamUng.aggregate([
        { $match: match },
        {
            $group: {
                _id: '$khach_hang_id',
                tam_ung: { $sum: { $ifNull: ['$con_lai', 0] } }
            }
        }
    ]);

    rows.forEach(function(row) {
        if (!row || !row._id) return;
        map[String(row._id)] = Math.max(0, Number(row.tam_ung || 0));
    });
    return map;
}

function applyCustomerAdvanceFromMap(customer, advanceMap) {
    if (!customer) return;
    var tamUng = advanceMap ? Number(advanceMap[String(customer._id)] || 0) : 0;
    customer.tam_ung = Math.max(0, tamUng);
    customer.tong_no_cuoi = Number(customer.tong_no || 0) - customer.tam_ung;
}

module.exports = {
    loadCustomerFinancialMetrics,
    aggregateCustomerAdvanceBalances,
    applyCustomerAdvanceFromMap
};
