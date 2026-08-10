const {
    DonHang,
    CTDonHang,
    HoaDonBanHang,
    CTHoaDonBanHang,
    PhieuTraHang,
    CTPhieuTraHang,
    HangHoa,
    KhachHang,
    DiaChiKhachHang,
    CuaHang,
    NguoiDung,
    DoiTacGiaoHang,
    BangGiaVanChuyen,
    VanDon,
    GopDonHang,
    GopHoaDon,
    PhieuThuChi,
    CongNoKhachHang,
    SoQuy,
    Kho,
    BangGia,
    CTBangGia,
    TonKho,
    TonKhoLo,
    TonKhoLoQuyCach,
    LoHang,
    Counter,
    VatChua,
    XuatVatChua,
    applyDeliveryPartnerWorksheetFormat,
    applyExportWorksheetFormat,
    applyIdIntersection,
    applyInvoiceDebtWarning,
    applyInvoiceDebtWarningList,
    applyInvoiceTotals,
    applyInvoiceWorksheetFormat,
    applyLotAllocationsToInvoiceLine,
    applyOrderIdFilter,
    applyOrderPaymentBalance,
    applyOrderTotals,
    applyReturnWorksheetFormat,
    applyShipmentWorksheetFormat,
    assertVatChuaImportInput,
    assertVatChuaSignedInput,
    buildCustomerPaymentReceiptPayload,
    buildDeliveryPartnerExportRow,
    buildFullOrderFilter,
    buildInvoiceExportRow,
    buildInvoiceFilter,
    buildLotKey,
    buildOrderExportRow,
    buildOrderFilter,
    buildReturnExportRow,
    buildReturnFilter,
    buildReturnStockLine,
    buildShipmentExportRow,
    buildShipmentFilter,
    buildShipmentOrderFilter,
    buildVariantKey,
    calcInvoiceDetailLineTotal,
    calcLineTotal,
    cancelNhapVatChuaBySource,
    cancelReturnSlip,
    cancelXuatVatChuaBySource,
    CHO_PHEP_DAT_AM_KHO,
    cleanArray,
    cloneMergedInvoiceLine,
    cloneMergedLine,
    computeDeliveryPaymentDue,
    computeNetPaidFromReceiptRows,
    computeOrderPaymentBalance,
    congTonKho,
    copyLineMetadata,
    createCustomerDebtTransaction,
    dateRange,
    decorateInvoices,
    deductStockForInvoiceLines,
    deductStockLine,
    DELIVERY_PARTNER_EXPORT_COLUMNS,
    DELIVERY_PARTNER_STATUS_MAP,
    deliveryStockKey,
    enrichInvoiceDebtInfo,
    ensureHoaDonDonHangIndex,
    escapedRegex,
    evaluateInvoiceDebtWarning,
    ExcelJS,
    expandReturnableInvoiceItems,
    exportAddress,
    exportCustomerName,
    exportCustomerPhone,
    exportInvoiceLotName,
    exportLotName,
    exportUserName,
    exportVatChuaWithInvoice,
    exportVatChuaWithOrderDelivery,
    exportVatChuaWithSalesReturn,
    filterInvoicesByDebtWarning,
    findReturnLotId,
    formatExportDate,
    formatInvoiceFilterMoneyDisplay,
    formatInvoiceLotText,
    formatLotAllocationLabel,
    formatLotDisplay,
    formatOrderLotText,
    formatStockQty,
    generateInvoiceCode,
    generateMergeInvoiceCode,
    generateMergeOrderCode,
    generateOrderCode,
    generateShipmentCode,
    getExpiredLotQuantity,
    getExpiredQuyCachQuantity,
    getInvoicePaidAmount,
    getOrderCreateData,
    getOrderExportColumnGroupsForView,
    getOrderInvoiceDebtSummary,
    getOrderLineActualStock,
    getOrderPaidAmount,
    getReservedQuantitiesForSale,
    getReturnableInvoiceIds,
    getSellableLotQuantity,
    getSellableLotStockRows,
    getSellableQuyCachQuantity,
    getSellableStock,
    hasInvoiceFilterValue,
    importVatChuaWithSalesReturn,
    intersectIdFilters,
    INVOICE_DEBT_WARN_DEFAULT_DAYS,
    INVOICE_EXPORT_COLUMNS,
    INVOICE_EXPORT_STATUS_MAP,
    INVOICE_STATUS_FILTER_VALUES,
    INVOICE_TIME_PERIOD_MONTHS,
    invoiceCustomerPhone,
    invoiceMergeLineKey,
    invoiceRemainDue,
    invoiceShipmentBlocksMerge,
    isEnabled,
    isExpiredStockLot,
    isPaymentBookObjectId,
    isSellableStockLot,
    legacyReturnLineKey,
    loadDeliveryPartnerExportData,
    loadInvoiceExportData,
    loadInvoiceLinkedVatChuaLines,
    loadInvoiceNetPaidMap,
    loadInvoiceVatChuaEditState,
    loadOrderExportData,
    loadOrderLinkedVatChuaLines,
    loadReturnExportData,
    loadReturnInvoiceContext,
    loadSalesReturnCopyDraft,
    loadSalesReturnLinkedNhapVatChuaLines,
    loadShipmentExportData,
    luuPhiVanChuyenKhachHang,
    mergeInvoiceLotAllocations,
    mergeInvoicesInSession,
    mergeLineKey,
    mergeOrdersInSession,
    mongoose,
    moveInvoicesToTrash,
    moveOrdersToTrash,
    moveReturnsToTrash,
    normalizeAddress,
    normalizeCustomerPaymentInput,
    normalizeDiscount,
    normalizeInvoiceDebtWarnSettings,
    normalizeInvoiceFilterMoneyField,
    normalizeInvoicePageFilters,
    normalizeInvoiceStatus,
    normalizeInvoiceStatusFilter,
    normalizeInvoiceTimePeriod,
    normalizePaymentMethodValue,
    normalizePhone,
    normalizeUnitPrice,
    optionalLineObjectId,
    ORDER_EXPORT_COLUMN_DEFS,
    ORDER_EXPORT_COLUMN_GROUPS,
    ORDER_EXPORT_COLUMN_MAP,
    ORDER_EXPORT_COLUMNS,
    ORDER_EXPORT_DELIVERY_STATUS_MAP,
    ORDER_EXPORT_LINE_DELIVERY_STATUS_MAP,
    ORDER_EXPORT_STATUS_MAP,
    orderCustomerPhone,
    parseCustomerPaymentFromRequest,
    parseInvoiceFilterMoney,
    parseInvoiceMoneyInput,
    parseItems,
    parseOrderDateInput,
    parseVatChuaImportInput,
    parseVatChuaSignedInput,
    pickOrderExportRowValues,
    previewInvoiceTrash,
    previewOrderTrash,
    previewReturnTrash,
    recalcInvoiceLineTotal,
    receiptRowsForNetPaidFilter,
    recordCustomerPaymentReceipts,
    recordSalesReturnRefundReceipt,
    resolveCashBookForPayment,
    resolveCashBookIdFromBody,
    resolveInvoiceStatus,
    resolveInvoiceTimePeriodRange,
    resolveOrderExportColumns,
    resolveOrderLineUnitPrice,
    resolvePaymentBooksFromBody,
    resolveReturnTotals,
    resolveSalePrice,
    resolveStoreId,
    restoreStockLine,
    RETURN_EXPORT_COLUMNS,
    RETURN_EXPORT_LINE_TYPE_MAP,
    RETURN_EXPORT_STATUS_MAP,
    returnStockLineKey,
    rollbackDeliveryInvoice,
    sameObjectIdValue,
    seedVanDonIfEmpty,
    sendDeliveryPartnerWorkbook,
    sendInvoiceWorkbook,
    sendOrderWorkbook,
    sendReturnWorkbook,
    sendShipmentWorkbook,
    SHIPMENT_COD_STATUS_MAP,
    SHIPMENT_EXPORT_COLUMNS,
    shipmentCustomerName,
    SHIPPING_FEE_PAYER_MAP,
    SHIPPING_PRICE_TYPE_MAP,
    sortStockLotsFefo,
    stockShortageMessage,
    taoPhieuThuChi,
    taoPhieuThuKhachHang,
    tinhPhiGiaoHang,
    toArray,
    truTonKho,
    uniqueObjectIds,
    userIdFilter,
    validateDeliveryStockPreflight,
    validateOrderAvailability,
    validatePaymentBooksForCustomer
} = require('./helpers/common.helper');

