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
} = require('../helpers/common.helper');
async function priceSetup(req, res, next) {
    try {
        var requestQuery = req?.query || {};
        var filter = normalizePriceSetupQuery(requestQuery);

        var conditions = [];
        if (filter.groupId !== 'all') conditions.push({ nhom_hang_id: filter.groupId });
        if (filter.keyword) {
            conditions.push({
                $or: [
                    { ma_hang: { $regex: filter.keyword, $options: 'i' } },
                    { ten_hang: { $regex: filter.keyword, $options: 'i' } }
                ]
            });
        }
        if (filter.filterMa) conditions.push({ ma_hang: { $regex: filter.filterMa, $options: 'i' } });
        if (filter.filterTen) conditions.push({ ten_hang: { $regex: filter.filterTen, $options: 'i' } });
        var productQuery = conditions.length === 0 ? {} : conditions.length === 1 ? conditions[0] : { $and: conditions };

        var allProducts = await HangHoa.find(productQuery)
            .sort({ created_at: -1, ma_hang: 1 })
            .lean();
        var productIds = allProducts.map(function(item) { return item._id; });

        var inventoryRows = productIds.length > 0
            ? await TonKho.aggregate([
                { $match: { hang_hoa_id: { $in: productIds } } },
                { $group: { _id: '$hang_hoa_id', total: { $sum: { $ifNull: ['$so_luong', 0] } } } }
            ])
            : [];
        var inventoryMap = inventoryRows.reduce(function(map, row) {
            map[String(row._id)] = Number(row.total || 0);
            return map;
        }, {});

        var products = allProducts.filter(function(item) {
            var qty = Number(inventoryMap[String(item._id)] || 0);
            if (filter.stock === 'co_ton') return qty > 0;
            if (filter.stock === 'het_hang') return qty <= 0;
            return true;
        });

        var groups = await loadProductGroups();
        var groupMap = groups.reduce(function(map, group) {
            map[String(group._id)] = group.ten_nhom_hang || '';
            return map;
        }, {});

        products = products.map(function(item) {
            item.ton_kho = Number(inventoryMap[String(item._id)] || 0);
            item.nhom_hang_ten = groupMap[String(item.nhom_hang_id || '')] || '---';
            return item;
        });

        var bangGiaList = await BangGia.find({}).sort({ ten_bang_gia: 1 }).lean();
        var selectedBangGiaOrdered = filter.bangGiaIds.map(function(id) {
            return bangGiaList.find(function(b) { return String(b._id) === id; });
        }).filter(Boolean);

        var primaryBangGiaId = selectedBangGiaOrdered.length === 1
            ? String(selectedBangGiaOrdered[0]._id)
            : (selectedBangGiaOrdered[0] ? String(selectedBangGiaOrdered[0]._id) : '');

        var storeId = await resolveStoreId(req);
        var allLines = await buildPriceSetupLines(products, {
            bang_gia_id: primaryBangGiaId || null,
            cua_hang_id: storeId
        });

        var total = allLines.length;
        var totalPages = Math.max(1, Math.ceil(total / filter.limit));
        if (filter.page > totalPages) filter.page = totalPages;
        var start = (filter.page - 1) * filter.limit;
        var pageItems = allLines.slice(start, start + filter.limit);

        var qs = function(overrides) {
            var merged = Object.assign({}, filter, overrides || {});
            if (merged.page < 1) merged.page = 1;
            return buildPriceSetupQueryString(merged);
        };

        var now = new Date();
        var defaultEnd = new Date(now);
        defaultEnd.setFullYear(defaultEnd.getFullYear() + 1);

        var pageTitleText = selectedBangGiaOrdered.length > 0
            ? String(selectedBangGiaOrdered.length) + ' báº£ng giÃ¡'
            : 'Thiáº¿t láº­p giÃ¡';

        res.render('hang-hoa/thiet-lap-gia', {
            title: 'Thiáº¿t láº­p giÃ¡',
            pageTitle: pageTitleText,
            activeMenu: 'hang-hoa',
            user: req.user,
            flash: requestQuery,
            priceLines: pageItems,
            products: pageItems,
            groups: groups,
            bangGiaList: bangGiaList,
            selectedBangGiaOrdered: selectedBangGiaOrdered,
            primaryBangGiaId: primaryBangGiaId,
            defaultNgayBatDau: toDatetimeLocalValue(now),
            defaultNgayKetThuc: toDatetimeLocalValue(defaultEnd),
            filter: filter,
            pagination: {
                total: total,
                page: filter.page,
                limit: filter.limit,
                totalPages: totalPages,
                from: total === 0 ? 0 : start + 1,
                to: Math.min(start + filter.limit, total)
            },
            qs: qs
        });
    } catch (error) {
        next(error);
    }
};

