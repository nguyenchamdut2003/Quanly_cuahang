const mongoose = require('mongoose');
const {
    Counter,
    CuaHang,
    KhachHang,
    Kho,
    HangHoa,
    DonHang,
    CTDonHang,
    HoaDonBanHang,
    CTHoaDonBanHang,
    TonKho,
    TonKhoLo,
    TonKhoLoQuyCach
} = require('../models/kiot.model');
const { truTonKho } = require('./kho.service');
const { parseVatChuaImportInput, assertVatChuaImportInput } = require('./vatChuaImport.service');
const { exportVatChuaWithOrderDelivery, exportVatChuaWithInvoice } = require('./vatChuaExport.service');

function createHttpError(statusCode, message, details) {
    const error = new Error(message || 'Yêu cầu không hợp lệ');
    error.statusCode = statusCode || 400;
    if (details) error.details = details;
    return error;
}

function optionalObjectId(value) {
    const id = String(value?._id || value || '').trim();
    return /^[0-9a-fA-F]{24}$/.test(id) ? id : null;
}

function parseSubmitItems(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    if (typeof raw === 'string') {
        try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch (error) {
            return [];
        }
    }
    return [];
}

async function resolveStoreId(req) {
    const sessionStoreId = req && req.session ? String(req.session.cua_hang_id || '').trim() : '';
    if (sessionStoreId && mongoose.Types.ObjectId.isValid(sessionStoreId)) return sessionStoreId;
    const userStoreId = req && req.user ? String(req.user.cua_hang_id || '').trim() : '';
    if (userStoreId && mongoose.Types.ObjectId.isValid(userStoreId)) return userStoreId;
    const activeStore = await CuaHang.findOne({ trang_thai: 'active' }).sort({ created_at: 1 }).lean();
    return activeStore ? String(activeStore._id) : '';
}

async function generateOrderCode() {
    const lastOrder = await DonHang.findOne({ ma_don_hang: /^DH\d+$/ })
        .sort({ ma_don_hang: -1 })
        .select('ma_don_hang')
        .lean();
    const currentMax = Number(String(lastOrder?.ma_don_hang || '').replace(/^DH/, '')) || 0;
    await Counter.updateOne({ _id: 'don_hang' }, { $max: { seq: currentMax } }, { upsert: true });
    const counter = await Counter.findOneAndUpdate(
        { _id: 'don_hang' },
        { $inc: { seq: 1 } },
        { new: true, upsert: true }
    ).lean();
    return 'DH' + String(counter.seq).padStart(6, '0');
}

async function generateInvoiceCode() {
    const lastInvoice = await HoaDonBanHang.findOne({ ma_hoa_don: /^HD\d+$/ })
        .sort({ ma_hoa_don: -1 })
        .select('ma_hoa_don')
        .lean();
    const currentMax = Number(String(lastInvoice?.ma_hoa_don || '').replace(/^HD/, '')) || 0;
    await Counter.updateOne({ _id: 'hoa_don_ban_hang' }, { $max: { seq: currentMax } }, { upsert: true });
    const counter = await Counter.findOneAndUpdate(
        { _id: 'hoa_don_ban_hang' },
        { $inc: { seq: 1 } },
        { new: true }
    ).lean();
    return 'HD' + String(counter.seq).padStart(6, '0');
}

function applyLotAllocationsToInvoiceLine(allocations) {
    const rows = Array.isArray(allocations)
        ? allocations.filter(row => Number(row.so_luong) > 0 && row.lo_hang_id)
        : [];
    return {
        lot_allocations: rows,
        lo_hang_id: rows.length === 1 ? rows[0].lo_hang_id : null
    };
}

function groupItemsByKho(items) {
    const map = new Map();
    items.forEach(item => {
        const khoId = String(item.kho_id || '');
        if (!khoId) return;
        if (!map.has(khoId)) map.set(khoId, []);
        map.get(khoId).push(item);
    });
    return map;
}

