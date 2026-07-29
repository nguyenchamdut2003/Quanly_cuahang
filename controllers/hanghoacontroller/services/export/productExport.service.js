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
  loadActiveInventoryTotalsByProductId,
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
  loadProductDetailById,
} = require("../../helpers/common.helper");
var HANG_HOA_COLUMNS = {
  loai_hang: { header: "Loại hàng", width: 16 },
  ma_hang: { header: "Mã hàng", width: 16 },
  ten_hang: { header: "Tên hàng", width: 30 },
  thuong_hieu: { header: "Thương hiệu", width: 18 },
  nhom_hang: { header: "Nhóm hàng", width: 20 },
  hinh_anh: { header: "Hình ảnh", width: 20 },
  dang_kinh_doanh: { header: "Đang kinh doanh", width: 16 },
  ban_truc_tiep: { header: "Được bán trực tiếp", width: 18 },

  gia_von_trung_binh: {
    header: "Giá vốn trung bình",
    width: 18,
    numeric: true,
  },

  gia_ban_trung_binh: {
    header: "Giá bán trung bình",
    width: 18,
  },

  ton_kho: { header: "Tồn kho", width: 12, numeric: true },
  kh_dat: { header: "KH đặt", width: 12, numeric: true },
  du_kien_het: { header: "Dự kiến hết hàng", width: 18 },
  ton_nho_nhat: { header: "Tồn nhỏ nhất", width: 14, numeric: true },
  ton_lon_nhat: { header: "Tồn lớn nhất", width: 14, numeric: true },
  dvt: { header: "ĐVT", width: 10 },
  ma_dvt_co_ban: { header: "Mã ĐVT cơ bản", width: 14 },
  quy_doi: { header: "Quy đổi", width: 12, numeric: true },
  gia_nhap_cuoi: { header: "Giá nhập cuối", width: 16, numeric: true },
};