async function updateRetailPrice(req, res, next) {
    try {
        var productId = normalizeIdParam(req?.params?.id);
        if (!productId) {
            if (shouldRespondJson(req)) return res.status(400).json({ success: false, message: 'MÃ£ hÃ ng khÃ´ng há»£p lá»‡.' });
            return res.redirect('/hang-hoa/thiet-lap-gia?error=invalid_product');
        }

        var giaRaw = Number(req?.body?.gia_co_dinh);
        var gia = Number.isFinite(giaRaw) && giaRaw >= 0 ? Math.floor(giaRaw) : 0;

        await HangHoa.findByIdAndUpdate(
            productId,
            {
                gia_co_dinh: gia > 0 ? gia : 0,
                loai_gia: gia > 0 ? 'co_dinh' : 'thi_truong'
            },
            { runValidators: true }
        );

        if (shouldRespondJson(req)) {
            return res.json({ success: true, gia_co_dinh: gia });
        }
        res.redirect('/hang-hoa/thiet-lap-gia?success=updated');
    } catch (error) {
        next(error);
    }
};

async function upsertGiaBanHangHoaPrice(req, res, next) {
    try {
        var body = req.body || {};
        var storeId = await resolveStoreId(req);
        var doc = await upsertGiaBanHangHoa({
            cua_hang_id: storeId,
            bang_gia_id: body.bang_gia_id,
            hang_hoa_id: body.hang_hoa_id,
            lo_hang_id: body.lo_hang_id,
            gia_tri_thuoc_tinh_id: body.gia_tri_thuoc_tinh_id,
            ten_quy_cach: body.ten_quy_cach,
            gia_co_dinh: body.gia_co_dinh,
            gia_thi_truong: body.gia_thi_truong,
            loai_ap_dung: body.loai_ap_dung,
            gia_mac_dinh: body.gia_mac_dinh,
            cho_phep_sua_gia: body.cho_phep_sua_gia
        });

        if (shouldRespondJson(req)) {
            return res.json({ success: true, data: doc });
        }
        res.redirect('/hang-hoa/thiet-lap-gia?success=updated_gia_ban');
    } catch (error) {
        if (shouldRespondJson(req)) {
            return res.status(400).json({ success: false, message: error.message || 'LÆ°u giÃ¡ tháº¥t báº¡i.' });
        }
        next(error);
    }
};

async function updateCTBangGiaPrice(req, res, next) {
    try {
        var bangGiaId = normalizeIdParam(req?.body?.bang_gia_id);
        var hangHoaId = normalizeIdParam(req?.body?.hang_hoa_id);
        if (
            !bangGiaId ||
            !hangHoaId ||
            !mongoose.Types.ObjectId.isValid(bangGiaId) ||
            !mongoose.Types.ObjectId.isValid(hangHoaId)
        ) {
            if (shouldRespondJson(req)) {
                return res.status(400).json({ success: false, message: 'Thiáº¿u hoáº·c sai mÃ£ báº£ng giÃ¡ / hÃ ng hÃ³a.' });
            }
            return res.redirect('/hang-hoa/thiet-lap-gia?error=invalid_ct');
        }

        var giaRaw = Number(req?.body?.gia_ban);
        var giaBan = Number.isFinite(giaRaw) && giaRaw >= 0 ? Math.floor(giaRaw) : 0;

        await CTBangGia.findOneAndUpdate(
            { bang_gia_id: bangGiaId, hang_hoa_id: hangHoaId },
            { $set: { bang_gia_id: bangGiaId, hang_hoa_id: hangHoaId, gia_ban: giaBan, gia_goc: 0 } },
            { upsert: true, new: true, runValidators: true }
        );

        if (shouldRespondJson(req)) {
            return res.json({ success: true, gia_ban: giaBan });
        }
        res.redirect('/hang-hoa/thiet-lap-gia');
    } catch (error) {
        next(error);
    }
};