const ORDER_PAGE_SIZE = 10;

function parseOrderPage(query) {
    const page = parseInt(query && query.page, 10);
    return Number.isFinite(page) && page > 0 ? page : 1;
}

function buildOrderListQueryString(query, overrides) {
    const params = new URLSearchParams();
    Object.entries(query || {}).forEach(([key, value]) => {
        if (key === 'page' || key === 'page_size') return;
        if (Array.isArray(value)) {
            value.forEach(item => params.append(key, item));
        } else if (value !== undefined && value !== null && String(value) !== '') {
            params.append(key, value);
        }
    });
    const page = Number(overrides && overrides.page);
    if (Number.isFinite(page) && page > 1) params.set('page', String(Math.floor(page)));
    return params.toString();
}

exports.index = async (req, res, next) => {
    try {
        const filter = buildOrderFilter(req.query);
        const shipmentOrderIds = await buildShipmentOrderFilter(req.query);
        if (shipmentOrderIds) filter._id = { $in: shipmentOrderIds };

        if (req.query?.phuong_thuc_tt && req.query.phuong_thuc_tt.trim() !== '') {
            const invoices = await HoaDonBanHang.find({ phuong_thuc_tt: req.query.phuong_thuc_tt.trim(), don_hang_id: { $ne: null } }).select('don_hang_id');
            applyOrderIdFilter(filter, invoices.map(item => item.don_hang_id).filter(Boolean));
        }

        if (req.query?.nguoi_tao && req.query.nguoi_tao.trim() !== '' && !filter.nguoi_tao_id) {
            const usersByName = await NguoiDung.find({
                $or: [
                    { ho_ten: { $regex: req.query.nguoi_tao.trim(), $options: 'i' } },
                    { username: { $regex: req.query.nguoi_tao.trim(), $options: 'i' } }
                ]
            }).select('_id');
            filter.nguoi_tao_id = { $in: usersByName.map(user => user._id) };
        }

        let page = parseOrderPage(req.query);
        const pageSize = ORDER_PAGE_SIZE;
        const total = await DonHang.countDocuments(filter);
        const totalPages = Math.max(1, Math.ceil(total / pageSize));
        if (page > totalPages) page = totalPages;
        const skip = (page - 1) * pageSize;
        const orders = await DonHang.find(filter)
            .populate('khach_hang_id')
            .populate('cua_hang_id')
            .populate('nguoi_tao_id')
            .sort({ created_at: -1 })
            .skip(skip)
            .limit(pageSize);

        const storeId = await resolveStoreId(req);
        const cashBookQuery = storeId
            ? { trang_thai: 'active', $or: [{ cua_hang_id: storeId }, { cua_hang_id: { $exists: false } }, { cua_hang_id: null }] }
            : { trang_thai: 'active' };
        const vatChuaQuery = storeId
            ? { cua_hang_id: storeId, trang_thai: 'active' }
            : { trang_thai: 'active' };
        const [partners, users, cashBooks, vatChuaList] = await Promise.all([
            DoiTacGiaoHang.find({ trang_thai: 'active' }).sort({ ten_doi_tac: 1 }),
            NguoiDung.find().sort({ ho_ten: 1, username: 1 }),
            SoQuy.find(cashBookQuery).sort({ ten_so_quy: 1 }).lean(),
            VatChua.find(vatChuaQuery).sort({ ten_vat_chua: 1 }).select('ten_vat_chua ma_vat_chua').lean()
        ]);
        res.render('don-hang/index', {
            title: 'Đặt hàng',
            orders,
            partners,
            users,
            cashBooks,
            vatChuaList,
            filters: req.query || {},
            exportColumnGroups: getOrderExportColumnGroupsForView(),
            pagination: {
                total,
                page,
                limit: pageSize,
                totalPages,
                from: total === 0 ? 0 : skip + 1,
                to: Math.min(skip + pageSize, total)
            },
            qs: function(overrides) {
                return buildOrderListQueryString(req.query || {}, overrides || {});
            }
        });
    } catch (error) {
        next(error);
    }
};


exports.getCreate = async (req, res, next) => {
    try {
        const storeId = await resolveStoreId(req);
        const cashBookQuery = storeId
            ? { trang_thai: 'active', $or: [{ cua_hang_id: storeId }, { cua_hang_id: { $exists: false } }, { cua_hang_id: null }] }
            : { trang_thai: 'active' };
        const [data, warehouses, cashBooks] = await Promise.all([
            getOrderCreateData(),
            storeId
                ? Kho.find({ trang_thai: 'active', cua_hang_id: storeId }).sort({ ten_kho: 1 }).lean()
                : [],
            SoQuy.find(cashBookQuery).sort({ ten_so_quy: 1 }).lean()
        ]);
        let sourceOrder = null;
        let sourceOrderItems = [];
        let sourceShipment = null;
        let copyFromError = '';
        const copyFromId = String(req.query?.copy_from || '').trim();
        if (/^[0-9a-fA-F]{24}$/.test(copyFromId)) {
            sourceOrder = await DonHang.findOne({ _id: copyFromId, trang_thai_du_lieu: 'active' })
                .populate('khach_hang_id')
                .populate('cua_hang_id')
                .populate('kho_id')
                .lean();
            if (!sourceOrder) {
                copyFromError = 'Không tìm thấy đơn hàng để sao chép.';
            } else if (sourceOrder.trang_thai === 'merged') {
                copyFromError = `Đơn hàng ${sourceOrder.ma_don_hang} đã được gộp vào ${sourceOrder.merged_to_ma_don_hang || 'đơn khác'}, không thể sao chép riêng.`;
                sourceOrder = null;
                sourceOrderItems = [];
                sourceShipment = null;
            } else {
                sourceOrderItems = await CTDonHang.find({ don_hang_id: sourceOrder._id }).populate('hang_hoa_id').lean();
                if (!sourceOrderItems.length) {
                    copyFromError = 'Đơn hàng chưa có sản phẩm để sao chép.';
                }
                sourceShipment = await VanDon.findOne({ don_hang_id: sourceOrder._id }).lean();
            }
        }
        res.render('don-hang/create', {
            title: 'Đặt hàng',
            ...data,
            currentStoreId: storeId || '',
            warehouses,
            cashBooks,
            sourceOrder,
            sourceOrderItems,
            sourceShipment,
            copyFromError
        });
    } catch (error) {
        next(error);
    }
};


