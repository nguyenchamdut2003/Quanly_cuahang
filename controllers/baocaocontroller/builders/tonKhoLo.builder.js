const { CuaHang, HangHoa, Kho, TonKhoLo } = require('../../../models/kiot.model');

async function buildLotStockReport(query = {}) {
    const filter = {};
    if (query.cua_hang_id) filter.cua_hang_id = query.cua_hang_id;
    if (query.kho_id) filter.kho_id = query.kho_id;
    if (query.hang_hoa_id) filter.hang_hoa_id = query.hang_hoa_id;

    const [rows, stores, warehouses, products] = await Promise.all([
        TonKhoLo.find(filter)
            .populate('hang_hoa_id')
            .populate('kho_id')
            .populate('lo_hang_id')
            .sort({ updated_at: -1 })
            .lean(),
        CuaHang.find().sort({ ten_cua_hang: 1 }).lean(),
        Kho.find({ trang_thai: 'active' }).sort({ ten_kho: 1 }).lean(),
        HangHoa.find({ trang_thai: 'active' }).sort({ ten_hang: 1 }).lean()
    ]);

    const reportRows = rows.map(row => {
        const product = row.hang_hoa_id || {};
        const lot = row.lo_hang_id || {};
        const quantity = Number(row.so_luong || row.so_luong_con_lai || 0);
        const cost = Number(row.gia_von || product.gia_von || 0);
        return {
            hang_hoa_id: product._id || row.hang_hoa_id,
            kho_id: row.kho_id?._id || row.kho_id,
            lo_hang_id: lot._id || row.lo_hang_id,
            ma_hang: product.ma_hang || '',
            ten_hang: product.ten_hang || '',
            kho: row.kho_id?.ten_kho || '',
            ma_lo: lot.ten_lo || lot.ma_lo || '',
            ngay_nhap: lot.ngay_nhap || row.created_at,
            han_su_dung: lot.han_su_dung,
            so_luong: quantity,
            gia_von: cost,
            tong_gia_tri: quantity * cost
        };
    });

    return {
        rows: reportRows,
        stores,
        warehouses,
        products,
        filters: query,
        totals: {
            quantity: reportRows.reduce((sum, row) => sum + row.so_luong, 0),
            value: reportRows.reduce((sum, row) => sum + row.tong_gia_tri, 0)
        }
    };
}

module.exports = {
    buildLotStockReport
};