async function addBangGia(req, res, next) {
    try {
        var body = req.body || {};
        var ten = String(body.ten_bang_gia || '').trim();
        if (!ten) {
            if (shouldRespondJson(req)) {
                return res.status(400).json({ success: false, message: 'Vui lÃ²ng nháº­p tÃªn báº£ng giÃ¡.' });
            }
            return res.redirect('/hang-hoa/thiet-lap-gia?error=missing_bang_gia_name');
        }

        var trangThai = body.trang_thai === 'draft' ? 'draft' : 'active';

        var ngayBatDau = null;
        var ngayKetThuc = null;
        if (body.ngay_bat_dau) {
            var d1 = new Date(String(body.ngay_bat_dau));
            if (!isNaN(d1.getTime())) ngayBatDau = d1;
        }
        if (body.ngay_ket_thuc) {
            var d2 = new Date(String(body.ngay_ket_thuc));
            if (!isNaN(d2.getTime())) ngayKetThuc = d2;
        }

        var nguonCoSo = String(body.nguon_co_so || 'gia_von').trim();
        var nguonGia = 'gia_von';
        var bangGiaGocId = null;
        if (nguonCoSo.indexOf('bang:') === 0) {
            var gid = nguonCoSo.slice(5).trim();
            if (gid && mongoose.Types.ObjectId.isValid(gid)) {
                nguonGia = 'bang_gia_khac';
                bangGiaGocId = gid;
            }
        } else if (['gia_von', 'gia_nhap_cuoi'].indexOf(nguonCoSo) >= 0) {
            nguonGia = nguonCoSo;
        }

        var phepTinh = body.phep_tinh === 'tru' ? 'tru' : 'cong';
        var kieu = body.kieu_dieu_chinh === 'phan_tram' ? 'phan_tram' : 'vnd';
        var giaTriRaw = Number(body.gia_tri_dieu_chinh);
        var giaTri = Number.isFinite(giaTriRaw) && giaTriRaw >= 0 ? giaTriRaw : 0;

        var cashierFlexible = body.cashier_mode !== 'strict';
        var canhBao = cashierFlexible && (
            body.canh_bao_hang_ngoai === '1' ||
            body.canh_bao_hang_ngoai === true ||
            body.canh_bao_hang_ngoai === 'true'
        );

        var doc = {
            ma_bang_gia: await makeBangGiaCode(),
            ten_bang_gia: ten,
            ngay_bat_dau: ngayBatDau,
            ngay_ket_thuc: ngayKetThuc,
            trang_thai: trangThai,
            nguon_gia: nguonGia,
            phep_tinh: phepTinh,
            kieu_dieu_chinh: kieu,
            gia_tri_dieu_chinh: giaTri,
            cho_phep_hang_ngoai_bang_gia: cashierFlexible,
            canh_bao_hang_ngoai_bang_gia: canhBao
        };

        if (nguonGia === 'bang_gia_khac' && bangGiaGocId) {
            doc.bang_gia_goc_id = bangGiaGocId;
        }

        if (req.user && req.user.cua_hang_id) {
            doc.cua_hang_id = req.user.cua_hang_id;
        }
        if (req.user && req.user._id) {
            doc.nguoi_tao_id = req.user._id;
        }

        var created = await BangGia.create(doc);

        if (shouldRespondJson(req)) {
            return res.json({
                success: true,
                message: 'ÄÃ£ táº¡o báº£ng giÃ¡.',
                id: String(created._id),
                ma_bang_gia: created.ma_bang_gia
            });
        }
        res.redirect('/hang-hoa/thiet-lap-gia?success=created_bang_gia');
    } catch (error) {
        next(error);
    }
};

// â”€â”€â”€ EXCEL EXPORT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Supported column keys and their definitions
var HANG_HOA_COLUMNS = {
    loai_hang:       { header: 'Loáº¡i hÃ ng',           width: 16 },
    ma_hang:         { header: 'MÃ£ hÃ ng',              width: 16 },
    ten_hang:        { header: 'TÃªn hÃ ng',             width: 30 },
    thuong_hieu:     { header: 'ThÆ°Æ¡ng hiá»‡u',          width: 18 },
    nhom_hang:       { header: 'NhÃ³m hÃ ng',            width: 20 },
    hinh_anh:        { header: 'HÃ¬nh áº£nh',             width: 20 },
    dang_kinh_doanh: { header: 'Äang kinh doanh',      width: 16 },
    ban_truc_tiep:   { header: 'ÄÆ°á»£c bÃ¡n trá»±c tiáº¿p',   width: 18 },
    gia_von_trung_binh: { header: 'GiÃ¡ vá»‘n trung bÃ¬nh', width: 18, numeric: true },
    gia_ban_trung_binh: { header: 'GiÃ¡ bÃ¡n trung bÃ¬nh', width: 18 },
    ton_kho:         { header: 'Tá»“n kho',              width: 12, numeric: true },
    kh_dat:          { header: 'KH Ä‘áº·t',               width: 12, numeric: true },
    du_kien_het:     { header: 'Dá»± kiáº¿n háº¿t hÃ ng',     width: 18 },
    ton_nho_nhat:    { header: 'Tá»“n nhá» nháº¥t',         width: 14, numeric: true },
    ton_lon_nhat:    { header: 'Tá»“n lá»›n nháº¥t',         width: 14, numeric: true },
    dvt:             { header: 'ÄVT',                  width: 10 },
    ma_dvt_co_ban:   { header: 'MÃ£ ÄVT cÆ¡ báº£n',        width: 14 },
    quy_doi:         { header: 'Quy Ä‘á»•i',              width: 12, numeric: true },
    gia_nhap_cuoi:   { header: 'GiÃ¡ nháº­p cuá»‘i',        width: 16, numeric: true }
};


module.exports = { priceSetup, updateRetailPrice, upsertGiaBanHangHoaPrice, updateCTBangGiaPrice, addBangGia };