exports.postAdd = async (req, res, next) => {
    try {
        const {
            khach_hang_id,
            cua_hang_id,
            bang_gia_id,
            items,
            chiet_khau,
            kieu_giam_gia,
            phi_van_chuyen,
            ghi_chu,
            kho_id,
            trang_thai,
            doi_tac_giao_hang_id,
            dia_chi_khach_hang_id,
            ten_nguoi_nhan,
            sdt_nguoi_nhan,
            dia_chi_nhan,
            diem_di,
            diem_den,
            khoang_cach_km,
            ghi_chu_giao_hang,
            thu_ho_cod,
            cod_enabled,
            nguoi_tra_phi_giao_hang,
            ngay_dat,
            so_quy_id
        } = req.body || {};

        const orderItems = parseItems(items);
        if (!Array.isArray(orderItems) || !orderItems.length) {
            return res.status(400).json({ success: false, message: 'Đơn hàng chưa có sản phẩm' });
        }
        if (!kho_id) {
            return res.status(400).json({ success: false, message: 'Vui lòng chền kho.' });
        }
        const sessionStoreId = await resolveStoreId(req);
        if (!sessionStoreId) {
            return res.status(400).json({ success: false, message: 'Chưa chền cửa hàng làm việc. Vui lòng chền cửa hàng ở menu trên.' });
        }
        if (!khach_hang_id) {
            return res.status(400).json({ success: false, message: 'Vui lòng chền khách hàng.' });
        }
        if (!dia_chi_khach_hang_id) {
            return res.status(400).json({ success: false, message: 'Vui lòng chền địa chỉ nhận hàng.' });
        }
        if (!doi_tac_giao_hang_id) {
            return res.status(400).json({ success: false, message: 'Vui lòng chền đối tác giao hàng.' });
        }
        const kho = await Kho.findById(kho_id).lean();
        if (!kho) {
            return res.status(400).json({ success: false, message: 'Kho không hợp lệ.' });
        }
        if (String(kho.cua_hang_id || '') !== sessionStoreId) {
            return res.status(400).json({ success: false, message: 'Kho không thuộc cửa hàng đang làm việc.' });
        }
        const validBangGiaId = /^[0-9a-fA-F]{24}$/.test(String(bang_gia_id || '')) ? bang_gia_id : null;

        let tong_tien_hang = 0;
        const normalizedItems = [];
        for (const sourceItem of orderItems) {
            const sourceQuyCachItems = Array.isArray(sourceItem.quy_cach_items) ? sourceItem.quy_cach_items : [];
            const expandedItems = sourceQuyCachItems.length
                ? sourceQuyCachItems
                    .filter(qc => Number(qc.so_luong_dat ?? qc.so_luong) > 0)
                    .map(qc => Object.assign({}, sourceItem, {
                        so_luong: Number(qc.so_luong_dat ?? qc.so_luong),
                        so_luong_dat: Number(qc.so_luong_dat ?? qc.so_luong),
                        lo_hang_id: qc.lo_hang_id || sourceItem.lo_hang_id || null,
                        gia_tri_thuoc_tinh_id: qc.gia_tri_thuoc_tinh_id || sourceItem.gia_tri_thuoc_tinh_id || null,
                        ten_quy_cach: qc.ten_quy_cach || qc.ten_thuoc_tinh || '',
                        ten_thuoc_tinh: qc.ten_thuoc_tinh || qc.ten_quy_cach || '',
                        don_gia_ban: qc.don_gia_ban ?? sourceItem.don_gia_ban,
                        don_gia: qc.don_gia_ban ?? sourceItem.don_gia_ban ?? sourceItem.don_gia,
                        loai_gia_ban: qc.loai_gia_ban ?? sourceItem.loai_gia_ban,
                        chiet_khau: qc.chiet_khau ?? 0,
                        kieu_chiet_khau: qc.kieu_chiet_khau || 'vnd'
                    }))
                : [sourceItem];
            for (const item of expandedItems) {
            const productId = String(item.hang_hoa_id || '').trim();
            const quantity = Number(item.so_luong_dat ?? item.so_luong) || 0;
            if (!productId || quantity <= 0) {
                return res.status(400).json({ success: false, message: 'Dòng hàng không hợp lệ.' });
            }
            const product = await HangHoa.findById(productId).lean();
            if (!product) {
                return res.status(400).json({ success: false, message: 'Không tìm thấy hàng hóa.' });
            }
            const manualUnitPrice = Number(item.don_gia_ban ?? item.don_gia);
            if (Number.isFinite(manualUnitPrice) && manualUnitPrice < 0) {
                return res.status(400).json({ success: false, message: 'Đơn giá không được âm.' });
            }
            const priceResult = await resolveOrderLineUnitPrice(item, product, validBangGiaId, sessionStoreId);
            if (priceResult.error) {
                return res.status(400).json({ success: false, message: priceResult.error });
            }
            const unitPrice = priceResult.unitPrice;
            const lineBase = quantity * unitPrice;
            const lineDiscountAmount = normalizeDiscount(item.chiet_khau, item.kieu_chiet_khau, lineBase);
            const lineDiscountValue = item.kieu_chiet_khau === 'phan_tram'
                ? Math.min(Math.max(Number(item.chiet_khau || 0), 0), 100)
                : lineDiscountAmount;
            const lineTotal = Math.max(lineBase - lineDiscountAmount, 0);
            tong_tien_hang += lineTotal;
            normalizedItems.push({
                product,
                hang_hoa_id: productId,
                lo_hang_id: item.lo_hang_id || null,
                gia_tri_thuoc_tinh_id: optionalLineObjectId(item.gia_tri_thuoc_tinh_id),
                ten_quy_cach: String(item.ten_quy_cach || '').trim(),
                ten_thuoc_tinh: String(item.ten_thuoc_tinh || item.ten_quy_cach || '').trim(),
                don_vi_tinh_id: optionalLineObjectId(item.don_vi_tinh_id || product.don_vi_tinh_id),
                ma_hang_snapshot: String(item.ma_hang_snapshot || product.ma_hang || ''),
                ten_hang_snapshot: String(item.ten_hang_snapshot || product.ten_hang || ''),
                don_vi_tinh_snapshot: String(item.don_vi_tinh_snapshot || ''),
                gia_goc: Number(item.gia_goc || product.gia_co_dinh || 0),
                ghi_chu: String(item.ghi_chu || ''),
                so_luong: quantity,
                don_gia_ban: unitPrice,
                chiet_khau: lineDiscountValue,
                kieu_chiet_khau: item.kieu_chiet_khau === 'phan_tram' ? 'phan_tram' : 'vnd',
                thanh_tien: lineTotal
            });
            }
        }
        if (!normalizedItems.length) {
            return res.status(400).json({ success: false, message: 'Đơn hàng chưa có dòng hàng hợp lệ.' });
        }
        const availabilityValidation = await validateOrderAvailability({
            khoId: kho_id,
            normalizedItems
        });
        if (!availabilityValidation.valid) {
            return res.status(400).json({ success: false, message: availabilityValidation.message });
        }

        const orderDiscount = normalizeDiscount(chiet_khau, kieu_giam_gia, tong_tien_hang);
        const orderDiscountValue = kieu_giam_gia === 'phan_tram'
            ? Math.min(Math.max(Number(chiet_khau || 0), 0), 100)
            : orderDiscount;
        const calculatedShippingFee = await tinhPhiGiaoHang({
            cua_hang_id: sessionStoreId,
            khach_hang_id,
            dia_chi_khach_hang_id,
            doi_tac_giao_hang_id,
            diem_di,
            diem_den: diem_den || dia_chi_nhan,
            khoang_cach_km
        });
        const manualShippingFee = Number(phi_van_chuyen);
        if (Number.isFinite(manualShippingFee) && manualShippingFee < 0) {
            return res.status(400).json({ success: false, message: 'Phí giao hàng không được âm.' });
        }
        const shippingFee = Number.isFinite(manualShippingFee) && manualShippingFee >= 0
            ? manualShippingFee
            : Number(calculatedShippingFee.phi_giao_hang || 0);
        if (shippingFee < 0) {
            return res.status(400).json({ success: false, message: 'Phí giao hàng không được âm.' });
        }
        const shippingFeePayer = nguoi_tra_phi_giao_hang === 'cua_hang' ? 'cua_hang' : 'khach';
        const effectiveShippingFee = shippingFeePayer === 'khach' ? 0 : shippingFee;
        await luuPhiVanChuyenKhachHang({
            cua_hang_id: sessionStoreId,
            khach_hang_id,
            dia_chi_khach_hang_id,
            doi_tac_giao_hang_id,
            phi_van_chuyen: effectiveShippingFee,
            ghi_chu: ghi_chu_giao_hang
        });
        const shippingFeeForCustomer = 0;
        const tong_thanh_toan = Math.max(tong_tien_hang - orderDiscount + shippingFeeForCustomer, 0);
        const codEnabled = false;
        const orderPayment = parseCustomerPaymentFromRequest(req.body, tong_thanh_toan, false);
        if (orderPayment.tong_khach_dua > 0 && !orderPayment.valid) {
            return res.status(400).json({ success: false, message: orderPayment.errors.join('. ') });
        }
        const paymentBooks = resolvePaymentBooksFromBody(req.body || {});
        if (orderPayment.tong_khach_dua > 0) {
            const bookErrors = validatePaymentBooksForCustomer(orderPayment, paymentBooks);
            if (bookErrors.length) {
                return res.status(400).json({ success: false, message: bookErrors.join('. ') });
            }
        }
        const khachThanhToan = Math.max(0, orderPayment.thuc_thu);
        const khachCanTra = Math.max(tong_thanh_toan - khachThanhToan, 0);
        const codAmount = 0;
        const tienThuaTraKhach = orderPayment.tien_thua;
        const ma_don_hang = await generateOrderCode();
        const orderDate = parseOrderDateInput(ngay_dat);

        const order = await DonHang.create({
            ma_don_hang,
            bang_gia_id: validBangGiaId,
            khach_hang_id: khach_hang_id || null,
            cua_hang_id: sessionStoreId,
            kho_id: kho_id || null,
            nguoi_tao_id: req.user?._id,
            ngay_dat: orderDate,
            ngay_tao: orderDate,
            tong_tien: tong_thanh_toan,
            tong_tien_hang,
            giam_gia: orderDiscountValue,
            kieu_giam_gia: kieu_giam_gia === 'phan_tram' ? 'phan_tram' : 'vnd',
            tong_thanh_toan,
            khach_can_tra: khachCanTra,
            khach_thanh_toan: khachThanhToan,
            tien_thua_tra_khach: tienThuaTraKhach,
            cod_enabled: codEnabled,
            cod_amount: codAmount,
            trang_thai: trang_thai || 'draft',
            trang_thai_giao_hang: 'chua_giao',
            ghi_chu
        });

        for (const item of normalizedItems) {
            await CTDonHang.create({
                don_hang_id: order._id,
                hang_hoa_id: item.hang_hoa_id,
                gia_tri_thuoc_tinh_id: item.gia_tri_thuoc_tinh_id,
                ten_quy_cach: item.ten_quy_cach,
                ten_thuoc_tinh: item.ten_thuoc_tinh,
                don_vi_tinh_id: item.don_vi_tinh_id,
                so_luong: item.so_luong,
                so_luong_dat: item.so_luong,
                so_luong_xac_nhan: 0,
                so_luong_da_giao: 0,
                so_luong_con_thieu: item.so_luong,
                trang_thai_giao: 'chua_giao',
                lo_hang_id: item.lo_hang_id || null,
                don_gia_ban: item.don_gia_ban,
                ma_hang_snapshot: item.ma_hang_snapshot,
                ten_hang_snapshot: item.ten_hang_snapshot,
                don_vi_tinh_snapshot: item.don_vi_tinh_snapshot,
                gia_goc: item.gia_goc,
                chiet_khau: item.chiet_khau,
                kieu_chiet_khau: item.kieu_chiet_khau,
                thanh_tien: item.thanh_tien,
                ghi_chu: item.ghi_chu
            });
        }

        const shipment = await VanDon.create({
            ma_van_don: await generateShipmentCode(),
            don_hang_id: order._id,
            doi_tac_giao_hang_id: doi_tac_giao_hang_id || null,
            cua_hang_id: cua_hang_id || kho.cua_hang_id || null,
            khach_hang_id: khach_hang_id || null,
            dia_chi_khach_hang_id: dia_chi_khach_hang_id || null,
            ten_nguoi_nhan,
            sdt_nguoi_nhan,
            dia_chi_nhan,
            phi_giao_hang: effectiveShippingFee,
            nguoi_tra_phi_giao_hang: shippingFeePayer,
            cod_enabled: codEnabled,
            cod_amount: codAmount,
            trang_thai_cod: codEnabled ? 'chua_thu' : 'khong_cod',
            ghi_chu: ghi_chu_giao_hang,
            trang_thai: 'draft'
        });

        if (orderPayment.tong_khach_dua > 0) {
            const customerName = khach_hang_id
                ? (await KhachHang.findById(khach_hang_id).select('ten_khach_hang').lean())?.ten_khach_hang
                : ten_nguoi_nhan;
            await recordCustomerPaymentReceipts(buildCustomerPaymentReceiptPayload(req.body, orderPayment, {
                loai_thu_chi: 'Thu tien don hang',
                ngay_lap: order.ngay_dat || new Date(),
                cua_hang_id: order.cua_hang_id,
                nguoi_tao_id: req.user?._id,
                khach_hang_id,
                don_hang_id: order._id,
                van_don_id: shipment._id,
                ma_chung_tu_goc: ma_don_hang,
                doi_tuong: customerName || ten_nguoi_nhan || 'Khách lẻ',
                nhom_doi_tuong: 'khach_hang'
            }), orderPayment);
        }

        res.json({ success: true, message: 'Đã tạo đơn đặt hàng', ma_don_hang });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message || 'Không tạo được đơn hàng' });
    }
};


