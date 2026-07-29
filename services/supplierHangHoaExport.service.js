const mongoose = require('mongoose');
const ExcelJS = require('exceljs');
const {
    HangHoa,
    TonKho,
    TonKhoLo,
    PhieuNhap,
    CTPhieuNhap,
    CTHoaDonBanHang,
    BangGia,
    CTBangGia
} = require('../models/kiot.model');

const SUPPLIER_PRODUCT_COLUMNS = [
    { key: 'ma_hang', header: 'Mã hàng', width: 16 },
    { key: 'ten_hang', header: 'Tên hàng', width: 32 },
    { key: 'loai_hang', header: 'Loại hàng', width: 18 },
    { key: 'nhom_hang', header: 'Nhóm hàng', width: 22 },
    { key: 'ma_nhom_hang', header: 'Mã nhóm hàng', width: 14 },
    { key: 'thuong_hieu', header: 'Thương hiệu', width: 18 },
    { key: 'nha_cung_cap', header: 'Nhà cung cấp (trên hàng)', width: 26 },
    { key: 'dvt', header: 'ĐVT', width: 10 },
    { key: 'ma_dvt', header: 'Mã ĐVT', width: 12 },
    { key: 'gia_von', header: 'Giá vốn', width: 14, numeric: true },
    { key: 'gia_von_tb', header: 'Giá vốn TB (tồn lô)', width: 16, numeric: true },
    { key: 'gia_nhap_cuoi', header: 'Giá nhập cuối', width: 14, numeric: true },
    { key: 'loai_gia', header: 'Loại giá bán', width: 14 },
    { key: 'gia_co_dinh', header: 'Giá cố định', width: 14, numeric: true },
    { key: 'gia_ban_tb', header: 'Giá bán TB', width: 14, numeric: true },
    { key: 'ton_kho', header: 'Tồn kho', width: 12, numeric: true },
    { key: 'quan_ly_theo_lo', header: 'Quản lý theo lô', width: 14 },
    { key: 'han_sd_mac_dinh', header: 'Hạn SD mặc định (ngày)', width: 18, numeric: true },
    { key: 'ban_truc_tiep', header: 'Bán trực tiếp', width: 14 },
    { key: 'trang_thai', header: 'Đang kinh doanh', width: 16 },
    { key: 'mo_ta', header: 'Mô tả', width: 36 },
    { key: 'ghi_chu_dat_hang', header: 'Ghi chú đặt hàng', width: 28 },
    { key: 'hinh_anh', header: 'Hình ảnh (URL)', width: 28 },
    { key: 'ngay_tao', header: 'Ngày tạo', width: 20 },
    { key: 'ngay_cap_nhat', header: 'Ngày cập nhật', width: 20 }
];

