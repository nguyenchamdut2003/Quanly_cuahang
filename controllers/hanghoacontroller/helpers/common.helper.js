var mongoose = require('mongoose');
const { getReservedQuantitiesByOrder, getReservedQuantitiesForSale, buildVariantKey, buildLotKey } = require('../../../services/availability.service');
var querystring = require('querystring');
var path = require('path');
var {
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
    VatChua
} = require('../../../models/kiot.model');
var pdfService = require('../../../services/pdf.service');
var { buildLotProfitReport } = require('../../../services/lotProfitReport.service');
var { submitStockAllocation } = require('../../../services/allocationSubmit.service');
var { previewProductTrash, moveProductsToTrash } = require('../../../services/productTrash.service');
var { measureAsync, isPerformanceEnabled } = require('../../../utils/performance.util');
var {
    resolveSalePrice,
    buildPriceSetupLines,
    upsertGiaBanHangHoa
} = require('../../../services/salePrice.service');

function formatDate(value) {
    if (!value) return '---';
    return new Date(value).toLocaleString('vi-VN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function normalizeStockNumber(value) {
    var number = Number(value || 0);
    return Number.isFinite(number) ? number : 0;
}

function isExpiredLot(lot) {
    if (!lot || !lot.han_su_dung) return false;
    var expiry = new Date(lot.han_su_dung);
    if (isNaN(expiry.getTime())) return false;
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    expiry.setHours(0, 0, 0, 0);
    return expiry.getTime() < today.getTime();
}

function isSellableLot(lot) {
    if (!lot || lot.trang_thai === 'huy') return false;
    return !isExpiredLot(lot);
}

function normalizeFilterQuery(query) {
    query = query || {};
    return {
        groupId: String(query.groupId || 'all').trim() || 'all',
        supplierId: String(query.supplierId || 'all').trim() || 'all',
        stockFrom: String(query.stockFrom || '').trim(),
        stockTo: String(query.stockTo || '').trim(),
        created: ['all', 'custom'].indexOf(query.created) >= 0 ? query.created : 'all',
        createdFrom: String(query.createdFrom || '').trim(),
        createdTo: String(query.createdTo || '').trim(),
        salesLink: ['all', 'yes', 'no'].indexOf(query.salesLink) >= 0 ? query.salesLink : 'all',
        status: query.status === 'inactive' ? 'inactive' : 'all',
        keyword: String(query.keyword || '').trim(),
        bangGiaIds: normalizeBangGiaIdsFromQuery(query)
    };
}

/** Danh sÃ¡ch máº·c Ä‘á»‹nh: chá»‰ active; chá»‰ khi filter "Ngá»«ng kinh doanh" má»›i láº¥y inactive. */
function applyProductListStatusFilter(productQuery, filter) {
    productQuery.$and = (productQuery.$and || []).concat([{ $or: [{ deleted_at: null }, { deleted_at: { $exists: false } }] }]);
    if (filter && filter.status === 'inactive') {
        productQuery.trang_thai = 'inactive';
    } else {
        productQuery.trang_thai = 'active';
    }
}

function normalizeBangGiaIdsFromQuery(query) {
    var raw = query && query.bangGia;
    if (raw == null || raw === '') return [];
    if (!Array.isArray(raw)) raw = [raw];
    var seen = {};
    var out = [];
    raw.forEach(function(x) {
        var id = String(x || '').trim();
        if (!id || seen[id]) return;
        if (!mongoose.Types.ObjectId.isValid(id)) return;
        seen[id] = true;
        out.push(id);
    });
    return out;
}

function normalizePriceSetupQuery(query) {
    query = query || {};
    var page = parseInt(query.page, 10);
    var limit = 10;
    if (!Number.isFinite(page) || page < 1) page = 1;
    var stock = String(query.stock || 'all').trim();
    if (['all', 'co_ton', 'het_hang'].indexOf(stock) < 0) stock = 'all';
    return {
        keyword: String(query.keyword || '').trim(),
        groupId: String(query.groupId || 'all').trim() || 'all',
        stock: stock,
        filterMa: String(query.filterMa || '').trim(),
        filterTen: String(query.filterTen || '').trim(),
        bangGiaIds: normalizeBangGiaIdsFromQuery(query),
        page: page,
        limit: limit
    };
}

function buildPriceSetupQueryString(filter) {
    var params = [];
    if (filter.keyword) params.push('keyword=' + encodeURIComponent(filter.keyword));
    if (filter.groupId !== 'all') params.push('groupId=' + encodeURIComponent(filter.groupId));
    if (filter.stock !== 'all') params.push('stock=' + encodeURIComponent(filter.stock));
    if (filter.filterMa) params.push('filterMa=' + encodeURIComponent(filter.filterMa));
    if (filter.filterTen) params.push('filterTen=' + encodeURIComponent(filter.filterTen));
    (filter.bangGiaIds || []).forEach(function(id) {
        params.push('bangGia=' + encodeURIComponent(id));
    });
    if (filter.page > 1) params.push('page=' + encodeURIComponent(filter.page));
    return params.join('&');
}

async function loadAvgLotCostByProductId(productIds) {
    var map = {};
    if (!productIds || !productIds.length) return map;

    var rows = await TonKhoLo.aggregate([
        { $match: { hang_hoa_id: { $in: productIds }, so_luong: { $gt: 0 } } },
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

    rows.forEach(function(row) {
        var totalQty = Number(row.totalQty || 0);
        var totalValue = Number(row.totalValue || 0);
        map[String(row._id)] = {
            totalQty: totalQty,
            avgCost: totalQty > 0 ? Math.round(totalValue / totalQty) : 0
        };
    });
    return map;
}

async function loadAvgSalePriceByProductId(productIds) {
    var map = {};
    if (!productIds || !productIds.length) return map;

    var rows = await CTHoaDonBanHang.aggregate([
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
        { $match: { 'invoice.trang_thai': { $ne: 'cancelled' } } },
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

    rows.forEach(function(row) {
        var totalQty = Number(row.totalQty || 0);
        var totalRevenue = Number(row.totalRevenue || 0);
        map[String(row._id)] = {
            totalQty: totalQty,
            avgPrice: totalQty > 0 ? Math.round(totalRevenue / totalQty) : null
        };
    });
    return map;
}

async function buildProductListPriceMaps(productIds) {
    var ids = productIds || [];
    var results = await Promise.all([
        loadAvgLotCostByProductId(ids),
        loadAvgSalePriceByProductId(ids)
    ]);
    return {
        avgCostByProductId: results[0],
        avgSalePriceByProductId: results[1]
    };
}

function applyProductListPriceFields(item, priceMaps) {
    priceMaps = priceMaps || {};
    var pid = String(item._id || '');
    var lotStats = priceMaps.avgCostByProductId && priceMaps.avgCostByProductId[pid];
    var saleStats = priceMaps.avgSalePriceByProductId && priceMaps.avgSalePriceByProductId[pid];

    if (lotStats && lotStats.totalQty > 0) {
        item.gia_von_trung_binh_hien_thi = Number(lotStats.avgCost || 0);
    } else {
        item.gia_von_trung_binh_hien_thi = Number(item.gia_von || 0);
    }

    if (saleStats && saleStats.totalQty > 0) {
        item.gia_ban_trung_binh_hien_thi = Number(saleStats.avgPrice || 0);
    } else {
        item.gia_ban_trung_binh_hien_thi = null;
    }

    return item;
}

function buildFilterQueryString(filter) {
    var params = [];
    if (filter.groupId !== 'all') params.push('groupId=' + encodeURIComponent(filter.groupId));
    if (filter.supplierId !== 'all') params.push('supplierId=' + encodeURIComponent(filter.supplierId));
    if (filter.stockFrom) params.push('stockFrom=' + encodeURIComponent(filter.stockFrom));
    if (filter.stockTo) params.push('stockTo=' + encodeURIComponent(filter.stockTo));
    if (filter.created !== 'all') params.push('created=' + encodeURIComponent(filter.created));
    if (filter.created === 'custom' && filter.createdFrom) params.push('createdFrom=' + encodeURIComponent(filter.createdFrom));
    if (filter.created === 'custom' && filter.createdTo) params.push('createdTo=' + encodeURIComponent(filter.createdTo));
    if (filter.salesLink !== 'all') params.push('salesLink=' + encodeURIComponent(filter.salesLink));
    if (filter.status !== 'all') params.push('status=' + encodeURIComponent(filter.status));
    if (filter.keyword) params.push('keyword=' + encodeURIComponent(filter.keyword));
    (filter.bangGiaIds || []).forEach(function(id) {
        params.push('bangGia=' + encodeURIComponent(id));
    });
    return params.join('&');
}

function decodeLegacyEntities(value) {
    var text = String(value == null ? '' : value);
    if (!text || !/&(?:#x?[0-9a-f]+|[a-z]+);/i.test(text)) return text;
    return text
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/&#(\d+);/g, function(_match, code) {
            var num = Number(code);
            return Number.isFinite(num) ? String.fromCharCode(num) : _match;
        })
        .replace(/&#x([0-9a-f]+);/gi, function(_match, hex) {
            var num = parseInt(hex, 16);
            return Number.isFinite(num) ? String.fromCharCode(num) : _match;
        });
}

function normalizeProductNotePayload(body) {
    body = body || {};
    return {
        mo_ta: String(body.mo_ta == null ? '' : body.mo_ta).trim(),
        ghi_chu_dat_hang: String(body.ghi_chu_dat_hang == null ? '' : body.ghi_chu_dat_hang).trim()
    };
}

function normalizeProductPayload(body) {
    body = body || {};
    var giaVonRaw = Number(body.gia_von || 0);
    var giaCoDinhRaw = Number(body.gia_co_dinh || 0);
    var tonBanDauRaw = Number(body.ton_ban_dau || 0);
    var dinhMucRaw = Number(body.dinh_muc_toi_thieu || 0);
    return {
        ma_hang: String(body.ma_hang || '').trim(),
        ten_hang: String(body.ten_hang || '').trim(),
        mo_ta: String(body.mo_ta || '').trim(),
        ghi_chu_dat_hang: String(body.ghi_chu_dat_hang || '').trim(),
        nhom_hang_id: String(body.nhom_hang_id || '').trim() || null,
        don_vi_tinh_id: String(body.don_vi_tinh_id || '').trim() || null,
        nha_cung_cap_id: String(body.nha_cung_cap_id || '').trim() || null,
        gia_von: Number.isFinite(giaVonRaw) && giaVonRaw > 0 ? giaVonRaw : 0,
        loai_gia: body.loai_gia === 'co_dinh' ? 'co_dinh' : 'thi_truong',
        gia_co_dinh: Number.isFinite(giaCoDinhRaw) && giaCoDinhRaw > 0 ? giaCoDinhRaw : 0,
        ton_ban_dau: Number.isFinite(tonBanDauRaw) && tonBanDauRaw > 0 ? tonBanDauRaw : 0,
        dinh_muc_toi_thieu: Number.isFinite(dinhMucRaw) && dinhMucRaw > 0 ? dinhMucRaw : 0,
        ban_truc_tiep: body.ban_truc_tiep === 'false' ? false : true,
        quan_ly_theo_lo: body.quan_ly_theo_lo === 'true' || body.quan_ly_theo_lo === 'on',
        han_su_dung_mac_dinh_so_ngay: Number.isFinite(Number(body.han_su_dung_mac_dinh_so_ngay)) && Number(body.han_su_dung_mac_dinh_so_ngay) >= 0 ? Number(body.han_su_dung_mac_dinh_so_ngay) : 5,
        trang_thai: body.trang_thai === 'inactive' ? 'inactive' : 'active'
    };
}

function normalizeAttributePayload(body) {
    body = body || {};
    return {
        ma_thuoc_tinh: String(body.ma_thuoc_tinh || '').trim(),
        ten_thuoc_tinh: String(body.ten_thuoc_tinh || '').trim(),
        mo_ta: String(body.mo_ta || '').trim(),
        trang_thai: body.trang_thai === 'inactive' ? 'inactive' : 'active'
    };
}

function normalizeAttributeValuePayload(body) {
    body = body || {};
    var order = Number(body.thu_tu || 0);
    if (!Number.isFinite(order) || order < 0) order = 0;
    return {
        ma_gia_tri: String(body.ma_gia_tri || '').trim(),
        ten_gia_tri: String(body.ten_gia_tri || '').trim(),
        mo_ta: String(body.mo_ta || '').trim(),
        thu_tu: Math.floor(order),
        trang_thai: body.trang_thai === 'inactive' ? 'inactive' : 'active'
    };
}

async function nextAttributeCode(storeId) {
    var query = { ma_thuoc_tinh: /^TT\d+$/ };
    if (storeId && mongoose.Types.ObjectId.isValid(storeId)) query.cua_hang_id = storeId;
    var last = await ThuocTinhHang.findOne(query).sort({ ma_thuoc_tinh: -1 }).lean();
    var nextNumber = last ? Number(String(last.ma_thuoc_tinh || '').replace(/\D/g, '')) + 1 : 1;
    return 'TT' + String(nextNumber).padStart(4, '0');
}

async function nextAttributeValueCode(attributeId) {
    var last = await GiaTriThuocTinh.findOne({ thuoc_tinh_id: attributeId, ma_gia_tri: /^GT\d+$/ }).sort({ ma_gia_tri: -1 }).lean();
    var nextNumber = last ? Number(String(last.ma_gia_tri || '').replace(/\D/g, '')) + 1 : 1;
    return 'GT' + String(nextNumber).padStart(4, '0');
}

async function ensureDefaultAttributes(storeId) {
    var query = { ten_thuoc_tinh: 'Size' };
    if (storeId && mongoose.Types.ObjectId.isValid(storeId)) query.cua_hang_id = storeId;
    var attr = await ThuocTinhHang.findOne(query);
    if (!attr) {
        attr = await ThuocTinhHang.create({
            cua_hang_id: storeId && mongoose.Types.ObjectId.isValid(storeId) ? storeId : undefined,
            ma_thuoc_tinh: 'SIZE',
            ten_thuoc_tinh: 'Size',
            mo_ta: 'KÃ­ch cá»¡ hÃ ng hÃ³a',
            trang_thai: 'active'
        });
    }
    var defaults = ['Lá»›n', 'Trung', 'Bi'];
    for (var i = 0; i < defaults.length; i++) {
        var exists = await GiaTriThuocTinh.findOne({ thuoc_tinh_id: attr._id, ten_gia_tri: defaults[i] }).select('_id').lean();
        if (!exists) {
            await GiaTriThuocTinh.create({
                cua_hang_id: attr.cua_hang_id || (storeId && mongoose.Types.ObjectId.isValid(storeId) ? storeId : undefined),
                thuoc_tinh_id: attr._id,
                ma_gia_tri: 'SIZE_' + (i + 1),
                ten_gia_tri: defaults[i],
                thu_tu: i + 1,
                trang_thai: 'active'
            });
        }
    }
    var sizeValues = await GiaTriThuocTinh.find({ thuoc_tinh_id: attr._id, ten_gia_tri: { $in: defaults } }).select('_id thuoc_tinh_id').lean();
    var cucumberProducts = await HangHoa.find({
        ten_hang: { $regex: 'DÆ°a leo Lá»—', $options: 'i' },
        trang_thai: { $ne: 'deleted' }
    }).select('_id').lean();
    for (var p = 0; p < cucumberProducts.length; p++) {
        for (var v = 0; v < sizeValues.length; v++) {
            await HangHoaThuocTinh.updateOne(
                { hang_hoa_id: cucumberProducts[p]._id, thuoc_tinh_id: attr._id, gia_tri_id: sizeValues[v]._id },
                { $setOnInsert: { hang_hoa_id: cucumberProducts[p]._id, thuoc_tinh_id: attr._id, gia_tri_id: sizeValues[v]._id } },
                { upsert: true }
            );
        }
    }
}

function normalizeSelectedAttributeValues(body) {
    var raw = body ? body.gia_tri_thuoc_tinh_ids : [];
    if (typeof raw === 'string') {
        try { raw = JSON.parse(raw); } catch (_) { raw = raw ? [raw] : []; }
    }
    if (!Array.isArray(raw)) raw = [raw];
    var seen = {};
    return raw.map(function(id) { return String(id || '').trim(); })
        .filter(function(id) {
            if (!mongoose.Types.ObjectId.isValid(id) || seen[id]) return false;
            seen[id] = true;
            return true;
        });
}

async function saveProductAttributeValues(productId, valueIds) {
    await HangHoaThuocTinh.deleteMany({ hang_hoa_id: productId });
    if (!valueIds || !valueIds.length) return;
    var values = await GiaTriThuocTinh.find({ _id: { $in: valueIds }, trang_thai: 'active' }).select('_id thuoc_tinh_id').lean();
    var rows = values.map(function(v) {
        return {
            hang_hoa_id: productId,
            thuoc_tinh_id: v.thuoc_tinh_id,
            gia_tri_id: v._id
        };
    });
    if (rows.length) await HangHoaThuocTinh.insertMany(rows, { ordered: false });
}

async function makeProductCode() {
    var lastProduct = await HangHoa.findOne({ ma_hang: /^NSTP\d+$/ }).sort({ ma_hang: -1 }).lean();
    var nextNumber = 1;
    if (lastProduct && lastProduct.ma_hang) {
        nextNumber = Number(String(lastProduct.ma_hang).replace(/\D/g, '')) + 1;
    }
    return 'NSTP' + String(nextNumber).padStart(5, '0');
}

async function makeLotCode(prefix) {
    var safePrefix = String(prefix || 'LO').replace(/[^A-Z0-9_]/gi, '').toUpperCase() || 'LO';
    var exists = await LoHang.findOne({ ma_lo: safePrefix }).select('_id').lean();
    if (!exists) return safePrefix;

    var lots = await LoHang.find({ ma_lo: new RegExp('^' + safePrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '_\\d+$') }).select('ma_lo').lean();
    var maxNumber = 0;
    lots.forEach(function(lot) {
        var num = Number(String(lot.ma_lo || '').split('_').pop());
        if (Number.isFinite(num) && num > maxNumber) maxNumber = num;
    });
    return safePrefix + '_' + String(maxNumber + 1).padStart(3, '0');
}

async function getDefaultWarehouseForProduct(product, req) {
    var storeId = await resolveStoreId(req);
    var query = {};
    if (storeId && mongoose.Types.ObjectId.isValid(storeId)) query.cua_hang_id = storeId;
    var warehouse = await Kho.findOne(query).sort({ created_at: 1, ma_kho: 1 }).lean();
    return warehouse || null;
}

async function createDefaultLotFromInventory(product, inventoryRows, req, options) {
    options = options || {};
    var createdLots = [];
    if (!product || !product._id || !product.quan_ly_theo_lo) return createdLots;

    for (var i = 0; i < (inventoryRows || []).length; i++) {
        var row = inventoryRows[i];
        var quantity = Number(row.so_luong || 0);
        if (quantity <= 0) continue;

        var existingLotQty = await TonKhoLo.aggregate([
            { $match: { kho_id: row.kho_id, hang_hoa_id: product._id } },
            { $group: { _id: null, total: { $sum: { $ifNull: ['$so_luong', 0] } } } }
        ]);
        var missingQty = quantity - Number(existingLotQty?.[0]?.total || 0);
        if (missingQty <= 0) continue;

        var maLo = await makeLotCode(options.ma_lo || ('LO_AUTO_' + String(product.ma_hang || product._id)));
        var warehouse = await Kho.findById(row.kho_id).lean();
        var storeId = row.cua_hang_id || product.cua_hang_id || warehouse?.cua_hang_id || (req.user && req.user.cua_hang_id) || undefined;
        var lot = await LoHang.create({
            cua_hang_id: storeId,
            kho_id: row.kho_id,
            hang_hoa_id: product._id,
            nha_cung_cap_id: product.nha_cung_cap_id || undefined,
            ma_lo: maLo,
            ten_lo: options.ten_lo || 'LÃ´ máº·c Ä‘á»‹nh ' + (product.ma_hang || product.ten_hang || ''),
            ngay_nhap: new Date(),
            han_su_dung: options.han_su_dung || undefined,
            so_luong_ban_dau: missingQty,
            so_luong_con_lai: missingQty,
            don_gia_nhap: Number(product.gia_nhap_cuoi || product.gia_von || 0),
            gia_von: Number(product.gia_von || 0),
            trang_thai: 'active',
            ghi_chu: options.ghi_chu || 'Táº¡o tá»± Ä‘á»™ng tá»« tá»“n hiá»‡n táº¡i'
        });

        await TonKhoLo.findOneAndUpdate(
            { kho_id: row.kho_id, hang_hoa_id: product._id, lo_hang_id: lot._id },
            {
                $setOnInsert: {
                    cua_hang_id: storeId,
                    kho_id: row.kho_id,
                    hang_hoa_id: product._id,
                    lo_hang_id: lot._id
                },
                $set: { gia_von: Number(product.gia_von || 0) },
                $inc: { so_luong: missingQty }
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        createdLots.push(lot);
    }
    return createdLots;
}

function uniqueValues(rows, key) {
    var seen = {};
    return (rows || []).map(function(row) { return String(row && row[key] || '').trim(); })
        .filter(function(value) {
            if (!value || seen[value]) return false;
            seen[value] = true;
            return true;
        });
}

function mapBy(rows, key) {
    return (rows || []).reduce(function(map, row) {
        var value = String(row && row[key] || '').trim();
        if (value) map[value] = row;
        return map;
    }, {});
}

function labelStockTransactionType(type, quantity) {
    var labels = {
        nhap_hang: 'Nhập hàng',
        tra_hang_nhap: 'Trả hàng nhà cung cấp',
        tra_hang: 'Trả hàng',
        kiem_kho: 'Kiểm hàng',
        ban_hang: 'Bán hàng',
        xuat_huy: 'Xuất hủy',
        xuat_noi_bo: 'Xuất dùng nội bộ',
        dieu_chinh: Number(quantity || 0) === 0 ? 'Cập nhật giá vốn' : 'Điều chỉnh tồn',
        rollback_ban_hang: 'Hoàn tồn bán hàng',
        huy_hoa_don: 'Hủy hóa đơn'
    };
    return labels[type] || type || '---';
}

function labelChungTuDocumentType(chungTuType, loaiPhieu, maPhieu) {
    var byChungTuType = {
        purchase: 'Phiếu nhập',
        supplier_return: 'Trả hàng nhập',
        order: 'Đơn hàng',
        invoice: 'Hóa đơn',
        customer_return: 'Trả hàng',
        stock_check: 'Kiểm kho',
        stock_disposal: 'Xuất hủy',
        internal_issue: 'Xuất nội bộ'
    };
    if (chungTuType && byChungTuType[chungTuType]) return byChungTuType[chungTuType];

    var code = String(maPhieu || '').trim().toUpperCase();
    if (/^PN/.test(code)) return 'Phiếu nhập';
    if (/^THN/.test(code)) return 'Trả hàng nhập';
    if (/^HD/.test(code)) return 'Hóa đơn';
    if (/^DH/.test(code)) return 'Đơn hàng';
    if (/^TH/.test(code)) return 'Trả hàng';
    if (/^KK/.test(code)) return 'Kiểm kho';
    if (/^XH/.test(code)) return 'Xuất hủy';
    if (/^XN/.test(code)) return 'Xuất nội bộ';

    var byLoaiPhieu = {
        nhap_hang: 'Phiếu nhập',
        tra_hang_nhap: 'Trả hàng nhập',
        ban_hang: 'Bán hàng',
        tra_hang: 'Trả hàng',
        kiem_kho: 'Kiểm kho',
        xuat_huy: 'Xuất hủy',
        xuat_noi_bo: 'Xuất nội bộ',
        dieu_chinh: 'Điều chỉnh tồn',
        rollback_ban_hang: 'Hoàn tồn bán hàng',
        huy_hoa_don: 'Hủy hóa đơn'
    };
    return byLoaiPhieu[loaiPhieu] || labelStockTransactionType(loaiPhieu) || 'Chứng từ';
}

function partnerName(doc, fallback) {
    if (!doc) return fallback || '';
    if (doc.nha_cung_cap_id) return doc.nha_cung_cap_id.ten_ncc || doc.nha_cung_cap_id.ten_nha_cung_cap || doc.nha_cung_cap_id.ten_cong_ty || doc.nha_cung_cap_id.ma_ncc || fallback || '';
    if (doc.khach_hang_id) return doc.khach_hang_id.ten_khach_hang || doc.khach_hang_id.ten_cong_ty || doc.khach_hang_id.ma_khach_hang || fallback || '';
    return doc.nguoi_nhan || fallback || '';
}

function unitPriceFromValue(value, quantity) {
    var qty = Math.abs(Number(quantity || 0));
    if (!qty) return 0;
    return Math.abs(Number(value || 0) / qty);
}

async function enrichStockCardRows(rows, productId) {
    rows = rows || [];
    var codes = uniqueValues(rows, 'ma_phieu');
    if (!codes.length) {
        return rows.map(function(row) {
            var code = String(row.ma_phieu || '').trim();
            return Object.assign({}, row, {
                loai_giao_dich: labelStockTransactionType(row.loai_phieu, row.so_luong_thay_doi),
                ten_loai_chung_tu: labelChungTuDocumentType('', row.loai_phieu, code)
            });
        });
    }

    var productObjectId = productId instanceof mongoose.Types.ObjectId
        ? productId
        : (mongoose.Types.ObjectId.isValid(productId) ? new mongoose.Types.ObjectId(productId) : productId);
    var purchases = await PhieuNhap.find({ ma_phieu_nhap: { $in: codes } }).populate({ path: 'nha_cung_cap_id', select: 'ten_ncc ten_cong_ty ma_ncc' }).lean();
    var purchaseMap = mapBy(purchases, 'ma_phieu_nhap');
    var purchaseIds = purchases.map(function(doc) { return doc._id; });
    var purchaseDetails = purchaseIds.length ? await CTPhieuNhap.find({ phieu_nhap_id: { $in: purchaseIds }, hang_hoa_id: productObjectId }).lean() : [];
    var purchaseDetailMap = purchaseDetails.reduce(function(map, row) {
        map[String(row.phieu_nhap_id)] = row;
        return map;
    }, {});

    var supplierReturns = await PhieuTraHangNhap.find({ ma_phieu_tra_nhap: { $in: codes }, deleted_at: null, trang_thai: { $ne: 'cancelled' } }).populate({ path: 'nha_cung_cap_id', select: 'ten_ncc ten_cong_ty ma_ncc' }).lean();
    var supplierReturnMap = mapBy(supplierReturns, 'ma_phieu_tra_nhap');
    var supplierReturnIds = supplierReturns.map(function(doc) { return doc._id; });
    var supplierReturnDetails = supplierReturnIds.length ? await CTPhieuTraHangNhap.find({ phieu_tra_nhap_id: { $in: supplierReturnIds }, hang_hoa_id: productObjectId }).lean() : [];
    var supplierReturnDetailMap = supplierReturnDetails.reduce(function(map, row) {
        map[String(row.phieu_tra_nhap_id)] = row;
        return map;
    }, {});

    var orders = await DonHang.find({ ma_don_hang: { $in: codes } }).populate({ path: 'khach_hang_id', select: 'ten_khach_hang ten_cong_ty ma_khach_hang' }).lean();
    var orderMap = mapBy(orders, 'ma_don_hang');
    var orderIds = orders.map(function(doc) { return doc._id; });
    var orderDetails = orderIds.length ? await CTDonHang.find({ don_hang_id: { $in: orderIds }, hang_hoa_id: productObjectId }).lean() : [];
    var orderDetailMap = orderDetails.reduce(function(map, row) {
        map[String(row.don_hang_id)] = row;
        return map;
    }, {});

    var invoices = await HoaDonBanHang.find({ ma_hoa_don: { $in: codes } }).populate({ path: 'khach_hang_id', select: 'ten_khach_hang ten_cong_ty ma_khach_hang' }).lean();
    var invoiceMap = mapBy(invoices, 'ma_hoa_don');
    var invoiceIds = invoices.map(function(doc) { return doc._id; });
    var invoiceDetails = invoiceIds.length ? await CTHoaDonBanHang.find({ hoa_don_id: { $in: invoiceIds }, hang_hoa_id: productObjectId }).lean() : [];
    var invoiceDetailMap = invoiceDetails.reduce(function(map, row) {
        map[String(row.hoa_don_id)] = row;
        return map;
    }, {});

    var returns = await PhieuTraHang.find({ ma_phieu_tra: { $in: codes }, deleted_at: null }).populate({ path: 'khach_hang_id', select: 'ten_khach_hang ten_cong_ty ma_khach_hang' }).lean();
    var returnMap = mapBy(returns, 'ma_phieu_tra');
    var returnIds = returns.map(function(doc) { return doc._id; });
    var returnDetails = returnIds.length ? await CTPhieuTraHang.find({ phieu_tra_hang_id: { $in: returnIds }, hang_hoa_id: productObjectId, deleted_at: null }).lean() : [];
    var returnDetailMap = returnDetails.reduce(function(map, row) {
        map[String(row.phieu_tra_hang_id)] = row;
        return map;
    }, {});

    var checks = await PhieuKiemKho.find({
        ma_kiem_kho: { $in: codes },
        $or: [{ deleted_at: null }, { deleted_at: { $exists: false } }]
    }).lean();
    var checkMap = mapBy(checks, 'ma_kiem_kho');
    var checkIds = checks.map(function(doc) { return doc._id; });
    var checkDetails = checkIds.length ? await CTPhieuKiemKho.find({ phieu_kiem_kho_id: { $in: checkIds }, hang_hoa_id: productObjectId }).lean() : [];
    var checkDetailMap = checkDetails.reduce(function(map, row) {
        map[String(row.phieu_kiem_kho_id)] = row;
        return map;
    }, {});

    var disposals = await PhieuXuatHuy.find({ ma_xuat_huy: { $in: codes } }).lean();
    var disposalMap = mapBy(disposals, 'ma_xuat_huy');
    var disposalIds = disposals.map(function(doc) { return doc._id; });
    var disposalDetails = disposalIds.length ? await CTXuatHuy.find({ phieu_xuat_huy_id: { $in: disposalIds }, hang_hoa_id: productObjectId }).lean() : [];
    var disposalDetailMap = disposalDetails.reduce(function(map, row) {
        map[String(row.phieu_xuat_huy_id)] = row;
        return map;
    }, {});

    var internalIssues = await PhieuXuatNoiBo.find({ ma_xuat_noi_bo: { $in: codes } }).lean();
    var internalIssueMap = mapBy(internalIssues, 'ma_xuat_noi_bo');
    var internalIssueIds = internalIssues.map(function(doc) { return doc._id; });
    var internalIssueDetails = internalIssueIds.length ? await CTXuatNoiBo.find({ phieu_xuat_id: { $in: internalIssueIds }, hang_hoa_id: productObjectId }).lean() : [];
    var internalIssueDetailMap = internalIssueDetails.reduce(function(map, row) {
        map[String(row.phieu_xuat_id)] = row;
        return map;
    }, {});

    return rows.map(function(row) {
        var code = String(row.ma_phieu || '').trim();
        var qty = Number(row.so_luong_thay_doi || 0);
        var card = Object.assign({}, row, {
            loai_giao_dich: labelStockTransactionType(row.loai_phieu, qty),
            doi_tac: '',
            gia_giao_dich: unitPriceFromValue(row.gia_tri_thay_doi, qty),
            gia_von_the_kho: unitPriceFromValue(row.gia_tri_thay_doi, qty),
            chung_tu_type: '',
            chung_tu_doc: null
        });
        var doc;
        var detail;

        if (row.loai_phieu === 'nhap_hang') {
            doc = purchaseMap[code];
            detail = doc ? purchaseDetailMap[String(doc._id)] : null;
            card.doi_tac = partnerName(doc, '');
            card.gia_giao_dich = Number(detail && detail.don_gia_nhap || card.gia_giao_dich || 0);
            card.gia_von_the_kho = card.gia_giao_dich;
            card.chung_tu_type = 'purchase';
            card.chung_tu_doc = doc;
        } else if (row.loai_phieu === 'tra_hang_nhap') {
            doc = supplierReturnMap[code];
            detail = doc ? supplierReturnDetailMap[String(doc._id)] : null;
            card.doi_tac = partnerName(doc, '');
            card.gia_giao_dich = Number(detail && (detail.gia_tra_lai || detail.gia_nhap) || card.gia_giao_dich || 0);
            card.gia_von_the_kho = Number(detail && detail.gia_nhap || card.gia_giao_dich || 0);
            card.chung_tu_type = 'supplier_return';
            card.chung_tu_doc = doc;
        } else if (row.loai_phieu === 'ban_hang') {
            doc = orderMap[code] || invoiceMap[code];
            detail = orderMap[code] ? orderDetailMap[String(doc && doc._id)] : invoiceDetailMap[String(doc && doc._id)];
            card.doi_tac = partnerName(doc, 'Khách lẻ');
            card.gia_giao_dich = Number(detail && (detail.don_gia_ban || detail.don_gia) || 0);
            card.gia_von_the_kho = unitPriceFromValue(row.gia_tri_thay_doi, qty);
            card.chung_tu_type = orderMap[code] ? 'order' : 'invoice';
            card.chung_tu_doc = doc;
        } else if (row.loai_phieu === 'tra_hang') {
            doc = returnMap[code];
            detail = doc ? returnDetailMap[String(doc._id)] : null;
            card.doi_tac = partnerName(doc, 'Khách lẻ');
            card.gia_giao_dich = Number(detail && detail.don_gia || card.gia_giao_dich || 0);
            card.gia_von_the_kho = unitPriceFromValue(row.gia_tri_thay_doi, qty);
            card.chung_tu_type = 'customer_return';
            card.chung_tu_doc = doc;
        } else if (row.loai_phieu === 'kiem_kho') {
            doc = checkMap[code];
            detail = doc ? checkDetailMap[String(doc._id)] : null;
            card.gia_giao_dich = 0;
            card.gia_von_the_kho = unitPriceFromValue(row.gia_tri_thay_doi || (detail && detail.gia_tri_lech), qty);
            card.chung_tu_type = 'stock_check';
            card.chung_tu_doc = doc;
        } else if (row.loai_phieu === 'xuat_huy') {
            doc = disposalMap[code];
            detail = doc ? disposalDetailMap[String(doc._id)] : null;
            card.doi_tac = doc && doc.ly_do_huy ? doc.ly_do_huy : '';
            card.gia_giao_dich = 0;
            card.gia_von_the_kho = Number(detail && detail.gia_von || card.gia_von_the_kho || 0);
            card.chung_tu_type = 'stock_disposal';
            card.chung_tu_doc = doc;
        } else if (row.loai_phieu === 'xuat_noi_bo') {
            doc = internalIssueMap[code];
            detail = doc ? internalIssueDetailMap[String(doc._id)] : null;
            card.doi_tac = partnerName(doc, '');
            card.gia_giao_dich = 0;
            card.gia_von_the_kho = Number(detail && detail.gia_von || card.gia_von_the_kho || 0);
            card.chung_tu_type = 'internal_issue';
            card.chung_tu_doc = doc;
        } else if (row.loai_phieu === 'rollback_ban_hang' || row.loai_phieu === 'huy_hoa_don') {
            doc = invoiceMap[code] || orderMap[code];
            if (doc) {
                card.doi_tac = partnerName(doc, 'Khách lẻ');
                card.chung_tu_type = invoiceMap[code] ? 'invoice' : 'order';
                card.chung_tu_doc = doc;
            }
        }

        card.ten_loai_chung_tu = labelChungTuDocumentType(card.chung_tu_type, row.loai_phieu, code);

        return card;
    });
}

async function filterTrashedKiemKhoStockRows(rows) {
    rows = rows || [];
    var checkCodes = rows
        .filter(function(row) { return row && row.loai_phieu === 'kiem_kho'; })
        .map(function(row) { return String(row.ma_phieu || '').trim(); })
        .filter(Boolean);
    checkCodes = Array.from(new Set(checkCodes));
    if (!checkCodes.length) return rows;

    var activeChecks = await PhieuKiemKho.find({
        ma_kiem_kho: { $in: checkCodes },
        $or: [{ deleted_at: null }, { deleted_at: { $exists: false } }]
    }).select('ma_kiem_kho').lean();
    var activeMap = activeChecks.reduce(function(map, doc) {
        if (doc.ma_kiem_kho) map[String(doc.ma_kiem_kho)] = true;
        return map;
    }, {});

    return rows.filter(function(row) {
        if (!row || row.loai_phieu !== 'kiem_kho') return true;
        return Boolean(activeMap[String(row.ma_phieu || '').trim()]);
    });
}

function makeRangeFilter(minRaw, maxRaw) {
    var hasMinValue = String(minRaw || '').trim() !== '';
    var hasMaxValue = String(maxRaw || '').trim() !== '';
    if (!hasMinValue && !hasMaxValue) return null;

    var min = Number(minRaw);
    var max = Number(maxRaw);
    var hasMin = hasMinValue && Number.isFinite(min);
    var hasMax = hasMaxValue && Number.isFinite(max);
    if (!hasMin && !hasMax) return null;

    var range = {};
    if (hasMin) range.$gte = min < 0 ? 0 : min;
    if (hasMax) range.$lte = max < 0 ? 0 : max;
    return range;
}

function normalizeIdParam(value) {
    return String(value || '').trim();
}

function toDatetimeLocalValue(d) {
    var pad = function(n) { return String(n).padStart(2, '0'); };
    return (
        d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
        'T' + pad(d.getHours()) + ':' + pad(d.getMinutes())
    );
}

async function makeBangGiaCode() {
    var last = await BangGia.findOne({ ma_bang_gia: /^BG\d+$/ }).sort({ ma_bang_gia: -1 }).lean();
    var nextNumber = 1;
    if (last && last.ma_bang_gia) {
        nextNumber = Number(String(last.ma_bang_gia).replace(/\D/g, '')) + 1;
    }
    return 'BG' + String(nextNumber).padStart(4, '0');
}

function shouldRespondJson(req) {
    var accept = String(req?.headers?.accept || '').toLowerCase();
    var requestedWith = String(req?.headers?.['x-requested-with'] || '').toLowerCase();
    return requestedWith === 'xmlhttprequest' || accept.indexOf('application/json') >= 0;
}

function escapeRegExp(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function loadProductGroups(storeId) {
    var query = { trang_thai: 'active' };
    if (storeId && mongoose.Types.ObjectId.isValid(storeId)) {
        query.$or = [
            { cua_hang_id: storeId },
            { cua_hang_id: null },
            { cua_hang_id: { $exists: false } }
        ];
    }
    return await NhomHang.find(query).sort({ ten_nhom_hang: 1 }).lean();
}

async function findDuplicateGroupName(storeId, tenNhom, excludeId) {
    var name = String(tenNhom || '').trim();
    if (!name) return null;
    var query = {
        ten_nhom_hang: new RegExp('^' + escapeRegExp(name) + '$', 'i')
    };
    if (excludeId && mongoose.Types.ObjectId.isValid(excludeId)) {
        query._id = { $ne: excludeId };
    }
    if (storeId && mongoose.Types.ObjectId.isValid(storeId)) {
        query.cua_hang_id = storeId;
    }
    return await NhomHang.findOne(query).select('_id ten_nhom_hang').lean();
}

async function makeProductGroupCode() {
    var groups = await NhomHang.find({ ma_nhom_hang: /^NH\d+$/ }).select('ma_nhom_hang').lean();
    var maxNumber = 0;
    for (var group of groups) {
        var number = Number(String(group.ma_nhom_hang || '').replace(/\D/g, ''));
        if (Number.isFinite(number) && number > maxNumber) maxNumber = number;
    }
    return 'NH' + String(maxNumber + 1).padStart(4, '0');
}

async function loadUnitOptions() {
    return await DonViTinh.find({}).sort({ ten_don_vi: 1 }).lean();
}

async function makeUnitCode() {
    var units = await DonViTinh.find({ ma_don_vi: /^DVT\d+$/ }).select('ma_don_vi').lean();
    var maxNumber = 0;
    for (var unit of units) {
        var number = Number(String(unit.ma_don_vi || '').replace(/\D/g, ''));
        if (Number.isFinite(number) && number > maxNumber) maxNumber = number;
    }
    return 'DVT' + String(maxNumber + 1).padStart(4, '0');
}

async function resolveStoreId(req) {
    var sessionStoreId = req && req.session ? String(req.session.cua_hang_id || '').trim() : '';
    if (sessionStoreId && mongoose.Types.ObjectId.isValid(sessionStoreId)) return sessionStoreId;
    var userStoreId = req && req.user ? String(req.user.cua_hang_id || '').trim() : '';
    if (userStoreId && mongoose.Types.ObjectId.isValid(userStoreId)) return userStoreId;
    if (!CuaHang) return '';
    var activeStore = await CuaHang.findOne({ trang_thai: 'active' }).sort({ created_at: 1 }).lean();
    return activeStore ? String(activeStore._id) : '';
}

function respondUnitError(req, res, statusCode, message) {
    if (shouldRespondJson(req)) {
        return res.status(statusCode || 400).json({ success: false, message: message || 'KhÃ´ng thá»ƒ xá»­ lÃ½ Ä‘Æ¡n vá»‹ tÃ­nh.' });
    }
    return res.redirect('/hang-hoa?error=unit_error');
}

function respondProductGroupError(req, res, statusCode, message) {
    if (shouldRespondJson(req)) {
        return res.status(statusCode || 400).json({ success: false, message: message || 'KhÃ´ng thá»ƒ xá»­ lÃ½ nhÃ³m hÃ ng.' });
    }
    return res.redirect('/hang-hoa?error=group_error');
}

function getDateRange(filter) {
    var start = null;
    var end = null;
    if (filter.created === 'custom') {
        if (filter.createdFrom) {
            var parsedFrom = new Date(filter.createdFrom + 'T00:00:00');
            if (!isNaN(parsedFrom.getTime())) start = parsedFrom;
        }
        if (filter.createdTo) {
            var parsedTo = new Date(filter.createdTo + 'T23:59:59.999');
            if (!isNaN(parsedTo.getTime())) end = parsedTo;
        }
    }
    return { start: start, end: end };
}

function buildProductQueryFromFilter(filter) {
    var productQuery = {};
    if (filter.groupId !== 'all') productQuery.nhom_hang_id = filter.groupId;
    if (filter.supplierId !== 'all') productQuery.nha_cung_cap_id = filter.supplierId;
    if (filter.salesLink === 'yes') productQuery.ban_truc_tiep = true;
    if (filter.salesLink === 'no') productQuery.ban_truc_tiep = false;
    applyProductListStatusFilter(productQuery, filter);
    if (filter.keyword) {
        productQuery.$or = [
            { ma_hang: { $regex: filter.keyword, $options: 'i' } },
            { ten_hang: { $regex: filter.keyword, $options: 'i' } }
        ];
    }
    var dateRange = getDateRange(filter);
    if (dateRange.start || dateRange.end) {
        productQuery.created_at = {};
        if (dateRange.start) productQuery.created_at.$gte = dateRange.start;
        if (dateRange.end) productQuery.created_at.$lte = dateRange.end;
    }
    return productQuery;
}

async function loadProductContractData(req) {
    var filter = normalizeFilterQuery(req.query || {});
    var products = await HangHoa.find(buildProductQueryFromFilter(filter))
        .populate({ path: 'nhom_hang_id', select: 'ten_nhom_hang ma_nhom_hang' })
        .populate({ path: 'don_vi_tinh_id', select: 'ten_don_vi ma_don_vi' })
        .populate({ path: 'nha_cung_cap_id', select: 'ten_ncc ten_cong_ty ma_ncc sdt email ma_so_thue' })
        .sort({ created_at: -1, ma_hang: 1 })
        .lean();

    var productIds = products.map(function(item) { return item._id; });
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

    var stockRange = makeRangeFilter(filter.stockFrom, filter.stockTo);
    var items = products.map(function(product) {
        var tonKho = Number(inventoryMap[String(product._id)] || 0);
        product.ton_kho = tonKho;
        var giaVon = Number(product.gia_von || 0);
        return {
            hang_hoa_id: product,
            so_luong: tonKho,
            don_gia_nhap: giaVon,
            thanh_tien: tonKho * giaVon
        };
    }).filter(function(row) {
        if (!stockRange) return true;
        var qty = Number(row.so_luong || 0);
        if (stockRange.$gte != null && qty < stockRange.$gte) return false;
        if (stockRange.$lte != null && qty > stockRange.$lte) return false;
        return true;
    });

    var storeId = await resolveStoreId(req);
    var store = storeId && mongoose.Types.ObjectId.isValid(storeId)
        ? await CuaHang.findById(storeId).lean()
        : null;
    if (!store) store = await CuaHang.findOne({ trang_thai: 'active' }).sort({ created_at: 1 }).lean();

    var totalValue = items.reduce(function(sum, row) {
        return sum + Number(row.thanh_tien || 0);
    }, 0);

    return {
        title: 'HÄ nguyÃªn táº¯c hÃ ng hÃ³a',
        activeMenu: 'hang-hoa',
        user: req.user,
        store: store,
        supplierAddress: null,
        contractMode: 'product-list',
        ticket: {
            ma_phieu_nhap: '',
            ngay_nhap: new Date(),
            tong_tien: totalValue,
            can_tra_ncc: 0,
            da_tra_ncc: 0,
            con_no_ncc: 0,
            phuong_thuc_thanh_toan: '',
            kho_id: null,
            nha_cung_cap_id: null
        },
        items: items,
        embeddedPrint: String(req.query && req.query.embed || '') === '1',
        formatDate: formatDate
    };
}

async function loadProductDetailById(productId, req) {
    if (!mongoose.Types.ObjectId.isValid(productId)) return null;
    var storeId = await resolveStoreId(req);
    var hasStoreScope = storeId && mongoose.Types.ObjectId.isValid(storeId);
    var productQuery = { _id: productId };
    if (hasStoreScope) {
        productQuery.$or = [
            { cua_hang_id: storeId },
            { cua_hang_id: null },
            { cua_hang_id: { $exists: false } }
        ];
    }
    var item = await HangHoa.findOne(productQuery).lean();
    if (!item) return null;
    item.mo_ta = decodeLegacyEntities(item.mo_ta || '');
    item.ghi_chu_dat_hang = decodeLegacyEntities(item.ghi_chu_dat_hang || '');

    var scopedQuery = hasStoreScope ? { cua_hang_id: storeId } : {};
    var groups = await loadProductGroups(storeId);
    var suppliers = await NhaCungCap.find(scopedQuery).sort({ ten_ncc: 1, ten_nha_cung_cap: 1 }).lean();
    var units = await loadUnitOptions();
    var warehouses = await Kho.find(scopedQuery).sort({ ten_kho: 1, ma_kho: 1 }).lean();
    var groupMap = groups.reduce(function(map, group) {
        map[String(group._id)] = group.ten_nhom_hang || '---';
        return map;
    }, {});
    var supplierMap = suppliers.reduce(function(map, supplier) {
        map[String(supplier._id)] = supplier.ten_ncc || supplier.ten_nha_cung_cap || supplier.ten_cong_ty || supplier.ma_ncc || '---';
        return map;
    }, {});
    var unitMap = units.reduce(function(map, unit) {
        map[String(unit._id)] = unit.ten_don_vi || '---';
        return map;
    }, {});
    var warehouseMap = warehouses.reduce(function(map, warehouse) {
        map[String(warehouse._id)] = warehouse.ten_kho || warehouse.ma_kho || '---';
        return map;
    }, {});
    var warehouseStatusMap = warehouses.reduce(function(map, warehouse) {
        map[String(warehouse._id)] = warehouse.trang_thai || '---';
        return map;
    }, {});

    var productObjectId = new mongoose.Types.ObjectId(productId);
    var inventoryMatch = { hang_hoa_id: productObjectId };
    if (hasStoreScope) inventoryMatch.cua_hang_id = new mongoose.Types.ObjectId(storeId);
    var inventoryRows = await TonKho.aggregate([
        { $match: inventoryMatch },
        { $group: { _id: '$hang_hoa_id', total: { $sum: { $ifNull: ['$so_luong', 0] } } } }
    ]);
    item.ton_kho = inventoryRows[0] ? Number(inventoryRows[0].total || 0) : 0;
    item.nhom_hang_ten = groupMap[String(item.nhom_hang_id || '')] || '---';
    item.nha_cung_cap_ten = supplierMap[String(item.nha_cung_cap_id || '')] || '---';
    item.don_vi_tinh_ten = unitMap[String(item.don_vi_tinh_id || '')] || '---';
    item.gia_ban_hien_thi = Number(item.gia_co_dinh || 0);

    var stockQuery = { hang_hoa_id: item._id };
    if (hasStoreScope) stockQuery.cua_hang_id = storeId;
    var selectedProductInventory = await TonKho.find(stockQuery).sort({ updated_at: -1 }).lean();

    var reservedByWarehouse = {};
    if (selectedProductInventory.length) {
        var reservedRows = await Promise.all(selectedProductInventory.map(function(row) {
            return getReservedQuantitiesByOrder({
                kho_id: row.kho_id,
                hang_hoa_ids: [item._id]
            }).then(function(reserved) {
                return {
                    khoId: String(row.kho_id || ''),
                    qty: Number(reserved.byProduct[String(item._id)]?.so_luong_khach_dat || 0)
                };
            });
        }));
        reservedByWarehouse = reservedRows.reduce(function(map, row) {
            map[row.khoId] = row.qty;
            return map;
        }, {});
    }

    var expiryRows = item.quan_ly_theo_lo
        ? await LoHang.aggregate([
            {
                $match: Object.assign({
                    hang_hoa_id: item._id,
                    han_su_dung: { $ne: null },
                    trang_thai: { $ne: 'huy' }
                }, hasStoreScope ? { cua_hang_id: new mongoose.Types.ObjectId(storeId) } : {})
            },
            { $group: { _id: '$kho_id', latestExpiry: { $max: '$han_su_dung' } } }
        ])
        : [];
    var expiryMap = expiryRows.reduce(function(map, row) {
        map[String(row._id || '')] = row.latestExpiry;
        return map;
    }, {});
    var productDefaultExpiry = null;
    if (item.han_su_dung) {
        productDefaultExpiry = item.han_su_dung;
    } else if (item.han_su_dung_mac_dinh_so_ngay) {
        var baseDate = item.created_at || item.ngay_tao || new Date();
        productDefaultExpiry = new Date(new Date(baseDate).getTime() + Number(item.han_su_dung_mac_dinh_so_ngay || 0) * 86400000);
    }

    selectedProductInventory = selectedProductInventory.map(function(row) {
        row.kho_ten = warehouseMap[String(row.kho_id || '')] || '---';
        row.khach_dat = reservedByWarehouse[String(row.kho_id || '')] || 0;
        row.du_kien_het_hang = expiryMap[String(row.kho_id || '')] || productDefaultExpiry || null;
        row.trang_thai_kho = warehouseStatusMap[String(row.kho_id || '')] || '---';
        return row;
    });

    var historyQuery = { hang_hoa_id: item._id };
    if (hasStoreScope) historyQuery.cua_hang_id = storeId;
    var selectedProductHistories = await LichSuKho.find(historyQuery)
        .populate({ path: 'lo_hang_id', select: 'ten_lo ma_lo han_su_dung ngay_nhap' })
        .sort({ ngay: -1, created_at: -1 })
        .lean();
    selectedProductHistories = await filterTrashedKiemKhoStockRows(selectedProductHistories);
    selectedProductHistories = await enrichStockCardRows(selectedProductHistories, item._id);
    selectedProductHistories = selectedProductHistories.map(function(row) {
        row.kho_ten = warehouseMap[String(row.kho_id || '')] || '---';
        return row;
    });

    var lotStockQuery = { hang_hoa_id: item._id };
    if (hasStoreScope) lotStockQuery.cua_hang_id = storeId;
    var selectedProductLots = item.quan_ly_theo_lo
        ? await TonKhoLo.find(lotStockQuery)
            .populate({
                path: 'lo_hang_id',
                select: 'ma_lo ten_lo ngay_nhap han_su_dung so_luong_ban_dau so_luong_con_lai don_gia_nhap gia_von trang_thai phieu_nhap_id ct_phieu_nhap_id nha_cung_cap_id',
                populate: [
                    { path: 'phieu_nhap_id', select: 'ma_phieu_nhap ngay_nhap' },
                    { path: 'nha_cung_cap_id', select: 'ten_ncc ten_nha_cung_cap ten_cong_ty ma_ncc' }
                ]
            })
            .sort({ updated_at: -1, created_at: -1 })
            .lean()
        : [];
    selectedProductLots = selectedProductLots.map(function(row) {
        row.kho_ten = warehouseMap[String(row.kho_id || '')] || '---';
        var lot = row.lo_hang_id || {};
        var rawQty = normalizeStockNumber(row.so_luong !== undefined && row.so_luong !== null ? row.so_luong : lot.so_luong_con_lai);
        var remainQty = normalizeStockNumber(lot.so_luong_con_lai !== undefined && lot.so_luong_con_lai !== null ? lot.so_luong_con_lai : rawQty);
        var sellableQty = isSellableLot(lot) ? Math.max(Math.min(rawQty, remainQty), 0) : 0;
        var expiredQty = isExpiredLot(lot) ? rawQty : 0;
        row.ton_thuc_te = rawQty;
        row.ton_co_the_giao = sellableQty;
        row.ton_het_han = expiredQty;
        row.lo_da_het_han = isExpiredLot(lot);
        row.ly_do_khong_the_giao = '';
        return row;
    });

    var lotStockById = selectedProductLots.reduce(function(map, row) {
        var lotId = String((row.lo_hang_id && row.lo_hang_id._id) || row.lo_hang_id || '');
        if (!lotId) return map;
        map[lotId] = row;
        return map;
    }, {});
    var stockSummaryByWarehouse = selectedProductLots.reduce(function(map, row) {
        var warehouseId = String(row.kho_id || '');
        if (!map[warehouseId]) map[warehouseId] = { raw: 0, sellable: 0, expired: 0 };
        map[warehouseId].raw += normalizeStockNumber(row.ton_thuc_te);
        map[warehouseId].sellable += normalizeStockNumber(row.ton_co_the_giao);
        map[warehouseId].expired += normalizeStockNumber(row.ton_het_han);
        return map;
    }, {});

    var selectedProductLotAttributes = [];
    if (item.quan_ly_theo_lo) {
        var qcQuery = { hang_hoa_id: item._id };
        if (hasStoreScope) qcQuery.cua_hang_id = storeId;
        var qcRows = await TonKhoLoQuyCach.find(qcQuery)
            .populate({
                path: 'lo_hang_id',
                select: 'ma_lo ten_lo ngay_nhap han_su_dung so_luong_con_lai trang_thai kho_id'
            })
            .sort({ updated_at: -1, created_at: -1, ten_quy_cach: 1 })
            .lean();
        var lotAttributeMap = {};
        qcRows.forEach(function(row) {
            var lot = row.lo_hang_id || {};
            var lotId = String(lot._id || row.lo_hang_id || '');
            if (!lotId) return;
            if (!lotAttributeMap[lotId]) {
                var lotStockInfo = lotStockById[lotId] || {};
                lotAttributeMap[lotId] = {
                    lot: lot,
                    kho_ten: warehouseMap[String(row.kho_id || lot.kho_id || '')] || '---',
                    items: [],
                    lot_stock_quantity: normalizeStockNumber(lotStockInfo.ton_thuc_te),
                    total_quantity: 0,
                    total_sellable_quantity: 0,
                    total_expired_quantity: 0,
                    total_amount: 0
                };
            }
            var quantity = Number(row.so_luong || 0);
            var unitCost = Number(row.don_gia_nhap || row.gia_von || 0);
            var amount = Number(row.thanh_tien || 0) || quantity * unitCost;
            var lotExpired = isExpiredLot(lot);
            var qcSellableQty = isSellableLot(lot) ? quantity : 0;
            lotAttributeMap[lotId].items.push({
                ten_quy_cach: row.ten_quy_cach || row.ten_thuoc_tinh || '---',
                so_luong: quantity,
                ton_thuc_te: quantity,
                ton_co_the_giao: qcSellableQty,
                ton_het_han: lotExpired ? quantity : 0,
                lo_da_het_han: lotExpired,
                ly_do_khong_the_giao: '',
                don_gia: unitCost,
                thanh_tien: amount
            });
            lotAttributeMap[lotId].total_quantity += quantity;
            lotAttributeMap[lotId].total_sellable_quantity += qcSellableQty;
            lotAttributeMap[lotId].total_expired_quantity += lotExpired ? quantity : 0;
            lotAttributeMap[lotId].total_amount += amount;
        });
        selectedProductLotAttributes = Object.keys(lotAttributeMap).map(function(lotId) {
            var group = lotAttributeMap[lotId];
            group.lech_quy_cach = normalizeStockNumber(group.total_quantity) - normalizeStockNumber(group.lot_stock_quantity);
            group.has_reconcile_warning = Math.abs(group.lech_quy_cach) > 0.000001;
            group.reconcile_message = group.has_reconcile_warning
                ? 'TonKhoLo = ' + normalizeStockNumber(group.lot_stock_quantity).toLocaleString('vi-VN') + ', TonKhoLoQuyCach = ' + normalizeStockNumber(group.total_quantity).toLocaleString('vi-VN') + '.'
                : '';
            return group;
        });
        selectedProductLots = selectedProductLots.map(function(row) {
            var lotId = String((row.lo_hang_id && row.lo_hang_id._id) || row.lo_hang_id || '');
            var group = lotAttributeMap[lotId];
            row.quy_cach_items = group && Array.isArray(group.items) ? group.items : [];
            return row;
        });
    }

    var qcTotalQuantity = selectedProductLotAttributes.reduce(function(sum, group) {
        return sum + normalizeStockNumber(group.total_quantity);
    }, 0);
    var qcExpiredQuantity = selectedProductLotAttributes.reduce(function(sum, group) {
        return sum + normalizeStockNumber(group.total_expired_quantity);
    }, 0);
    item.ton_quy_cach = qcTotalQuantity;
    item.ton_co_the_giao = item.quan_ly_theo_lo
        ? selectedProductLots.reduce(function(sum, row) { return sum + normalizeStockNumber(row.ton_co_the_giao); }, 0)
        : item.ton_kho;
    item.ton_het_han = item.quan_ly_theo_lo
        ? selectedProductLots.reduce(function(sum, row) { return sum + normalizeStockNumber(row.ton_het_han); }, 0)
        : 0;
    item.ton_quy_cach_het_han = qcExpiredQuantity;
    var tonKhoThucTe = normalizeStockNumber(item.ton_kho);
    var tonCoTheGiao = normalizeStockNumber(item.ton_co_the_giao);
    var tonHetHan = normalizeStockNumber(item.ton_het_han);
    item.co_ton_nhung_khong_the_giao = tonKhoThucTe > 0 && tonCoTheGiao <= 0 && tonHetHan < tonKhoThucTe;
    item.ly_do_khong_the_giao = item.co_ton_nhung_khong_the_giao
        ? 'Tá»“n thá»±c táº¿ cÃ²n nhÆ°ng khÃ´ng Ä‘á»§ Ä‘iá»u kiá»‡n giao (ngoÃ i lÃ´ háº¿t háº¡n).'
        : '';

    selectedProductInventory = selectedProductInventory.map(function(row) {
        var summary = stockSummaryByWarehouse[String(row.kho_id || '')] || null;
        row.ton_thuc_te = normalizeStockNumber(row.so_luong);
        var rawSellable = item.quan_ly_theo_lo && summary ? summary.sellable : row.ton_thuc_te;
        row.ton_co_the_giao = Math.max(rawSellable - Number(row.khach_dat || 0), 0);
        row.ton_het_han = item.quan_ly_theo_lo && summary ? summary.expired : 0;
        row.ly_do_khong_the_giao = row.ton_thuc_te > 0 && row.ton_co_the_giao <= 0 && row.ton_het_han < row.ton_thuc_te
            ? 'Tá»“n kho cÃ²n nhÆ°ng khÃ´ng Ä‘á»§ Ä‘iá»u kiá»‡n giao (ngoÃ i lÃ´ háº¿t háº¡n).'
            : '';
        return row;
    });

    return {
        item: item,
        selectedProductInventory: selectedProductInventory,
        selectedProductHistories: selectedProductHistories,
        selectedProductLots: selectedProductLots,
        selectedProductLotAttributes: selectedProductLotAttributes,
        formatDate: formatDate
    };
}


module.exports = {
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
};