exports.getId = async function(req, res) {
    res.redirect('/don-hang?order=' + encodeURIComponent(req.params.id));
};


exports.getIdDetail = async (req, res, next) => {
    try {
        const order = await DonHang.findOne({ _id: req.params.id, trang_thai_du_lieu: 'active' })
            .populate('khach_hang_id')
            .populate('cua_hang_id')
            .populate('nguoi_tao_id');
        if (!order) return res.status(404).json({ success: false, message: 'Không tìm thấy đơn hàng' });
        const [items, shipment, invoices] = await Promise.all([
            CTDonHang.find({ don_hang_id: order._id }).populate('hang_hoa_id').populate('lo_hang_id'),
            VanDon.findOne({ don_hang_id: order._id }).populate('doi_tac_giao_hang_id').populate('cua_hang_id'),
            HoaDonBanHang.find({ don_hang_id: order._id })
                .select('_id ma_hoa_don trang_thai thanh_toan ngay_ban created_at')
                .sort({ created_at: -1 })
                .lean()
        ]);
        const invoiceIds = invoices.map(row => row._id).filter(Boolean);
        const maDonHang = String(order.ma_don_hang || '').trim();
        const receiptLinkOr = [{ don_hang_id: order._id }];
        if (maDonHang) receiptLinkOr.push({ ma_chung_tu_goc: maDonHang });
        if (invoiceIds.length) {
            receiptLinkOr.push({ hoa_don_id: { $in: invoiceIds } });
        }
        const receipts = await PhieuThuChi.find(receiptRowsForNetPaidFilter({ $or: receiptLinkOr }))
            .populate('nguoi_tao_id')
            .sort({ ngay_lap: -1, created_at: -1 })
            .lean();
        const paymentBalance = await applyOrderPaymentBalance(order, order._id);
        const storeId = await resolveStoreId(req);
        const vatChuaLines = await loadOrderLinkedVatChuaLines(
            order._id,
            invoiceIds,
            storeId || order.cua_hang_id
        );
        res.json({
            success: true,
            data: {
                order,
                items,
                shipment,
                invoices,
                receipts,
                invoice: invoices[0] || null,
                payment_balance: paymentBalance,
                vat_chua_lines: vatChuaLines
            }
        });
    } catch (error) {
        next(error);
    }
};


