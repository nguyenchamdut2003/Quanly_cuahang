const {
    mongoose,
    getReservedQuantitiesByOrder,
    getReservedQuantitiesForSale,
    buildVariantKey,
    buildLotKey,
    querystring,
    path,
    HangHoa,
    NhomHang,
    DonViTinh,
    NhaCungCap,
    TonKho,
    Kho,
    BangGia,
    CTBangGia,
    CuaHang,
    LoHang,
    TonKhoLo,
    TonKhoLoQuyCach,
    LichSuKho,
    ThuocTinhHang,
    GiaTriThuocTinh,
    HangHoaThuocTinh,
    PhieuNhap,
    CTPhieuNhap,
    PhieuTraHangNhap,
    CTPhieuTraHangNhap,
    DonHang,
    CTDonHang,
    HoaDonBanHang,
    CTHoaDonBanHang,
    PhieuTraHang,
    CTPhieuTraHang,
    PhieuKiemKho,
    CTPhieuKiemKho,
    PhieuXuatHuy,
    CTXuatHuy,
    PhieuXuatNoiBo,
    CTXuatNoiBo,
    KhachHang,
    DiaChiKhachHang,
    VatChua,
    pdfService,
    buildLotProfitReport,
    submitStockAllocation,
    previewProductTrash,
    moveProductsToTrash,
    measureAsync,
    isPerformanceEnabled,
    resolveSalePrice,
    buildPriceSetupLines,
    upsertGiaBanHangHoa,
    formatDate,
    normalizeStockNumber,
    isExpiredLot,
    isSellableLot,
    normalizeFilterQuery,
    applyProductListStatusFilter,
    normalizeBangGiaIdsFromQuery,
    normalizePriceSetupQuery,
    buildPriceSetupQueryString,
    loadAvgLotCostByProductId,
    loadAvgSalePriceByProductId,
    buildProductListPriceMaps,
    applyProductListPriceFields,
    buildFilterQueryString,
    decodeLegacyEntities,
    normalizeProductNotePayload,
    normalizeProductPayload,
    normalizeAttributePayload,
    normalizeAttributeValuePayload,
    nextAttributeCode,
    nextAttributeValueCode,
    ensureDefaultAttributes,
    normalizeSelectedAttributeValues,
    saveProductAttributeValues,
    makeProductCode,
    makeLotCode,
    getDefaultWarehouseForProduct,
    createDefaultLotFromInventory,
    uniqueValues,
    mapBy,
    labelStockTransactionType,
    labelChungTuDocumentType,
    partnerName,
    unitPriceFromValue,
    enrichStockCardRows,
    filterTrashedKiemKhoStockRows,
    makeRangeFilter,
    normalizeIdParam,
    toDatetimeLocalValue,
    makeBangGiaCode,
    shouldRespondJson,
    escapeRegExp,
    loadProductGroups,
    findDuplicateGroupName,
    makeProductGroupCode,
    loadUnitOptions,
    makeUnitCode,
    resolveStoreId,
    respondUnitError,
    respondProductGroupError,
    getDateRange,
    buildProductQueryFromFilter,
    loadProductContractData,
    loadProductDetailById
} = require('../../helpers/common.helper');
function lotProfitQueryFromRequest(req) {
    return {
        hang_hoa_id: req.params.id,
        lo_hang_id: req.query.lo_hang_id,
        ngay_nhap_from: req.query.ngay_nhap_from,
        ngay_nhap_to: req.query.ngay_nhap_to,
        cua_hang_id: null
    };
}

async function apiLotProfitReport(req, res, next) {
    try {
        var storeId = await resolveStoreId(req);
        var query = lotProfitQueryFromRequest(req);
        query.cua_hang_id = storeId;
        var result = await buildLotProfitReport(query);
        if (!result.product) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy hàng hóa' });
        }
        res.json({ success: true, data: result });
    } catch (err) {
        res.status(err.status || err.statusCode || 500).json({
            success: false,
            message: err.message || 'Không tải được báo cáo lợi nhuận theo lô'
        });
    }
};

async function exportLotProfitReport(req, res, next) {
    try {
        var ExcelJS = require('exceljs');
        var storeId = await resolveStoreId(req);
        var query = lotProfitQueryFromRequest(req);
        query.cua_hang_id = storeId;
        var result = await buildLotProfitReport(query);
        if (!result.product) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy hàng hóa'
            });
        }

        var workbook = new ExcelJS.Workbook();
        var sheet = workbook.addWorksheet('Loi lo theo lo');
        sheet.columns = [
            { header: 'Ngày nhập lô', key: 'ngay_nhap', width: 16 },
            { header: 'Tên hàng', key: 'ten_hang', width: 28 },
            { header: 'Lô', key: 'lo', width: 20 },
            { header: 'Thuộc tính', key: 'quy_cach', width: 22 },
            { header: 'Số lượng nhập', key: 'so_luong_nhap', width: 14 },
            { header: 'Đơn giá nhập', key: 'don_gia_nhap', width: 14 },
            { header: 'Tổng giá vốn', key: 'tong_gia_von', width: 14 },
            { header: 'Số lượng xuất', key: 'so_luong_xuat', width: 14 },
            { header: 'Đơn giá xuất bình quân', key: 'don_gia_xuat_binh_quan', width: 18 },
            { header: 'Tổng doanh thu', key: 'tong_doanh_thu', width: 14 },
            { header: 'Lợi nhuận', key: 'loi_nhuan', width: 14 }
        ];

        var sumGv = 0;
        var sumDt = 0;
        var sumLn = 0;
        var sumSlXuat = 0;
        (result.rows || []).forEach(function(row) {
            sumGv += Number(row.tong_gia_von || 0);
            sumDt += Number(row.tong_doanh_thu || 0);
            sumLn += Number(row.loi_nhuan || 0);
            sumSlXuat += Number(row.so_luong_xuat || 0);
            sheet.addRow({
                ngay_nhap: row.ngay_nhap ? new Date(row.ngay_nhap) : '',
                ten_hang: row.ten_hang || '',
                lo: row.lo_hien_thi || '',
                quy_cach: row.ten_quy_cach || '',
                so_luong_nhap: row.so_luong_nhap,
                don_gia_nhap: row.don_gia_nhap,
                tong_gia_von: row.tong_gia_von,
                so_luong_xuat: row.so_luong_xuat,
                don_gia_xuat_binh_quan: row.don_gia_xuat_binh_quan,
                tong_doanh_thu: row.tong_doanh_thu,
                loi_nhuan: row.loi_nhuan
            });
        });
        if (result.rows && result.rows.length) {
            sheet.addRow({
                ngay_nhap: '',
                ten_hang: '',
                lo: '',
                quy_cach: 'Tổng',
                so_luong_nhap: '',
                don_gia_nhap: '',
                tong_gia_von: sumGv,
                so_luong_xuat: sumSlXuat,
                don_gia_xuat_binh_quan: '',
                tong_doanh_thu: sumDt,
                loi_nhuan: sumLn
            });
        }

        var filename = 'loi-lo-theo-lo-' + (result.product.ma_hang || result.product._id) + '.xlsx';
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
        await workbook.xlsx.write(res);
        res.end();
    } catch (err) {
        next(err);
    }
};


module.exports = { exportLotProfitReport };