async function getAvailableQty(item, storeId) {
    const qty = Math.max(0, Number(item.so_luong || 0));
    const khoId = optionalObjectId(item.kho_id);
    const productId = optionalObjectId(item.hang_hoa_id);
    if (!khoId || !productId) return 0;

    const tenQuyCach = String(item.ten_quy_cach || '').trim();
    const lotId = optionalObjectId(item.lo_hang_id);
    const giaTriId = optionalObjectId(item.gia_tri_thuoc_tinh_id);

    if (lotId && (tenQuyCach || giaTriId)) {
        const qcQuery = {
            kho_id: khoId,
            hang_hoa_id: productId,
            lo_hang_id: lotId,
            so_luong: { $gt: 0 }
        };
        if (giaTriId) qcQuery.gia_tri_thuoc_tinh_id = giaTriId;
        else if (tenQuyCach && tenQuyCach !== '---') qcQuery.ten_quy_cach = tenQuyCach;
        const qcRow = await TonKhoLoQuyCach.findOne(qcQuery).lean();
        return Math.max(0, Number(qcRow?.so_luong || 0));
    }

    if (lotId) {
        const lotRow = await TonKhoLo.findOne({ kho_id: khoId, hang_hoa_id: productId, lo_hang_id: lotId }).lean();
        return Math.max(0, Number(lotRow?.so_luong || 0));
    }

    const tonRow = await TonKho.findOne({ kho_id: khoId, hang_hoa_id: productId }).lean();
    return Math.max(0, Number(tonRow?.so_luong || 0));
}

async function normalizeSubmitItems(rawItems, storeId) {
    const normalized = [];
    const warnings = [];
    for (const row of rawItems) {
        const hangHoaId = optionalObjectId(row.hang_hoa_id || row.product_id);
        const khoId = optionalObjectId(row.kho_id);
        const quantity = Number(row.so_luong);
        const unitPrice = Number(row.don_gia_ban ?? row.don_gia);
        if (!hangHoaId || !khoId || !Number.isFinite(quantity) || quantity <= 0) continue;
        if (!Number.isFinite(unitPrice) || unitPrice < 0) {
            throw createHttpError(400, 'Đơn giá không hợp lệ.');
        }

        const product = await HangHoa.findById(hangHoaId).lean();
        if (!product) throw createHttpError(400, 'Không tìm thấy hàng hóa.');
        const kho = await Kho.findById(khoId).lean();
        if (!kho) throw createHttpError(400, 'Kho không hợp lệ.');
        if (String(kho.cua_hang_id || '') !== String(storeId)) {
            throw createHttpError(400, 'Kho không thuộc cửa hàng đang làm việc.');
        }

        const tenQuyCach = String(row.ten_quy_cach || '').trim();
        const loHangId = optionalObjectId(row.lo_hang_id);
        const giaTriId = optionalObjectId(row.gia_tri_thuoc_tinh_id);
        const lineBase = {
            hang_hoa_id: hangHoaId,
            kho_id: khoId,
            lo_hang_id: loHangId,
            gia_tri_thuoc_tinh_id: giaTriId,
            ten_quy_cach: tenQuyCach && tenQuyCach !== '---' ? tenQuyCach : '',
            ten_thuoc_tinh: tenQuyCach && tenQuyCach !== '---' ? tenQuyCach : '',
            don_vi_tinh_id: optionalObjectId(row.don_vi_tinh_id || product.don_vi_tinh_id),
            ma_hang_snapshot: String(product.ma_hang || ''),
            ten_hang_snapshot: String(product.ten_hang || ''),
            don_vi_tinh_snapshot: String(row.don_vi_tinh_ten || ''),
            so_luong: quantity,
            don_gia_ban: unitPrice,
            thanh_tien: Math.max(quantity * unitPrice, 0),
            gia_goc: Number(product.gia_co_dinh || product.gia_von || 0),
            line_key: String(row.line_key || '')
        };

        const available = await getAvailableQty(lineBase, storeId);
        const vuotTon = quantity > available;
        if (vuotTon) {
            warnings.push({
                ten_hang: lineBase.ten_hang_snapshot,
                ten_quy_cach: lineBase.ten_quy_cach,
                so_luong: quantity,
                ton_kha_dung: available
            });
        }

        normalized.push(Object.assign({}, lineBase, { vuot_ton: vuotTon }));
    }

    if (!normalized.length) {
        throw createHttpError(400, 'Chưa có dòng phân bổ hợp lệ (số lượng > 0).');
    }
    return { normalized, warnings };
}