exports.putIdDetail = async (req, res, next) => {
    try {
        const order = await DonHang.findOne({ _id: req.params.id, trang_thai_du_lieu: 'active' });
        if (!order) return res.status(404).json({ success: false, message: 'Không tìm thấy đơn hàng' });
        if (order.trang_thai === 'cancelled' || order.trang_thai === 'merged') {
            return res.status(400).json({ success: false, message: 'Đơn đã hủy, không thể sửa' });
        }

        const body = req.body || {};
        if (body.ghi_chu !== undefined) order.ghi_chu = String(body.ghi_chu || '').trim();
        if (body.trang_thai && ['draft', 'shipping', 'completed', 'cancelled', 'merged'].includes(body.trang_thai)) {
            order.trang_thai = body.trang_thai;
        }
        await order.save();

        const shipmentPayload = body.shipment || {};
        let shipment = await VanDon.findOne({ don_hang_id: order._id });
        if (shipment) {
            if (shipmentPayload.ten_nguoi_nhan !== undefined) shipment.ten_nguoi_nhan = String(shipmentPayload.ten_nguoi_nhan || '').trim();
            if (shipmentPayload.sdt_nguoi_nhan !== undefined) shipment.sdt_nguoi_nhan = String(shipmentPayload.sdt_nguoi_nhan || '').trim();
            if (shipmentPayload.dia_chi_nhan !== undefined) shipment.dia_chi_nhan = String(shipmentPayload.dia_chi_nhan || '').trim();
            if (shipmentPayload.ghi_chu !== undefined) shipment.ghi_chu = String(shipmentPayload.ghi_chu || '').trim();
            if (shipmentPayload.phi_giao_hang !== undefined) shipment.phi_giao_hang = Math.max(0, Number(shipmentPayload.phi_giao_hang || 0));
            await shipment.save();
        }

        res.json({ success: true, message: 'Đã lưu thông tin đơn hàng' });
    } catch (error) {
        next(error);
    }
};


exports.postIdStatus = async (req, res, next) => {
    try {
        const { trang_thai, force_complete_short } = req.body || {};
        const allowed = ['draft', 'shipping', 'completed', 'cancelled'];
        if (!allowed.includes(trang_thai)) {
            return res.status(400).json({ success: false, message: 'Trạng thái đơn hàng không hợp lệ' });
        }
        const order = await DonHang.findOne({ _id: req.params.id, trang_thai_du_lieu: 'active' });
        if (!order) return res.status(404).json({ success: false, message: 'Không tìm thấy đơn hàng' });
        if (order.trang_thai === 'merged') {
            return res.status(400).json({ success: false, message: `Đơn này đã được gộp vào ${order.merged_to_ma_don_hang || 'đơn khác'}, không thể cập nhật trạng thái.` });
        }
        if (trang_thai === 'completed' && order.trang_thai_giao_hang !== 'giao_du' && !force_complete_short) {
            return res.status(400).json({
                success: false,
                code: 'NEED_CONFIRM_SHORT',
                message: 'Đơn chưa giao đủ. Cần xác nhận kết thúc thiếu.'
            });
        }
        order.trang_thai = trang_thai;
        await order.save();
        res.json({ success: true, message: 'Đã cập nhật trạng thái đơn hàng' });
    } catch (error) {
        next(error);
    }
};

exports.postDeactivateSelected = async (req, res, next) => {
    try {
        const ids = Array.isArray(req.body?.don_hang_ids)
            ? req.body.don_hang_ids
                .map(id => String(id || '').trim())
                .filter(id => /^[0-9a-fA-F]{24}$/.test(id))
            : [];
        if (!ids.length) {
            return res.status(400).json({ success: false, message: 'Vui lòng chọn đơn hàng cần xóa' });
        }
        const result = await DonHang.updateMany(
            { _id: { $in: ids }, trang_thai_du_lieu: 'active' },
            { $set: { trang_thai_du_lieu: 'inactive' } },
            { runValidators: true }
        );
        res.json({
            success: true,
            message: 'Đã xóa đơn hàng đã chọn',
            modifiedCount: result.modifiedCount || 0
        });
    } catch (error) {
        next(error);
    }
};



exports.postIdDuplicate = async (req, res, next) => {
    try {
        const sourceOrder = await DonHang.findOne({ _id: req.params.id, trang_thai_du_lieu: 'active' }).lean();
        if (!sourceOrder) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy đơn đặt hàng' });
        }

        if (sourceOrder.trang_thai === 'merged') {
            return res.status(400).json({
                success: false,
                message: `Đơn hàng này đã được gộp vào ${sourceOrder.merged_to_ma_don_hang || 'đơn khác'}, không thể thao tác riêng.`
            });
        }

        const sourceItems = await CTDonHang.find({ don_hang_id: sourceOrder._id }).lean();
        if (!sourceItems.length) {
            return res.status(400).json({ success: false, message: 'Đơn đặt hàng chưa có sản phẩm để sao chép' });
        }

        const sourceShipment = await VanDon.findOne({ don_hang_id: sourceOrder._id }).lean();
        const now = new Date();
        const maDonHang = await generateOrderCode();
        const payable = Number(sourceOrder.tong_thanh_toan || sourceOrder.tong_tien || sourceOrder.khach_can_tra || 0);
        const codEnabled = sourceShipment ? Boolean(sourceShipment.cod_enabled) : Boolean(sourceOrder.cod_enabled);

        const newOrder = await DonHang.create({
            ma_don_hang: maDonHang,
            bang_gia_id: sourceOrder.bang_gia_id || null,
            khach_hang_id: sourceOrder.khach_hang_id || null,
            cua_hang_id: sourceOrder.cua_hang_id || null,
            kho_id: sourceOrder.kho_id || null,
            nguoi_tao_id: req.user?._id || sourceOrder.nguoi_tao_id || null,
            ngay_dat: now,
            ngay_tao: now,
            tong_tien: Number(sourceOrder.tong_tien || payable || 0),
            tong_tien_hang: Number(sourceOrder.tong_tien_hang || 0),
            giam_gia: Number(sourceOrder.giam_gia || 0),
            kieu_giam_gia: sourceOrder.kieu_giam_gia === 'phan_tram' ? 'phan_tram' : 'vnd',
            tong_thanh_toan: payable,
            khach_can_tra: Number(sourceOrder.khach_can_tra || payable || 0),
            khach_thanh_toan: 0,
            tien_thua_tra_khach: 0,
            cod_enabled: codEnabled,
            cod_amount: codEnabled ? Number(sourceOrder.khach_can_tra || payable || 0) : 0,
            trang_thai: 'draft',
            trang_thai_giao_hang: 'chua_giao',
            ghi_chu: sourceOrder.ghi_chu || ''
        });

        await CTDonHang.insertMany(sourceItems.map(item => {
            const quantity = Number(item.so_luong_dat || item.so_luong || 0);
            return {
                don_hang_id: newOrder._id,
                hang_hoa_id: item.hang_hoa_id,
                so_luong: quantity,
                so_luong_dat: quantity,
                so_luong_xac_nhan: 0,
                so_luong_da_giao: 0,
                so_luong_con_thieu: quantity,
                trang_thai_giao: 'chua_giao',
                lo_hang_id: item.lo_hang_id || null,
                don_gia_ban: Number(item.don_gia_ban || 0),
                chiet_khau: Number(item.chiet_khau || 0),
                kieu_chiet_khau: item.kieu_chiet_khau === 'phan_tram' ? 'phan_tram' : 'vnd',
                thanh_tien: Number(item.thanh_tien || 0)
            };
        }));

        if (sourceShipment) {
            await VanDon.create({
                ma_van_don: await generateShipmentCode(),
                don_hang_id: newOrder._id,
                doi_tac_giao_hang_id: sourceShipment.doi_tac_giao_hang_id || null,
                cua_hang_id: sourceShipment.cua_hang_id || sourceOrder.cua_hang_id || null,
                khach_hang_id: sourceShipment.khach_hang_id || sourceOrder.khach_hang_id || null,
                dia_chi_khach_hang_id: sourceShipment.dia_chi_khach_hang_id || null,
                ten_nguoi_nhan: sourceShipment.ten_nguoi_nhan || '',
                sdt_nguoi_nhan: sourceShipment.sdt_nguoi_nhan || '',
                dia_chi_nhan: sourceShipment.dia_chi_nhan || '',
                phi_giao_hang: Number(sourceShipment.phi_giao_hang || 0),
                don_gia_van_chuyen_ap_dung: Number(sourceShipment.don_gia_van_chuyen_ap_dung || 0),
                so_luong_tinh_phi: Number(sourceShipment.so_luong_tinh_phi || 1),
                thanh_tien_van_chuyen: Number(sourceShipment.thanh_tien_van_chuyen || 0),
                nguoi_tra_phi_giao_hang: sourceShipment.nguoi_tra_phi_giao_hang === 'cua_hang' ? 'cua_hang' : 'khach',
                cod_enabled: codEnabled,
                cod_amount: codEnabled ? Number(sourceOrder.khach_can_tra || payable || 0) : 0,
                trang_thai_cod: codEnabled ? 'chua_thu' : 'khong_cod',
                trang_thai: 'draft',
                ghi_chu: sourceShipment.ghi_chu || ''
            });
        }

        res.json({
            success: true,
            message: 'Đã sao chép đơn đặt hàng',
            order_id: String(newOrder._id),
            ma_don_hang: newOrder.ma_don_hang
        });
    } catch (error) {
        next(error);
    }
};