async function exportExcel(req, res, next) {
  try {
    var ExcelJS = require("exceljs");

    // --- 1. Validate selected columns ---
    var rawCols = req.body.columns;
    if (!rawCols) rawCols = [];
    if (!Array.isArray(rawCols)) rawCols = [rawCols];
    var selectedKeys = rawCols
      .map(function (k) {
        return String(k || "").trim();
      })
      .filter(function (k) {
        return !!HANG_HOA_COLUMNS[k];
      });

    if (selectedKeys.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Vui lòng chọn ít nhất 1 cột để xuất.",
      });
    }
    // --- 2. Build product query from current filters (matching index behavior) ---
    var filter = normalizeFilterQuery(req.body);
    var dateRange = getDateRange(filter);
    var productQuery = {};

    if (filter.groupId !== "all") productQuery.nhom_hang_id = filter.groupId;
    if (filter.supplierId !== "all")
      productQuery.nha_cung_cap_id = filter.supplierId;
    if (filter.salesLink === "yes") productQuery.ban_truc_tiep = true;
    if (filter.salesLink === "no") productQuery.ban_truc_tiep = false;
    applyProductListStatusFilter(productQuery, filter);
    if (filter.keyword) {
      productQuery.$or = [
        { ma_hang: { $regex: filter.keyword, $options: "i" } },
        { ten_hang: { $regex: filter.keyword, $options: "i" } },
      ];
    }
    if (dateRange.start || dateRange.end) {
      productQuery.created_at = {};
      if (dateRange.start) productQuery.created_at.$gte = dateRange.start;
      if (dateRange.end) productQuery.created_at.$lte = dateRange.end;
    }

    // --- 3. Query HangHoa with all related models ---
    var needStock =
      selectedKeys.indexOf("ton_kho") >= 0 ||
      selectedKeys.indexOf("kh_dat") >= 0 ||
      selectedKeys.indexOf("du_kien_het") >= 0;

    var products = await HangHoa.find(productQuery)
      .populate({ path: "nhom_hang_id", select: "ten_nhom_hang ma_nhom_hang" })
      .populate({ path: "don_vi_tinh_id", select: "ten_don_vi ma_don_vi" })
      .populate({ path: "thuong_hieu_id", select: "ten_thuong_hieu" })
      .populate({ path: "nha_cung_cap_id", select: "ten_ncc" })
      .sort({ created_at: -1, ma_hang: 1 })
      .lean();

    var inventoryMap = {};
    if (needStock && products.length > 0) {
      var productIds = products.map(function (p) {
        return p._id;
      });
      var lotManagedProductIds = products
        .filter(function (p) {
          return !!p.quan_ly_theo_lo;
        })
        .map(function (p) {
          return p._id;
        });
      inventoryMap = await loadActiveInventoryTotalsByProductId(productIds, lotManagedProductIds);
    }

    // Apply stock range filter if needed
    var stockRange = makeRangeFilter(filter.stockFrom, filter.stockTo);
    if (stockRange && needStock) {
      products = products.filter(function (item) {
        var qty = Number(inventoryMap[String(item._id)] || 0);
        if (
          Object.prototype.hasOwnProperty.call(stockRange, "$gte") &&
          qty < stockRange.$gte
        )
          return false;
        if (
          Object.prototype.hasOwnProperty.call(stockRange, "$lte") &&
          qty > stockRange.$lte
        )
          return false;
        return true;
      });
    }

    var exportProductIds = products.map(function (item) {
      return item._id;
    });
    var exportPriceMaps = await buildProductListPriceMaps(exportProductIds);
    products.forEach(function (item) {
      item.gia_ban_hien_thi = Number(item.gia_co_dinh || 0);
      applyProductListPriceFields(item, exportPriceMaps);
    });

    // --- 4. Resolve selected Price Books ---
    var bangGiaIds = normalizeBangGiaIdsFromQuery(req.body);
    var selectedBangGias = [];
    var ctMap = {}; // product_id -> bang_gia_id -> price

    if (bangGiaIds.length > 0 && products.length > 0) {
      selectedBangGias = await BangGia.find({
        _id: { $in: bangGiaIds },
      }).lean();
      // Sort by request order
      selectedBangGias.sort(function (a, b) {
        return (
          bangGiaIds.indexOf(String(a._id)) - bangGiaIds.indexOf(String(b._id))
        );
      });

      var allProductIds = products.map(function (p) {
        return p._id;
      });
      var ctRows = await CTBangGia.find({
        bang_gia_id: { $in: bangGiaIds },
        hang_hoa_id: { $in: allProductIds },
      }).lean();

      ctRows.forEach(function (row) {
        var pid = String(row.hang_hoa_id);
        var bid = String(row.bang_gia_id);
        if (!ctMap[pid]) ctMap[pid] = {};
        ctMap[pid][bid] = Number(row.gia_ban || 0);
      });
    }

    // --- 5. Build workbook ---
    var workbook = new ExcelJS.Workbook();
    var worksheet = workbook.addWorksheet("Danh sách hàng hóa");

    // Define columns
    var excelColumns = selectedKeys.map(function (key) {
      var def = HANG_HOA_COLUMNS[key];
      return { header: def.header, key: key, width: def.width };
    });

    // Add Price Book columns
    selectedBangGias.forEach(function (bg) {
      var key = "bg_" + bg._id;
      excelColumns.push({
        header: bg.ten_bang_gia,
        key: key,
        width: 18,
      });
    });

    worksheet.columns = excelColumns;

    // Header styling
    worksheet.getRow(1).eachCell(function (cell) {
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFD6E4F7" },
      };
      cell.font = { bold: true, size: 11 };
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.border = {
        bottom: { style: "thin", color: { argb: "FF9DC3E6" } },
      };
    });
    worksheet.getRow(1).height = 20;
    worksheet.autoFilter = {
      from: "A1",
      to: String.fromCharCode(64 + excelColumns.length) + "1",
    };
    worksheet.views = [{ state: "frozen", ySplit: 1 }];

    // --- 6. Add data rows ---
    products.forEach(function (item) {
      var tonKho = needStock ? Number(inventoryMap[String(item._id)] || 0) : 0;
      var rowData = {};

      selectedKeys.forEach(function (key) {
        switch (key) {
          case "loai_hang":
            rowData[key] = item.quan_ly_theo_lo
              ? "Quản lý theo lô"
              : "Hàng hóa thông thường";
            break;
          case "ma_hang":
            rowData[key] = item.ma_hang || "";
            break;
          case "ten_hang":
            rowData[key] = item.ten_hang || "";
            break;
          case "thuong_hieu":
            rowData[key] =
              item.thuong_hieu_id && item.thuong_hieu_id.ten_thuong_hieu
                ? item.thuong_hieu_id.ten_thuong_hieu
                : "";
            break;
          case "nhom_hang":
            rowData[key] =
              item.nhom_hang_id && item.nhom_hang_id.ten_nhom_hang
                ? item.nhom_hang_id.ten_nhom_hang
                : "";
            break;
          case "hinh_anh":
            rowData[key] = item.anh_san_pham || "";
            break;
          case "dang_kinh_doanh":
            rowData[key] = item.trang_thai === "active" ? "Có" : "Không";
            break;
          case "ban_truc_tiep":
            rowData[key] = item.ban_truc_tiep ? "Có" : "Không";
            break;
          case "gia_von_trung_binh":
            rowData[key] = Number(
              item.gia_von_trung_binh_hien_thi != null
                ? item.gia_von_trung_binh_hien_thi
                : item.gia_von || 0,
            );
            break;
          case "gia_ban_trung_binh":
            rowData[key] =
              item.gia_ban_trung_binh_hien_thi == null
                ? "---"
                : Number(item.gia_ban_trung_binh_hien_thi || 0);
            break;
          case "ton_kho":
            rowData[key] = tonKho;
            break;
          case "kh_dat":
            rowData[key] = 0;
            break;
          case "du_kien_het":
            rowData[key] = "";
            break;
          case "ton_nho_nhat":
            rowData[key] = Number(item.dinh_muc_toi_thieu || 0);
            break;
          case "ton_lon_nhat":
            rowData[key] = 0;
            break;
          case "dvt":
            rowData[key] =
              item.don_vi_tinh_id && item.don_vi_tinh_id.ten_don_vi
                ? item.don_vi_tinh_id.ten_don_vi
                : "";
            break;
          case "ma_dvt_co_ban":
            rowData[key] =
              item.don_vi_tinh_id && item.don_vi_tinh_id.ma_don_vi
                ? item.don_vi_tinh_id.ma_don_vi
                : "";
            break;
          case "quy_doi":
            rowData[key] = 1;
            break;
          case "gia_nhap_cuoi":
            rowData[key] = Number(item.gia_nhap_cuoi || 0);
            break;
          default:
            rowData[key] = "";
        }
      });

      // Map Price Books
      var pid = String(item._id);
      selectedBangGias.forEach(function (bg) {
        var bid = String(bg._id);
        var key = "bg_" + bid;
        rowData[key] = ctMap[pid] && ctMap[pid][bid] ? ctMap[pid][bid] : 0;
      });

      var row = worksheet.addRow(rowData);

      // Numeric formatting
      excelColumns.forEach(function (col, colIndex) {
        var key = col.key;
        if (
          (HANG_HOA_COLUMNS[key] && HANG_HOA_COLUMNS[key].numeric) ||
          key.indexOf("bg_") === 0
        ) {
          row.getCell(colIndex + 1).numFmt = "#,##0";
        }
      });
    });

    // --- 7. Stream response ---
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="danh-sach-hang-hoa.xlsx"',
    );
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    next(error);
  }
}

module.exports = { exportExcel };
