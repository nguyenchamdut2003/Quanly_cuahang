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

exports.getGopDonCandidates = async (req, res, next) => {
    try {
        const days = Math.max(1, Math.min(90, Number(req.query.days || 7)));
        const fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        const filter = {
            trang_thai_du_lieu: 'active',
            ngay_dat: { $gte: fromDate },
            trang_thai: { $nin: ['cancelled', 'completed', 'merged'] },
            trang_thai_giao_hang: 'chua_giao'
        };
        if (req.query.khach_hang_id && mongoose.Types.ObjectId.isValid(String(req.query.khach_hang_id))) {
            filter.khach_hang_id = req.query.khach_hang_id;
        }

        let orders = await DonHang.find(filter)
            .populate('khach_hang_id')
            .sort({ ngay_dat: -1 })
            .lean();

        const normalizedPhone = normalizePhone(req.query.sdt);
        if (normalizedPhone) {
            orders = orders.filter(order => orderCustomerPhone(order) === normalizedPhone);
        }

        const orderIds = orders.map(order => order._id);
        const [invoices, deliveredRows] = await Promise.all([
            HoaDonBanHang.find({
                don_hang_id: { $in: orderIds },
                trang_thai: { $ne: 'cancelled' }
            }).select('don_hang_id').lean(),
            CTDonHang.find({
                don_hang_id: { $in: orderIds },
                so_luong_da_giao: { $gt: 0 }
            }).select('don_hang_id').lean()
        ]);
        const blockedOrderIds = new Set([
            ...invoices.map(item => String(item.don_hang_id || '')),
            ...deliveredRows.map(item => String(item.don_hang_id || ''))
        ]);

        const data = orders
            .filter(order => !blockedOrderIds.has(String(order._id)))
            .map(order => ({
                _id: order._id,
                ma_don_hang: order.ma_don_hang,
                ngay_dat: order.ngay_dat,
                khach_can_tra: Number(order.khach_can_tra || order.tong_thanh_toan || order.tong_tien || 0),
                khach_thanh_toan: Number(order.khach_thanh_toan || 0),
                ma_khach_hang: order.khach_hang_id?.ma_khach_hang || '',
                ten_khach_hang: order.khach_hang_id?.ten_khach_hang || '',
                sdt: order.khach_hang_id?.sdt || order.khach_hang_id?.sdt2 || '',
                trang_thai: order.trang_thai,
                trang_thai_giao_hang: order.trang_thai_giao_hang
            }));
        res.json({ success: true, data });
    } catch (error) {
        next(error);
    }
};


exports.postGopDon = async (req, res, next) => {
    const session = await mongoose.startSession();
    try {
        let result;
        await session.withTransaction(async () => {
            result = await mergeOrdersInSession(req, session);
        });
        res.json({
            success: true,
            message: 'Gộp đơn thành công',
            data: result
        });
    } catch (error) {
        if (error.status) {
            return res.status(error.status).json({ success: false, message: error.message });
        }
        next(error);
    } finally {
        await session.endSession();
    }
};


exports.getGopHoaDonCandidates = async (req, res, next) => {
    try {
        const days = Math.max(1, Math.min(90, Number(req.query.days || 7)));
        const fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        const filter = {
            trang_thai_du_lieu: 'active',
            ngay_ban: { $gte: fromDate },
            trang_thai: { $nin: ['cancelled', 'merged'] }
        };
        if (req.query.khach_hang_id && mongoose.Types.ObjectId.isValid(String(req.query.khach_hang_id))) {
            filter.khach_hang_id = req.query.khach_hang_id;
        }

        let invoices = await HoaDonBanHang.find(filter)
            .populate('khach_hang_id')
            .sort({ ngay_ban: -1 })
            .lean();

        const normalizedPhone = normalizePhone(req.query.sdt);
        if (normalizedPhone) {
            const invoiceIds = invoices.map(item => item._id);
            const shipments = invoiceIds.length
                ? await VanDon.find({
                    $or: [
                        { hoa_don_id: { $in: invoiceIds } },
                        { don_hang_id: { $in: invoices.map(item => item.don_hang_id).filter(Boolean) } }
                    ]
                }).select('hoa_don_id don_hang_id sdt_nguoi_nhan').lean()
                : [];
            const shipmentByInvoice = {};
            shipments.forEach(row => {
                if (row.hoa_don_id) shipmentByInvoice[String(row.hoa_don_id)] = row;
            });
            invoices.forEach(invoice => {
                const orderId = String(invoice.don_hang_id || '');
                if (!orderId) return;
                const shipment = shipments.find(row => String(row.don_hang_id || '') === orderId);
                if (shipment && !shipmentByInvoice[String(invoice._id)]) {
                    shipmentByInvoice[String(invoice._id)] = shipment;
                }
            });
            invoices = invoices.filter(invoice => {
                const shipment = shipmentByInvoice[String(invoice._id)];
                return invoiceCustomerPhone(invoice, shipment) === normalizedPhone;
            });
        }

        const invoiceIds = invoices.map(item => item._id);
        const paidMap = await loadInvoiceNetPaidMap(invoiceIds);
        const returnRows = invoiceIds.length
            ? await PhieuTraHang.find({
                hoa_don_id: { $in: invoiceIds },
                trang_thai: { $ne: 'cancelled' }
            }).select('hoa_don_id').lean()
            : [];
        const returnInvoiceIds = new Set(returnRows.map(row => String(row.hoa_don_id || '')));
        invoices = invoices.filter(invoice => !returnInvoiceIds.has(String(invoice._id)));

        const data = invoices.map(invoice => ({
                _id: invoice._id,
                ma_hoa_don: invoice.ma_hoa_don,
                ngay_ban: invoice.ngay_ban,
                khach_can_tra: Number(invoice.thanh_toan || 0),
                khach_da_tra: Number(paidMap[String(invoice._id)] || 0),
                ma_khach_hang: invoice.khach_hang_id?.ma_khach_hang || '',
                ten_khach_hang: invoice.khach_hang_id?.ten_khach_hang || '',
                sdt: invoice.khach_hang_id?.sdt || invoice.khach_hang_id?.sdt2 || '',
                trang_thai: normalizeInvoiceStatus(invoice.trang_thai)
            }));
        res.json({ success: true, data });
    } catch (error) {
        next(error);
    }
};


exports.postGopHoaDon = async (req, res, next) => {
    const session = await mongoose.startSession();
    try {
        let result;
        await session.withTransaction(async () => {
            result = await mergeInvoicesInSession(req, session);
        });
        res.json({
            success: true,
            message: 'Gộp hóa đơn thành công',
            data: result
        });
    } catch (error) {
        if (error.status) {
            return res.status(error.status).json({ success: false, message: error.message });
        }
        next(error);
    } finally {
        await session.endSession();
    }
};