exports.postIdPhieuThu = async (req, res, next) => {
    try {
        const order = await DonHang.findOne({ _id: req.params.id, trang_thai_du_lieu: 'active' });
        if (!order) return res.status(404).json({ success: false, message: 'Không tìm thấy đơn hàng' });
        if (order.trang_thai === 'cancelled' || order.trang_thai === 'merged') {
            return res.status(400).json({ success: false, message: 'Đơn đã hủy, không thể thu tiền' });
        }

        const debtSummary = await getOrderInvoiceDebtSummary(order._id);
        const balance = await computeOrderPaymentBalance(order._id, order);
        const remaining = debtSummary.invoices.length
            ? debtSummary.totalRemaining
            : balance.khach_can_tra;
        const payment = parseCustomerPaymentFromRequest(req.body, remaining, true);
        if (!payment.valid) {
            return res.status(400).json({ success: false, message: payment.errors.join('. ') });
        }
        const paymentBooks = resolvePaymentBooksFromBody(req.body || {});
        const bookErrors = validatePaymentBooksForCustomer(payment, paymentBooks);
        if (bookErrors.length) {
            return res.status(400).json({ success: false, message: bookErrors.join('. ') });
        }
        const cashBookId = resolveCashBookIdFromBody(req.body || {});
        if (!paymentBooks.so_quy_tien_mat_id && !paymentBooks.so_quy_chuyen_khoan_id && !cashBookId) {
            return res.status(400).json({ success: false, message: 'Vui lòng chọn sổ quỹ để thu tiền đơn hàng.' });
        }

        const shipment = await VanDon.findOne({ don_hang_id: order._id }).lean();
        const receipts = [];
        const customerName = order.khach_hang_id
            ? (await KhachHang.findById(order.khach_hang_id).select('ten_khach_hang').lean())?.ten_khach_hang
            : 'Khách lẻ';
        const primaryInvoice = debtSummary.openInvoices[0]?.invoice || null;

        if (payment.tong_khach_dua > 0) {
            const paymentResult = await recordCustomerPaymentReceipts(buildCustomerPaymentReceiptPayload(req.body, payment, {
                loai_thu_chi: 'Thu tien don hang',
                ngay_lap: new Date(),
                cua_hang_id: order.cua_hang_id,
                nguoi_tao_id: req.user?._id,
                khach_hang_id: order.khach_hang_id,
                doi_tuong: customerName || 'Khách lẻ',
                don_hang_id: order._id,
                hoa_don_id: primaryInvoice?._id,
                van_don_id: shipment?._id,
                ma_chung_tu_goc: primaryInvoice?.ma_hoa_don || order.ma_don_hang,
                nhom_doi_tuong: 'khach_hang',
                hach_toan: false
            }), payment);
            if (paymentResult.thu) receipts.push(paymentResult.thu);
        }

        let amountLeft = payment.thuc_thu;
        if (debtSummary.openInvoices.length) {
            for (const row of debtSummary.openInvoices) {
                if (amountLeft <= 0) break;
                const slice = Math.min(amountLeft, row.remaining);
                const inv = row.invoice;
                amountLeft -= slice;

                const invoiceDoc = await HoaDonBanHang.findById(inv._id);
                if (invoiceDoc) {
                    const paidOnInvoice = await getInvoicePaidAmount(inv._id);
                    invoiceDoc.trang_thai = resolveInvoiceStatus(Number(inv.thanh_toan || 0), paidOnInvoice);
                    await invoiceDoc.save();
                }
                if (order.khach_hang_id && slice > 0) {
                    await CongNoKhachHang.create({
                        khach_hang_id: order.khach_hang_id,
                        don_hang_id: order._id,
                        hoa_don_id: inv._id,
                        phieu_thu_chi_id: receipts[0]?._id,
                        so_tien: slice,
                        loai: 'giam_no',
                        ghi_chu: `Thu tiền hóa đơn ${inv.ma_hoa_don || order.ma_don_hang}`,
                        ngay: new Date()
                    });
                    const customerDebt = await KhachHang.findById(order.khach_hang_id).select('tong_no').lean();
                    if (customerDebt && typeof customerDebt.tong_no === 'number') {
                        await KhachHang.updateOne({ _id: order.khach_hang_id }, { $inc: { tong_no: -slice } });
                    }
                }
            }
        }

        await applyOrderPaymentBalance(order, order._id);
        await order.save();

        const paidAfter = order.khach_thanh_toan;
        const remainingAfter = order.khach_can_tra;
        res.json({
            success: true,
            message: 'Đã tạo phiếu thu',
            data: {
                receipt: receipts[0] || null,
                receipts,
                paid: paidAfter,
                remaining: remainingAfter
            }
        });
    } catch (error) {
        next(error);
    }
};