async function createDraftOrderGroup({ storeId, khoId, khachHangId, items, userId, ghiChu }) {
    const tongTienHang = items.reduce((sum, item) => sum + Number(item.thanh_tien || 0), 0);
    const maDonHang = await generateOrderCode();
    const order = await DonHang.create({
        ma_don_hang: maDonHang,
        khach_hang_id: khachHangId,
        cua_hang_id: storeId,
        kho_id: khoId,
        nguoi_tao_id: userId || null,
        ngay_dat: new Date(),
        ngay_tao: new Date(),
        tong_tien: tongTienHang,
        tong_tien_hang: tongTienHang,
        giam_gia: 0,
        kieu_giam_gia: 'vnd',
        tong_thanh_toan: tongTienHang,
        khach_can_tra: tongTienHang,
        khach_thanh_toan: 0,
        tien_thua_tra_khach: 0,
        cod_enabled: false,
        cod_amount: 0,
        trang_thai: 'draft',
        trang_thai_giao_hang: 'chua_giao',
        ghi_chu: ghiChu || 'Phân bổ hàng tồn kho'
    });

    for (const item of items) {
        await CTDonHang.create({
            don_hang_id: order._id,
            hang_hoa_id: item.hang_hoa_id,
            lo_hang_id: item.lo_hang_id || null,
            gia_tri_thuoc_tinh_id: item.gia_tri_thuoc_tinh_id || null,
            ten_quy_cach: item.ten_quy_cach,
            ten_thuoc_tinh: item.ten_thuoc_tinh,
            don_vi_tinh_id: item.don_vi_tinh_id || null,
            so_luong: item.so_luong,
            so_luong_dat: item.so_luong,
            so_luong_xac_nhan: 0,
            so_luong_da_giao: 0,
            so_luong_con_thieu: item.so_luong,
            trang_thai_giao: 'chua_giao',
            don_gia_ban: item.don_gia_ban,
            ma_hang_snapshot: item.ma_hang_snapshot,
            ten_hang_snapshot: item.ten_hang_snapshot,
            don_vi_tinh_snapshot: item.don_vi_tinh_snapshot,
            gia_goc: item.gia_goc,
            chiet_khau: 0,
            kieu_chiet_khau: 'vnd',
            thanh_tien: item.thanh_tien,
            ghi_chu: 'Phân bổ tồn kho'
        });
    }

    return {
        type: 'don_hang',
        id: String(order._id),
        ma: maDonHang,
        url: '/don-hang?open=' + encodeURIComponent(String(order._id))
    };
}

async function createInvoiceGroup({ storeId, khoId, khachHangId, items, userId, ghiChu }) {
    const tongTienHang = items.reduce((sum, item) => sum + Number(item.thanh_tien || 0), 0);
    const maHoaDon = await generateInvoiceCode();
    const invoice = await HoaDonBanHang.create({
        ma_hoa_don: maHoaDon,
        ngay_ban: new Date(),
        tong_tien: tongTienHang,
        giam_gia: 0,
        thanh_toan: tongTienHang,
        phuong_thuc_tt: 'Tiền mặt',
        trang_thai: 'unpaid',
        ghi_chu: ghiChu || 'Phân bổ hàng tồn kho',
        cua_hang_id: storeId,
        kho_id: khoId,
        khach_hang_id: khachHangId,
        nguoi_ban_id: userId || null
    });

    const lineRefs = [];
    for (const item of items) {
        const invoiceLine = await CTHoaDonBanHang.create({
            hoa_don_id: invoice._id,
            hang_hoa_id: item.hang_hoa_id,
            lo_hang_id: item.lo_hang_id || undefined,
            gia_tri_thuoc_tinh_id: item.gia_tri_thuoc_tinh_id || null,
            ten_quy_cach: item.ten_quy_cach,
            ten_thuoc_tinh: item.ten_thuoc_tinh,
            don_vi_tinh_id: item.don_vi_tinh_id || null,
            ma_hang_snapshot: item.ma_hang_snapshot,
            ten_hang_snapshot: item.ten_hang_snapshot,
            don_vi_tinh_snapshot: item.don_vi_tinh_snapshot,
            so_luong: item.so_luong,
            don_gia: item.don_gia_ban,
            chiet_khau: 0,
            thanh_tien: item.thanh_tien,
            ghi_chu: 'Phân bổ tồn kho'
        });
        lineRefs.push({ invoiceLineId: invoiceLine._id, item });
    }

    try {
        for (const { invoiceLineId, item } of lineRefs) {
            const stockResult = await truTonKho({
                kho_id: khoId,
                hang_hoa_id: item.hang_hoa_id,
                lo_hang_id: item.lo_hang_id || undefined,
                ten_quy_cach: item.ten_quy_cach || item.ten_thuoc_tinh || '',
                gia_tri_thuoc_tinh_id: item.gia_tri_thuoc_tinh_id || undefined,
                sync_quy_cach: Boolean(item.gia_tri_thuoc_tinh_id || item.ten_quy_cach || item.ten_thuoc_tinh),
                so_luong: Number(item.so_luong || 0),
                nguoi_tao_id: userId,
                loai_phieu: 'ban_hang',
                ma_phieu: maHoaDon,
                ghi_chu: 'Xuất kho HĐ ' + maHoaDon,
                allow_negative: true
            });
            const lotPatch = applyLotAllocationsToInvoiceLine(stockResult.allocations);
            if (invoiceLineId) {
                await CTHoaDonBanHang.updateOne({ _id: invoiceLineId }, { $set: lotPatch });
            }
        }
        invoice.da_tru_ton_kho = true;
        await invoice.save();
    } catch (stockError) {
        await HoaDonBanHang.deleteOne({ _id: invoice._id });
        await CTHoaDonBanHang.deleteMany({ hoa_don_id: invoice._id });
        throw createHttpError(400, stockError.message || 'Không trừ được tồn kho khi tạo hóa đơn.');
    }

    return {
        type: 'hoa_don',
        id: String(invoice._id),
        ma: maHoaDon,
        url: '/don-hang/hoa-don?open=' + encodeURIComponent(String(invoice._id))
    };
}

