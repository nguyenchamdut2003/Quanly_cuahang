var { DonHang, HoaDonBanHang, PhieuTraHang, CongNoKhachHang } = require('../../../models/kiot.model');

async function loadCustomerHistory(customerId) {
    if (!customerId) {
        return { orders: [], invoices: [], returns: [], debts: [] };
    }

    var query = { khach_hang_id: customerId };
    var orders = await DonHang.find(query)
        .sort({ ngay_dat: -1, created_at: -1 })
        .limit(50)
        .lean();
    var invoices = await HoaDonBanHang.find(query)
        .populate('don_hang_id')
        .sort({ ngay_ban: -1, created_at: -1 })
        .limit(50)
        .lean();
    var returns = await PhieuTraHang.find(Object.assign({}, query, { deleted_at: null }))
        .populate('hoa_don_id')
        .sort({ ngay_tra: -1, created_at: -1 })
        .limit(50)
        .lean();
    var debts = await CongNoKhachHang.find(query)
        .populate('hoa_don_id')
        .populate('don_hang_id')
        .populate('phieu_thu_chi_id')
        .sort({ ngay: -1, created_at: -1 })
        .limit(80)
        .lean();

    return {
        orders: orders,
        invoices: invoices,
        returns: returns,
        debts: debts
    };
}

async function loadFullCustomerHistory(customerId) {
    if (!customerId) {
        return { orders: [], invoices: [], returns: [], debts: [] };
    }

    var query = { khach_hang_id: customerId };
    var orders = await DonHang.find(query)
        .sort({ ngay_dat: -1, created_at: -1 })
        .lean();
    var invoices = await HoaDonBanHang.find(query)
        .populate('don_hang_id')
        .sort({ ngay_ban: -1, created_at: -1 })
        .lean();
    var returns = await PhieuTraHang.find(Object.assign({}, query, { deleted_at: null }))
        .populate('hoa_don_id')
        .sort({ ngay_tra: -1, created_at: -1 })
        .lean();
    var debts = await CongNoKhachHang.find(query)
        .populate('hoa_don_id')
        .populate('don_hang_id')
        .populate('phieu_thu_chi_id')
        .sort({ ngay: -1, created_at: -1 })
        .lean();

    return {
        orders: orders,
        invoices: invoices,
        returns: returns,
        debts: debts
    };
}


module.exports = {
    loadCustomerHistory,
    loadFullCustomerHistory
};