exports.confirmOrderDelivery = async function(req, res, next) {
    let createdInvoiceId = null;
    let stockAppliedLines = [];
    let orderLinesUpdated = false;
    try {
        const { kho_id, items, khach_thanh_toan, phuong_thuc_thanh_toan } = req.body || {};
        const deliveryItems = parseItems(items);

        if (!kho_id) {
            return res.status(400).json({ success: false, message: 'Vui lòng chọn kho.' });
        }

        const warehouse = await Kho.findById(kho_id);
        if (!warehouse) {
            return res.status(400).json({ success: false, message: 'Kho giao hàng không hợp lệ' });
        }

        if (!deliveryItems.length) {
            return res.status(400).json({ success: false, message: 'Vui lòng chọn hàng cần giao' });
        }

        const order = await DonHang.findOne({ _id: req.params.id, trang_thai_du_lieu: 'active' });
        if (!order) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy đơn hàng' });
        }

        if (order.trang_thai === 'merged') {
            return res.status(400).json({
                success: false,
                message: `Đơn này đã được gộp vào ${order.merged_to_ma_don_hang || 'đơn khác'}, không thể xác nhận giao.`
            });
        }

        const sessionStoreId = await resolveStoreId(req);
        if (!sessionStoreId) {
            return res.status(400).json({ success: false, message: 'Chưa chọn cửa hàng' });
        }
        if (String(warehouse.cua_hang_id || '') !== String(sessionStoreId)) {
            return res.status(400).json({ success: false, message: 'Kho không thuộc cửa hàng đang làm việc.' });
        }


        const deliveryLines = [];
        for (const item of deliveryItems) {
            const quantity = Number(item.so_luong_giao);
            if (!Number.isFinite(quantity) || quantity <= 0) continue;

            const deliveryPrice = Number(item.don_gia_giao ?? item.don_gia_ban ?? 0);
            if (!Number.isFinite(deliveryPrice) || deliveryPrice < 0) {
                return res.status(400).json({ success: false, message: 'Đơn giá giao không hợp lệ' });
            }

            const detail = item.ct_don_hang_id
                ? await CTDonHang.findOne({ _id: item.ct_don_hang_id, don_hang_id: order._id })
                : await CTDonHang.findOne({ don_hang_id: order._id, hang_hoa_id: item.hang_hoa_id });

            if (!detail) {
                return res.status(400).json({ success: false, message: 'Dòng hàng giao không hợp lệ' });
            }

            const lineBase = quantity * deliveryPrice;
            const lineDiscount = normalizeDiscount(detail.chiet_khau, detail.kieu_chiet_khau, lineBase);
            const lineTotal = Math.max(lineBase - lineDiscount, 0);

            deliveryLines.push({
                detail,
                quantity,
                deliveryPrice,
                lineDiscount,
                lineTotal,
                lo_hang_id: item.lo_hang_id || detail.lo_hang_id,
                hang_hoa_id: item.hang_hoa_id || detail.hang_hoa_id
            });
        }

        if (!deliveryLines.length) {
            return res.status(400).json({ success: false, message: 'Vui lòng nhập ít nhất một số lượng giao hợp lệ' });
        }

        const stockPreflight = await validateDeliveryStockPreflight(kho_id, warehouse, deliveryLines);
        if (!stockPreflight.valid) {
            return res.status(400).json({
                success: false,
                message: stockPreflight.message,
                shortages: stockPreflight.shortages
            });
        }

        let tong_tien_hang = deliveryLines.reduce((sum, row) => sum + row.lineTotal, 0);
        const orderGoodsTotal = Number(order.tong_tien_hang || 0);
        const orderDiscount = normalizeDiscount(order.giam_gia, order.kieu_giam_gia, orderGoodsTotal);
        const discountShare = orderGoodsTotal > 0
            ? Math.round(orderDiscount * (tong_tien_hang / orderGoodsTotal))
            : 0;
        const payable = Math.max(tong_tien_hang - discountShare, 0);
        const deliveryDue = await computeDeliveryPaymentDue(order._id, payable, order);

        const deliveryPayment = parseCustomerPaymentFromRequest(req.body, deliveryDue.amount_due, false);
        if (deliveryPayment.tong_khach_dua > 0 && !deliveryPayment.valid) {
            return res.status(400).json({ success: false, message: deliveryPayment.errors.join('. ') });
        }
        const paymentBooks = resolvePaymentBooksFromBody(req.body || {});
        if (deliveryPayment.tong_khach_dua > 0) {
            const bookErrors = validatePaymentBooksForCustomer(deliveryPayment, paymentBooks);
            if (bookErrors.length) {
                return res.status(400).json({ success: false, message: bookErrors.join('. ') });
            }
        }

        const parsedVatChua = parseVatChuaImportInput(req.body || {});
        try {
            assertVatChuaImportInput(parsedVatChua);
        } catch (vatChuaInputError) {
            return res.status(400).json({ success: false, message: vatChuaInputError.message });
        }
        if (parsedVatChua.vatChuaId && parsedVatChua.qty > 0) {
            const vatChuaRow = await VatChua.findOne({
                _id: parsedVatChua.vatChuaId,
                cua_hang_id: sessionStoreId,
                trang_thai: 'active'
            }).select('so_luong_ton ten_vat_chua').lean();
            if (!vatChuaRow) {
                return res.status(400).json({ success: false, message: 'Vật chứa không hợp lệ hoặc đã ngừng sử dụng' });
            }
            const tonVatChua = Math.max(0, Number(vatChuaRow.so_luong_ton || 0));
            if (tonVatChua < parsedVatChua.qty) {
                return res.status(400).json({
                    success: false,
                    message: 'Tồn vật chứa không đủ để xuất (còn ' + tonVatChua + ', cần ' + parsedVatChua.qty + ')'
                });
            }
        }

        const ma_hoa_don = await generateInvoiceCode();
        const invoicePaidTotal = Math.min(
            payable,
            deliveryDue.prepayment_credit + deliveryPayment.thuc_thu
        );
        const invoiceStatus = resolveInvoiceStatus(payable, invoicePaidTotal);
        const shipmentRow = await VanDon.findOne({ don_hang_id: order._id }).lean();

        const invoice = await HoaDonBanHang.create({
            ma_hoa_don,
            ngay_ban: new Date(),
            tong_tien: tong_tien_hang,
            giam_gia: discountShare,
            thanh_toan: payable,
            phuong_thuc_tt: shipmentRow?.cod_enabled ? 'COD' : normalizePaymentMethodValue(phuong_thuc_thanh_toan) || 'Tiền mặt',
            trang_thai: invoiceStatus,
            ghi_chu: `Giao hang don ${order.ma_don_hang}`,
            cua_hang_id: sessionStoreId,
            kho_id,
            don_hang_id: order._id,
            khach_hang_id: order.khach_hang_id,
            nguoi_ban_id: req.user?._id
        });
        createdInvoiceId = invoice._id;

        const invoiceLineRefs = [];
        for (const line of deliveryLines) {
            const detail = line.detail;
            const invoiceLine = await CTHoaDonBanHang.create({
                hoa_don_id: invoice._id,
                ct_don_hang_id: detail._id,
                hang_hoa_id: line.hang_hoa_id,
                lo_hang_id: null,
                lot_allocations: [],
                gia_tri_thuoc_tinh_id: detail.gia_tri_thuoc_tinh_id,
                ten_quy_cach: detail.ten_quy_cach,
                ten_thuoc_tinh: detail.ten_thuoc_tinh,
                don_vi_tinh_id: detail.don_vi_tinh_id,
                ma_hang_snapshot: detail.ma_hang_snapshot,
                ten_hang_snapshot: detail.ten_hang_snapshot,
                don_vi_tinh_snapshot: detail.don_vi_tinh_snapshot,
                so_luong: line.quantity,
                don_gia: line.deliveryPrice,
                chiet_khau: line.lineDiscount,
                thanh_tien: line.lineTotal,
                ghi_chu: detail.ghi_chu
            });
            invoiceLineRefs.push({ invoiceLine, line });
        }

        try {
            for (const { invoiceLine, line } of invoiceLineRefs) {
                const detail = line.detail;
                const preferredLotId = line.lo_hang_id || detail.lo_hang_id || undefined;
                const stockResult = await truTonKho({
                    kho_id,
                    hang_hoa_id: line.hang_hoa_id,
                    lo_hang_id: preferredLotId,
                    ten_quy_cach: detail.ten_quy_cach || detail.ten_thuoc_tinh || '',
                    gia_tri_thuoc_tinh_id: detail.gia_tri_thuoc_tinh_id || undefined,
                    sync_quy_cach: Boolean(detail.gia_tri_thuoc_tinh_id || detail.ten_quy_cach || detail.ten_thuoc_tinh),
                    so_luong: line.quantity,
                    nguoi_tao_id: req.user?._id,
                    loai_phieu: 'ban_hang',
                    ma_phieu: ma_hoa_don,
                    ghi_chu: `Xuat kho HĐ ${ma_hoa_don} - don ${order.ma_don_hang}`
                });
                const lotPatch = applyLotAllocationsToInvoiceLine(stockResult.allocations);
                await CTHoaDonBanHang.updateOne({ _id: invoiceLine._id }, { $set: lotPatch });
                stockAppliedLines.push({
                    hang_hoa_id: line.hang_hoa_id,
                    lo_hang_id: lotPatch.lo_hang_id,
                    lot_allocations: lotPatch.lot_allocations,
                    gia_tri_thuoc_tinh_id: detail.gia_tri_thuoc_tinh_id,
                    ten_quy_cach: detail.ten_quy_cach,
                    ten_thuoc_tinh: detail.ten_thuoc_tinh,
                    so_luong: line.quantity
                });
            }
            invoice.da_tru_ton_kho = true;
            await invoice.save();
        } catch (stockError) {
            await rollbackDeliveryInvoice(createdInvoiceId, {
                kho_id,
                nguoi_tao_id: req.user?._id,
                stockLines: stockAppliedLines,
                restoreStock: stockAppliedLines.length > 0
            });
            createdInvoiceId = null;
            stockAppliedLines = [];
            if (/tồn kho|ton kho|Ton kho/i.test(stockError.message || '')) {
                return res.status(400).json({ success: false, message: stockError.message });
            }
            throw stockError;
        }

        if (parsedVatChua.vatChuaId && parsedVatChua.qty > 0) {
            const customerForVatChua = order.khach_hang_id
                ? (await KhachHang.findById(order.khach_hang_id).select('ten_khach_hang').lean())?.ten_khach_hang
                : '';
            try {
                await exportVatChuaWithOrderDelivery(order, invoice, {
                    vat_chua_id: parsedVatChua.vatChuaId,
                    vat_chua_so_luong: parsedVatChua.qty,
                    khach_hang_ten: customerForVatChua || ''
                });
            } catch (vatChuaError) {
                await rollbackDeliveryInvoice(createdInvoiceId, {
                    kho_id,
                    nguoi_tao_id: req.user?._id,
                    stockLines: stockAppliedLines,
                    restoreStock: stockAppliedLines.length > 0
                });
                createdInvoiceId = null;
                stockAppliedLines = [];
                return res.status(400).json({ success: false, message: vatChuaError.message || 'Không ghi nhận xuất vật chứa được' });
            }
        }

        for (const line of deliveryLines) {
            const detail = line.detail;
            const orderedQuantity = Number(detail.so_luong_dat || detail.so_luong || 0);
            const deliveredBefore = Number(detail.so_luong_da_giao || 0);
            const deliveredAfter = deliveredBefore + line.quantity;
            const missingAfter = Math.max(orderedQuantity - deliveredAfter, 0);
            detail.so_luong_dat = orderedQuantity;
            detail.so_luong_xac_nhan = Number(detail.so_luong_xac_nhan || 0) + line.quantity;
            detail.so_luong_da_giao = deliveredAfter;
            detail.so_luong_con_thieu = missingAfter;
            detail.trang_thai_giao = deliveredAfter <= 0
                ? 'chua_giao'
                : (missingAfter <= 0 ? 'giao_du' : 'giao_thieu');
            await detail.save();
        }
        orderLinesUpdated = true;

        const allDetails = await CTDonHang.find({ don_hang_id: order._id });
        const allDelivered = allDetails.length > 0 && allDetails.every(item => Number(item.so_luong_con_thieu || 0) <= 0);
        const anyDelivered = allDetails.some(item => Number(item.so_luong_da_giao || 0) > 0);
        const anyMissing = allDetails.some(item => Number(item.so_luong_con_thieu || 0) > 0);

        order.kho_id = kho_id;
        order.trang_thai_giao_hang = allDelivered
            ? 'giao_du'
            : (anyDelivered && anyMissing ? 'giao_mot_phan' : 'chua_giao');
        order.ngay_giao_thuc_te = new Date();
        if (!order.trang_thai || order.trang_thai === 'draft' || order.trang_thai === 'da_xac_nhan') {
            order.trang_thai = allDelivered ? 'completed' : 'shipping';
        } else if (order.trang_thai === 'shipping' && allDelivered) {
            order.trang_thai = 'completed';
        }

        const debt = Math.max(deliveryDue.amount_due - deliveryPayment.thuc_thu, 0);
        if (debt > 0 && order.khach_hang_id) {
            await CongNoKhachHang.create({
                khach_hang_id: order.khach_hang_id,
                don_hang_id: order._id,
                hoa_don_id: invoice._id,
                so_tien: debt,
                loai: 'tang_no',
                ghi_chu: `Công nợ hóa đơn ${ma_hoa_don}`,
                ngay: invoice.ngay_ban
            });
            const customer = await KhachHang.findById(order.khach_hang_id).select('tong_no').lean();
            if (customer && typeof customer.tong_no === 'number') {
                await KhachHang.updateOne({ _id: order.khach_hang_id }, { $inc: { tong_no: debt } });
            }
        }

        let receipt = null;
        if (deliveryPayment.tong_khach_dua > 0) {
            const customerName = order.khach_hang_id
                ? (await KhachHang.findById(order.khach_hang_id).select('ten_khach_hang').lean())?.ten_khach_hang
                : 'Khách lẻ';
            const paymentResult = await recordCustomerPaymentReceipts(buildCustomerPaymentReceiptPayload(req.body, deliveryPayment, {
                loai_thu_chi: 'Thu tien khi giao hang',
                ngay_lap: new Date(),
                cua_hang_id: order.cua_hang_id,
                nguoi_tao_id: req.user?._id,
                khach_hang_id: order.khach_hang_id,
                doi_tuong: customerName || 'Khách lẻ',
                don_hang_id: order._id,
                hoa_don_id: invoice._id,
                van_don_id: shipmentRow?._id,
                ma_chung_tu_goc: ma_hoa_don,
                nhom_doi_tuong: 'khach_hang',
                hach_toan: false
            }), deliveryPayment);
            receipt = paymentResult.thu;
        }

        await applyOrderPaymentBalance(order, order._id);
        await order.save();

        if (shipmentRow) {
            await VanDon.updateOne(
                { _id: shipmentRow._id },
                { $set: { hoa_don_id: invoice._id } }
            );
        }

        return res.json({
            success: true,
            message: `Đã xác nhận giao và tạo hóa đơn ${ma_hoa_don}`,
            data: {
                don_hang_id: order._id,
                hoa_don_id: invoice._id,
                ma_hoa_don,
                trang_thai_giao_hang: order.trang_thai_giao_hang,
                ngay_giao_thuc_te: order.ngay_giao_thuc_te,
                khach_thanh_toan: order.khach_thanh_toan,
                khach_can_tra: order.khach_can_tra,
                thanh_toan_hoa_don: payable,
                prepayment_credit: deliveryDue.prepayment_credit,
                amount_due_at_delivery: deliveryDue.amount_due,
                phieu_thu_id: receipt?._id
            },
            print_url: '/chung-tu-kho/hoa-don-ban/' + invoice._id
        });
    } catch (error) {
        if (createdInvoiceId) {
            await rollbackDeliveryInvoice(createdInvoiceId, {
                kho_id: req.body?.kho_id,
                nguoi_tao_id: req.user?._id,
                stockLines: stockAppliedLines,
                restoreStock: stockAppliedLines.length > 0,
                revertOrderLines: orderLinesUpdated
            });
        }
        next(error);
    }
};




