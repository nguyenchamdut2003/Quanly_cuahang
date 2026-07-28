const { DonHang, CTDonHang, KhachHang, NguoiDung } = require('../../../models/kiot.model');
const { getSalesRange } = require('../helpers/date.helper');

async function buildOrderReport(query = {}) {
    const range = getSalesRange(query);
    const orderFilter = {
        $or: [
            { ngay_dat: { $gte: range.start, $lt: range.end } },
            { ngay_tao: { $gte: range.start, $lt: range.end } }
        ]
    };

    if (query.status) orderFilter.trang_thai = query.status;
    if (query.creator?.trim()) {
        const creatorSearch = query.creator.trim();
        const creators = await NguoiDung.find({
            $or: [
                { ho_ten: { $regex: creatorSearch, $options: 'i' } },
                { email: { $regex: creatorSearch, $options: 'i' } },
                { sdt: { $regex: creatorSearch, $options: 'i' } }
            ]
        }).select('_id');
        orderFilter.nguoi_tao_id = { $in: creators.map(item => item._id) };
    }

    if (query.customer?.trim()) {
        const customerSearch = query.customer.trim();
        const customers = await KhachHang.find({
            $or: [
                { ma_khach_hang: { $regex: customerSearch, $options: 'i' } },
                { ten_khach_hang: { $regex: customerSearch, $options: 'i' } },
                { sdt: { $regex: customerSearch, $options: 'i' } }
            ]
        }).select('_id');
        orderFilter.khach_hang_id = { $in: customers.map(item => item._id) };
    }

    const orders = await DonHang.find(orderFilter)
        .populate('khach_hang_id')
        .populate('nguoi_tao_id')
        .sort({ ngay_dat: 1, ngay_tao: 1 });

    const orderIds = orders.map(item => item._id);
    let items = orderIds.length
        ? await CTDonHang.find({ don_hang_id: { $in: orderIds } }).populate('hang_hoa_id')
        : [];

    if (query.product?.trim()) {
        const productSearch = query.product.trim().toLowerCase();
        items = items.filter(item => {
            const product = item.hang_hoa_id || {};
            return String(product.ma_hang || '').toLowerCase().includes(productSearch)
                || String(product.ten_hang || '').toLowerCase().includes(productSearch);
        });
    }

    if (query.item_type?.trim()) {
        items = items.filter(item => String(item.hang_hoa_id?.loai_hang || '').toLowerCase().includes(query.item_type.trim().toLowerCase()));
    }

    const productMap = new Map();
    items.forEach(item => {
        const product = item.hang_hoa_id || {};
        const key = String(product._id || item.hang_hoa_id || item._id);
        const current = productMap.get(key) || {
            productId: key,
            code: product.ma_hang || '',
            name: product.ten_hang || 'Không xác định',
            quantity: 0,
            value: 0,
            orderCount: new Set()
        };
        current.quantity += Number(item.so_luong || 0);
        current.value += Number(item.thanh_tien || (Number(item.so_luong || 0) * Number(item.don_gia_ban || 0)));
        current.orderCount.add(String(item.don_hang_id));
        productMap.set(key, current);
    });

    const productRows = Array.from(productMap.values())
        .map(item => ({
            ...item,
            orderCount: item.orderCount.size
        }))
        .sort((a, b) => b.quantity - a.quantity || b.value - a.value);

    const topProducts = productRows.slice(0, 10);
    const totals = productRows.reduce((acc, row) => {
        acc.quantity += row.quantity;
        acc.value += row.value;
        acc.productCount += 1;
        return acc;
    }, { quantity: 0, value: 0, productCount: 0, orderCount: orders.length });

    return {
        generatedAt: new Date(),
        branchName: 'Cửa hàng trung tâm',
        range,
        orders,
        productRows,
        topProducts,
        totals,
        filters: query,
        viewMode: query.view === 'report' ? 'report' : 'chart'
    };
}

module.exports = {
    buildOrderReport
};