async function exportVatChuaForBatch({ mode, customer, created, vatChuaData }) {
    const parsed = parseVatChuaImportInput(vatChuaData || {});
    assertVatChuaImportInput(parsed);
    if (!parsed.vatChuaId || parsed.qty <= 0) return null;

    if (!Array.isArray(created) || !created.length) return null;
    const firstDoc = created[0];
    const docId = optionalObjectId(firstDoc?.id);
    if (!docId) return null;

    const payload = {
        vat_chua_id: parsed.vatChuaId,
        vat_chua_so_luong: parsed.qty,
        khach_hang_ten: customer?.ten_khach_hang || ''
    };

    if (mode === 'hoa_don') {
        const invoice = await HoaDonBanHang.findById(docId).lean();
        if (!invoice) throw createHttpError(400, 'Không tìm thấy hóa đơn để xuất vật chứa.');
        return exportVatChuaWithInvoice(invoice, payload);
    }

    const order = await DonHang.findById(docId).lean();
    if (!order) throw createHttpError(400, 'Không tìm thấy đơn hàng để xuất vật chứa.');
    return exportVatChuaWithOrderDelivery(order, null, payload);
}

async function processCustomerBatch({ mode, storeId, khachHangId, rawItems, userId, ghiChu, vatChuaData }) {
    const customer = await KhachHang.findById(khachHangId).lean();
    if (!customer) throw createHttpError(400, 'Khách hàng không tồn tại.');

    const { normalized: normalizedItems, warnings } = await normalizeSubmitItems(rawItems, storeId);
    const groups = groupItemsByKho(normalizedItems);
    if (!groups.size) throw createHttpError(400, 'Thiếu thông tin kho trên các dòng phân bổ.');

    const created = [];
    for (const [khoId, items] of groups.entries()) {
        if (mode === 'hoa_don') {
            created.push(await createInvoiceGroup({
                storeId,
                khoId,
                khachHangId,
                items,
                userId,
                ghiChu
            }));
        } else {
            created.push(await createDraftOrderGroup({
                storeId,
                khoId,
                khachHangId,
                items,
                userId,
                ghiChu
            }));
        }
    }

    let vatChuaExport = null;
    try {
        vatChuaExport = await exportVatChuaForBatch({
            mode,
            customer,
            created,
            vatChuaData
        });
    } catch (vatChuaError) {
        throw createHttpError(400, vatChuaError.message || 'Không xuất được vật chứa cho khách hàng.');
    }

    return {
        khach_hang: {
            id: String(customer._id),
            ma_khach_hang: customer.ma_khach_hang || '',
            ten_khach_hang: customer.ten_khach_hang || ''
        },
        created,
        normalizedItems,
        warnings,
        vat_chua_exported: Boolean(vatChuaExport)
    };
}