function formatExportDate(value) {
    if (!value) return '';
    return new Date(value).toLocaleString('vi-VN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });
}

function mapLoaiGia(value) {
    return value === 'co_dinh' ? 'Giá cố định' : 'Giá thị trường';
}

function mapTrangThaiHang(value) {
    return value === 'active' ? 'Có' : 'Không';
}

async function loadAvgLotCostByProductId(productIds) {
    const map = {};
    if (!productIds.length) return map;
    const rows = await TonKhoLo.aggregate([
        { $match: { hang_hoa_id: { $in: productIds }, so_luong: { $gt: 0 } } },
        {
            $lookup: {
                from: 'lo_hang',
                localField: 'lo_hang_id',
                foreignField: '_id',
                as: 'lot'
            }
        },
        { $unwind: '$lot' },
        {
            $lookup: {
                from: 'phieu_nhap',
                localField: 'lot.phieu_nhap_id',
                foreignField: '_id',
                as: 'purchase'
            }
        },
        { $unwind: { path: '$purchase', preserveNullAndEmptyArrays: true } },
        {
            $match: {
                $or: [
                    { 'lot.phieu_nhap_id': null },
                    { 'lot.phieu_nhap_id': { $exists: false } },
                    { 'purchase.deleted_at': null },
                    { 'purchase.deleted_at': { $exists: false } }
                ]
            }
        },
        {
            $group: {
                _id: '$hang_hoa_id',
                totalQty: { $sum: { $ifNull: ['$so_luong', 0] } },
                totalValue: {
                    $sum: {
                        $multiply: [
                            { $ifNull: ['$so_luong', 0] },
                            { $ifNull: ['$gia_von', 0] }
                        ]
                    }
                }
            }
        }
    ]);
    rows.forEach((row) => {
        const totalQty = Number(row.totalQty || 0);
        const totalValue = Number(row.totalValue || 0);
        map[String(row._id)] = totalQty > 0 ? Math.round(totalValue / totalQty) : 0;
    });
    return map;
}

async function loadAvgSalePriceByProductId(productIds) {
    const map = {};
    if (!productIds.length) return map;
    const rows = await CTHoaDonBanHang.aggregate([
        { $match: { hang_hoa_id: { $in: productIds }, so_luong: { $gt: 0 } } },
        {
            $lookup: {
                from: 'hoa_don_ban_hang',
                localField: 'hoa_don_id',
                foreignField: '_id',
                as: 'invoice'
            }
        },
        { $unwind: '$invoice' },
        {
            $lookup: {
                from: 'don_hang',
                localField: 'invoice.don_hang_id',
                foreignField: '_id',
                as: 'order'
            }
        },
        { $unwind: { path: '$order', preserveNullAndEmptyArrays: true } },
        {
            $match: {
                'invoice.trang_thai': { $ne: 'cancelled' },
                $and: [
                    {
                        $or: [
                            { 'invoice.deleted_at': null },
                            { 'invoice.deleted_at': { $exists: false } }
                        ]
                    },
                    {
                        $or: [
                            { 'invoice.don_hang_id': null },
                            { 'invoice.don_hang_id': { $exists: false } },
                            { 'order.deleted_at': null },
                            { 'order.deleted_at': { $exists: false } }
                        ]
                    }
                ]
            }
        },
        {
            $group: {
                _id: '$hang_hoa_id',
                totalQty: { $sum: { $ifNull: ['$so_luong', 0] } },
                totalRevenue: {
                    $sum: {
                        $multiply: [
                            { $ifNull: ['$so_luong', 0] },
                            { $ifNull: ['$don_gia', 0] }
                        ]
                    }
                }
            }
        }
    ]);
    rows.forEach((row) => {
        const totalQty = Number(row.totalQty || 0);
        const totalRevenue = Number(row.totalRevenue || 0);
        map[String(row._id)] = totalQty > 0 ? Math.round(totalRevenue / totalQty) : null;
    });
    return map;
}

async function collectSupplierProductIds(supplierId, storeId) {
    const supplierOid = new mongoose.Types.ObjectId(String(supplierId));
    const directQuery = { nha_cung_cap_id: supplierOid };
    if (storeId && mongoose.Types.ObjectId.isValid(storeId)) {
        directQuery.cua_hang_id = new mongoose.Types.ObjectId(String(storeId));
    }

    const [directIds, phieuIds] = await Promise.all([
        HangHoa.find(directQuery).distinct('_id'),
        (async () => {
            const pnMatch = { nha_cung_cap_id: supplierOid, trang_thai: 'completed', deleted_at: null };
            if (storeId && mongoose.Types.ObjectId.isValid(storeId)) {
                pnMatch.cua_hang_id = new mongoose.Types.ObjectId(String(storeId));
            }
            return PhieuNhap.find(pnMatch).distinct('_id');
        })()
    ]);

    let fromPurchaseIds = [];
    if (phieuIds.length) {
        fromPurchaseIds = await CTPhieuNhap.distinct('hang_hoa_id', {
            phieu_nhap_id: { $in: phieuIds },
            hang_hoa_id: { $exists: true, $ne: null }
        });
    }

    const idSet = new Set();
    directIds.forEach((id) => idSet.add(String(id)));
    fromPurchaseIds.forEach((id) => idSet.add(String(id)));
    return Array.from(idSet).map((id) => new mongoose.Types.ObjectId(id));
}

function buildProductExportRow(item, context) {
    const pid = String(item._id);
    const tonKho = Number(context.inventoryMap[pid] || 0);
    const giaVonTb = context.avgLotCostMap[pid];
    const giaBanTb = context.avgSalePriceMap[pid];
    const bangGiaCols = {};
    (context.bangGias || []).forEach((bg) => {
        const bid = String(bg._id);
        bangGiaCols['bg_' + bid] = Number(context.ctMap[pid] && context.ctMap[pid][bid] ? context.ctMap[pid][bid] : 0);
    });

    return Object.assign({
        ma_hang: item.ma_hang || '',
        ten_hang: item.ten_hang || '',
        loai_hang: item.quan_ly_theo_lo ? 'Quản lý theo lô' : 'Hàng hóa thường',
        nhom_hang: item.nhom_hang_id?.ten_nhom_hang || '',
        ma_nhom_hang: item.nhom_hang_id?.ma_nhom_hang || '',
        thuong_hieu: item.thuong_hieu_id?.ten_thuong_hieu || '',
        nha_cung_cap: item.nha_cung_cap_id?.ten_ncc || context.supplierLabel || '',
        dvt: item.don_vi_tinh_id?.ten_don_vi || '',
        ma_dvt: item.don_vi_tinh_id?.ma_don_vi || '',
        gia_von: Number(item.gia_von || 0),
        gia_von_tb: giaVonTb != null ? Number(giaVonTb) : Number(item.gia_von || 0),
        gia_nhap_cuoi: Number(item.gia_nhap_cuoi || 0),
        loai_gia: mapLoaiGia(item.loai_gia),
        gia_co_dinh: Number(item.gia_co_dinh || 0),
        gia_ban_tb: giaBanTb == null ? '' : Number(giaBanTb),
        ton_kho: tonKho,
        quan_ly_theo_lo: item.quan_ly_theo_lo ? 'Có' : 'Không',
        han_sd_mac_dinh: Number(item.han_su_dung_mac_dinh_so_ngay || 0),
        ban_truc_tiep: item.ban_truc_tiep ? 'Có' : 'Không',
        trang_thai: mapTrangThaiHang(item.trang_thai),
        mo_ta: item.mo_ta || '',
        ghi_chu_dat_hang: item.ghi_chu_dat_hang || '',
        hinh_anh: item.anh_san_pham || '',
        ngay_tao: formatExportDate(item.created_at),
        ngay_cap_nhat: formatExportDate(item.updated_at)
    }, bangGiaCols);
}

function applyWorksheetFormat(worksheet, numericKeys) {
    const headerRow = worksheet.getRow(1);
    headerRow.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: 'FF111827' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAF3FF' } };
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    });
    worksheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: worksheet.columnCount }
    };
    worksheet.views = [{ state: 'frozen', ySplit: 1 }];

    worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        numericKeys.forEach((key) => {
            const col = worksheet.getColumn(key);
            if (!col || !col.number) return;
            const cell = row.getCell(col.number);
            if (cell.value !== '' && cell.value != null) {
                cell.numFmt = '#,##0';
            }
        });
    });
}

