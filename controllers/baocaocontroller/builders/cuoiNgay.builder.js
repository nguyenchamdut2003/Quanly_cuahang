const { CTHoaDonBanHang, HoaDonBanHang, KhachHang, NguoiDung, PhieuThuChi, PhieuTraHang } = require('../../../models/kiot.model');
const { getDayRange } = require('../helpers/date.helper');

async function buildEndOfDayReport(query = {}) {
    const { day, start, end } = getDayRange(query.date);
    const customerSearch = query.customer?.trim();
    const sellerSearch = query.seller?.trim();
    const creatorSearch = query.creator?.trim();

    const invoiceFilter = { ngay_ban: { $gte: start, $lt: end } };
    if (query.payment) invoiceFilter.phuong_thuc_tt = query.payment;
    if (customerSearch) {
        const customers = await KhachHang.find({
            $or: [
                { ma_khach_hang: { $regex: customerSearch, $options: 'i' } },
                { ten_khach_hang: { $regex: customerSearch, $options: 'i' } },
                { sdt: { $regex: customerSearch, $options: 'i' } }
            ]
        }).select('_id');
        invoiceFilter.khach_hang_id = { $in: customers.map(item => item._id) };
    }
    if (sellerSearch) {
        const sellers = await NguoiDung.find({
            $or: [
                { ho_ten: { $regex: sellerSearch, $options: 'i' } },
                { email: { $regex: sellerSearch, $options: 'i' } },
                { sdt: { $regex: sellerSearch, $options: 'i' } }
            ]
        }).select('_id');
        invoiceFilter.nguoi_ban_id = { $in: sellers.map(item => item._id) };
    }

    const [invoices, returns, receipts] = await Promise.all([
        HoaDonBanHang.find(invoiceFilter)
            .populate('khach_hang_id')
            .populate('nguoi_ban_id')
            .sort({ ngay_ban: 1 }),
        PhieuTraHang.find({ ngay_tra: { $gte: start, $lt: end } })
            .populate('hoa_don_id')
            .populate('khach_hang_id')
            .populate('nguoi_tao_id')
            .sort({ ngay_tra: 1 }),
        PhieuThuChi.find({ ngay_lap: { $gte: start, $lt: end } }).sort({ ngay_lap: 1 })
    ]);

    if (creatorSearch) {
        const creatorRegex = new RegExp(creatorSearch, 'i');
        const invoiceCreators = invoices.filter(item => creatorRegex.test(item.nguoi_ban_id?.ho_ten || '') || creatorRegex.test(item.nguoi_ban_id?.email || ''));
        invoices.splice(0, invoices.length, ...invoiceCreators);
    }

    const invoiceIds = invoices.map(item => item._id);
    const invoiceItems = invoiceIds.length
        ? await CTHoaDonBanHang.find({ hoa_don_id: { $in: invoiceIds } })
        : [];

    const qtyByInvoice = new Map();
    invoiceItems.forEach(item => {
        const id = String(item.hoa_don_id);
        qtyByInvoice.set(id, (qtyByInvoice.get(id) || 0) + Number(item.so_luong || 0));
    });

    const totalQuantity = invoiceItems.reduce((sum, item) => sum + Number(item.so_luong || 0), 0);
    const invoiceRevenue = invoices.reduce((sum, item) => sum + Number(item.tong_tien || 0), 0);
    const invoiceDiscount = invoices.reduce((sum, item) => sum + Number(item.giam_gia || 0), 0);
    const invoicePaid = invoices.reduce((sum, item) => sum + Number(item.thanh_toan || 0), 0);
    const returnTotal = returns.reduce((sum, item) => sum + Number(item.tong_tien_tra || 0), 0);
    const otherReceiptTotal = receipts
        .filter(item => item.loai_phieu === 'thu')
        .reduce((sum, item) => sum + Number(item.gia_tri || 0), 0);
    const otherPaymentTotal = receipts
        .filter(item => item.loai_phieu === 'chi')
        .reduce((sum, item) => sum + Number(item.gia_tri || 0), 0);

    return {
        date: day,
        generatedAt: new Date(),
        branchName: 'C?a hàng trung tâm',
        invoices,
        returns,
        receipts,
        qtyByInvoice,
        summary: {
            invoiceCount: invoices.length,
            returnCount: returns.length,
            totalQuantity,
            invoiceRevenue,
            invoiceDiscount,
            invoicePaid,
            returnTotal,
            otherReceiptTotal,
            otherPaymentTotal,
            netRevenue: invoicePaid - returnTotal + otherReceiptTotal - otherPaymentTotal
        },
        filters: query
    };
}

module.exports = {
    buildEndOfDayReport
};