function parseBatchVatChua(batch) {
    const parsed = parseVatChuaImportInput({
        vat_chua_id: batch?.vat_chua_id,
        vat_chua_so_luong: batch?.vat_chua_so_luong
    });
    assertVatChuaImportInput(parsed);
    if (!parsed.vatChuaId || parsed.qty <= 0) return null;
    return {
        vat_chua_id: parsed.vatChuaId,
        vat_chua_so_luong: parsed.qty
    };
}

function parseSubmitBatches(body) {
    if (Array.isArray(body?.batches) && body.batches.length) {
        return body.batches
            .map(batch => ({
                khach_hang_id: optionalObjectId(batch?.khach_hang_id),
                items: parseSubmitItems(batch?.items),
                vat_chua_id: batch?.vat_chua_id || '',
                vat_chua_so_luong: batch?.vat_chua_so_luong
            }))
            .filter(batch => batch.khach_hang_id && batch.items.length);
    }

    const khachHangId = optionalObjectId(body?.khach_hang_id);
    const items = parseSubmitItems(body?.items);
    if (khachHangId && items.length) {
        return [{
            khach_hang_id: khachHangId,
            items,
            vat_chua_id: body?.vat_chua_id || '',
            vat_chua_so_luong: body?.vat_chua_so_luong
        }];
    }
    return [];
}

async function submitStockAllocation(req) {
    const body = req.body || {};
    const mode = String(body.mode || 'don_hang').trim() === 'hoa_don' ? 'hoa_don' : 'don_hang';
    const batches = parseSubmitBatches(body);
    if (!batches.length) throw createHttpError(400, 'Vui lòng chọn khách hàng và nhập số lượng phân bổ.');

    const storeId = await resolveStoreId(req);
    if (!storeId) throw createHttpError(400, 'Chưa chọn cửa hàng làm việc.');

    const created = [];
    const customers = [];
    const warnings = [];
    let totalQty = 0;
    let totalAmount = 0;
    let lineCount = 0;

    for (const batch of batches) {
        let vatChuaData = null;
        try {
            vatChuaData = parseBatchVatChua(batch);
        } catch (vatChuaError) {
            throw createHttpError(400, vatChuaError.message || 'Thông tin vật chứa không hợp lệ.');
        }
        const result = await processCustomerBatch({
            mode,
            storeId,
            khachHangId: batch.khach_hang_id,
            rawItems: batch.items,
            userId: req.user?._id,
            ghiChu: body.ghi_chu,
            vatChuaData
        });
        customers.push(result.khach_hang);
        if (Array.isArray(result.warnings) && result.warnings.length) {
            warnings.push(...result.warnings.map(function(warning) {
                return Object.assign({}, warning, {
                    khach_hang_id: result.khach_hang.id,
                    ten_khach_hang: result.khach_hang.ten_khach_hang
                });
            }));
        }
        created.push(...result.created.map(doc => Object.assign({}, doc, {
            khach_hang_id: result.khach_hang.id,
            ten_khach_hang: result.khach_hang.ten_khach_hang
        })));
        lineCount += result.normalizedItems.length;
        totalQty += result.normalizedItems.reduce((sum, item) => sum + Number(item.so_luong || 0), 0);
        totalAmount += result.normalizedItems.reduce((sum, item) => sum + Number(item.thanh_tien || 0), 0);
    }

    const docLabel = mode === 'hoa_don' ? 'hóa đơn' : 'đơn hàng';
    let message = 'Đã tạo ' + created.length + ' ' + docLabel + ' cho ' + customers.length + ' khách hàng.';
    if (created.length === 1 && customers.length === 1) {
        message = 'Đã tạo ' + docLabel + ' thành công.';
    }

    return {
        success: true,
        message,
        mode,
        khach_hang_list: customers,
        summary: {
            customer_count: customers.length,
            line_count: lineCount,
            total_qty: totalQty,
            total_amount: totalAmount
        },
        warnings,
        created
    };
}

module.exports = {
    submitStockAllocation
};