async function buildSupplierHangHoaExportPack(supplier, storeId) {
    const supplierLabel = supplier.ten_ncc || supplier.ma_ncc || '';
    const productIds = await collectSupplierProductIds(supplier._id, storeId);

    const workbook = new ExcelJS.Workbook();
    const wsInfo = workbook.addWorksheet('NCC');
    wsInfo.columns = [
        { header: 'Mã NCC', key: 'ma_ncc', width: 14 },
        { header: 'Tên NCC', key: 'ten_ncc', width: 30 }
    ];
    wsInfo.addRow({ ma_ncc: supplier.ma_ncc || '', ten_ncc: supplierLabel });
    wsInfo.getRow(1).font = { bold: true };

    const ws = workbook.addWorksheet('Danh sách hàng hóa');

    const bangGiaQuery = { trang_thai: 'active' };
    if (storeId && mongoose.Types.ObjectId.isValid(storeId)) {
        bangGiaQuery.cua_hang_id = storeId;
    }
    const bangGias = await BangGia.find(bangGiaQuery).sort({ created_at: 1 }).limit(20).lean();

    const excelColumns = SUPPLIER_PRODUCT_COLUMNS.slice();
    bangGias.forEach((bg) => {
        excelColumns.push({
            key: 'bg_' + bg._id,
            header: bg.ten_bang_gia || bg.ma_bang_gia || 'Bảng giá',
            width: 18,
            numeric: true
        });
    });
    ws.columns = excelColumns;

    if (!productIds.length) {
        applyWorksheetFormat(ws, []);
        const safeMa = String(supplier.ma_ncc || 'ncc').replace(/[^\w.-]+/g, '-');
        return { workbook, filename: 'ncc-' + safeMa + '-danh-sach-hang-hoa.xlsx' };
    }

    const products = await HangHoa.find({ _id: { $in: productIds } })
        .populate({ path: 'nhom_hang_id', select: 'ten_nhom_hang ma_nhom_hang' })
        .populate({ path: 'don_vi_tinh_id', select: 'ten_don_vi ma_don_vi' })
        .populate({ path: 'thuong_hieu_id', select: 'ten_thuong_hieu' })
        .populate({ path: 'nha_cung_cap_id', select: 'ten_ncc ma_ncc' })
        .sort({ ma_hang: 1, ten_hang: 1 })
        .lean();

    const inventoryRows = await TonKho.aggregate([
        { $match: { hang_hoa_id: { $in: productIds } } },
        { $group: { _id: '$hang_hoa_id', total: { $sum: { $ifNull: ['$so_luong', 0] } } } }
    ]);
    const inventoryMap = {};
    inventoryRows.forEach((row) => {
        inventoryMap[String(row._id)] = Number(row.total || 0);
    });

    const [avgLotCostMap, avgSalePriceMap] = await Promise.all([
        loadAvgLotCostByProductId(productIds),
        loadAvgSalePriceByProductId(productIds)
    ]);

    const ctMap = {};
    if (bangGias.length) {
        const bangGiaIds = bangGias.map((bg) => bg._id);
        const ctRows = await CTBangGia.find({
            bang_gia_id: { $in: bangGiaIds },
            hang_hoa_id: { $in: productIds }
        }).lean();
        ctRows.forEach((row) => {
            const pid = String(row.hang_hoa_id);
            const bid = String(row.bang_gia_id);
            if (!ctMap[pid]) ctMap[pid] = {};
            ctMap[pid][bid] = Number(row.gia_ban || 0);
        });
    }

    const context = {
        supplierLabel,
        inventoryMap,
        avgLotCostMap,
        avgSalePriceMap,
        bangGias,
        ctMap
    };

    products.forEach((item) => {
        ws.addRow(buildProductExportRow(item, context));
    });

    const numericKeys = excelColumns.filter((col) => col.numeric).map((col) => col.key);
    applyWorksheetFormat(ws, numericKeys);

    const safeMa = String(supplier.ma_ncc || 'ncc').replace(/[^\w.-]+/g, '-');
    return { workbook, filename: 'ncc-' + safeMa + '-danh-sach-hang-hoa.xlsx' };
}

module.exports = {
    buildSupplierHangHoaExportPack,
    collectSupplierProductIds
};
