var mongoose = require('mongoose');
const { getReservedQuantitiesByOrder, getReservedQuantitiesForSale, buildVariantKey, buildLotKey } = require('../services/availability.service');
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
} = require('../models/kiot.model');
var pdfService = require('../services/pdf.service');
var { buildLotProfitReport } = require('../services/lotProfitReport.service');
var { submitStockAllocation } = require('../services/allocationSubmit.service');
var {
    resolveSalePrice,
    buildPriceSetupLines,
    upsertGiaBanHangHoa
} = require('../services/salePrice.service');

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

/** Danh sách mặc định: chỉ active; chỉ khi filter "Ngừng kinh doanh" mới lấy inactive. */
function applyProductListStatusFilter(productQuery, filter) {
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
    var limit = parseInt(query.limit, 10);
    if (!Number.isFinite(page) || page < 1) page = 1;
    if (!Number.isFinite(limit) || limit < 1) limit = 15;
    if (limit > 100) limit = 100;
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
    if (filter.limit !== 15) params.push('limit=' + encodeURIComponent(filter.limit));
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
            mo_ta: 'Kích cỡ hàng hóa',
            trang_thai: 'active'
        });
    }
    var defaults = ['Lớn', 'Trung', 'Bi'];
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
        ten_hang: { $regex: 'Dưa leo Lỗ', $options: 'i' },
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
            ten_lo: options.ten_lo || 'Lô mặc định ' + (product.ma_hang || product.ten_hang || ''),
            ngay_nhap: new Date(),
            han_su_dung: options.han_su_dung || undefined,
            so_luong_ban_dau: missingQty,
            so_luong_con_lai: missingQty,
            don_gia_nhap: Number(product.gia_nhap_cuoi || product.gia_von || 0),
            gia_von: Number(product.gia_von || 0),
            trang_thai: 'active',
            ghi_chu: options.ghi_chu || 'Tạo tự động từ tồn hiện tại'
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

    var supplierReturns = await PhieuTraHangNhap.find({ ma_phieu_tra_nhap: { $in: codes } }).populate({ path: 'nha_cung_cap_id', select: 'ten_ncc ten_cong_ty ma_ncc' }).lean();
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

    var returns = await PhieuTraHang.find({ ma_phieu_tra: { $in: codes } }).populate({ path: 'khach_hang_id', select: 'ten_khach_hang ten_cong_ty ma_khach_hang' }).lean();
    var returnMap = mapBy(returns, 'ma_phieu_tra');
    var returnIds = returns.map(function(doc) { return doc._id; });
    var returnDetails = returnIds.length ? await CTPhieuTraHang.find({ phieu_tra_hang_id: { $in: returnIds }, hang_hoa_id: productObjectId }).lean() : [];
    var returnDetailMap = returnDetails.reduce(function(map, row) {
        map[String(row.phieu_tra_hang_id)] = row;
        return map;
    }, {});

    var checks = await PhieuKiemKho.find({ ma_kiem_kho: { $in: codes } }).lean();
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
        return res.status(statusCode || 400).json({ success: false, message: message || 'Không thể xử lý đơn vị tính.' });
    }
    return res.redirect('/hang-hoa?error=unit_error');
}

function respondProductGroupError(req, res, statusCode, message) {
    if (shouldRespondJson(req)) {
        return res.status(statusCode || 400).json({ success: false, message: message || 'Không thể xử lý nhóm hàng.' });
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
        title: 'HĐ nguyên tắc hàng hóa',
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

async function seedProductsIfEmpty() {
    var count = await HangHoa.countDocuments();
    if (count > 0) return;

    var groups = await NhomHang.find({}).sort({ created_at: 1 }).lean();
    if (groups.length === 0) {
        groups = await NhomHang.insertMany([
            { ma_nhom_hang: 'NH001', ten_nhom_hang: 'Hải sản tươi sống', trang_thai: 'active' },
            { ma_nhom_hang: 'NH002', ten_nhom_hang: 'Thực phẩm đông lạnh', trang_thai: 'active' }
        ]);
    }

    var units = await DonViTinh.find({}).sort({ created_at: 1 }).lean();
    if (units.length === 0) {
        await DonViTinh.insertMany([
            { ma_don_vi: 'DVT001', ten_don_vi: 'Cái', trang_thai: 'active' },
            { ma_don_vi: 'DVT002', ten_don_vi: 'Kg', trang_thai: 'active' },
            { ma_don_vi: 'DVT003', ten_don_vi: 'Hộp', trang_thai: 'active' }
        ]);
    }

    var suppliers = await NhaCungCap.find({}).sort({ created_at: 1 }).lean();
    var supplierA = suppliers[0] || null;
    var supplierB = suppliers[1] || supplierA;

    var products = await HangHoa.insertMany([
        { ma_hang: 'NSTP00030', ten_hang: 'Sầu riêng lạnh Vibraood 300g', nhom_hang_id: groups[0]?._id, nha_cung_cap_id: supplierA?._id, gia_co_dinh: 200000, gia_von: 100000, gia_nhap_cuoi: 95000, ban_truc_tiep: true, trang_thai: 'active' },
        { ma_hang: 'NSTP00029', ten_hang: 'Gà ta đông lạnh', nhom_hang_id: groups[1]?._id, nha_cung_cap_id: supplierB?._id, gia_co_dinh: 90000, gia_von: 65000, gia_nhap_cuoi: 62000, ban_truc_tiep: true, trang_thai: 'active' },
        { ma_hang: 'NSTP00028', ten_hang: 'Bò bít tết Mỹ AACE FOODS 500g', nhom_hang_id: groups[1]?._id, nha_cung_cap_id: supplierA?._id, gia_co_dinh: 150000, gia_von: 120000, gia_nhap_cuoi: 118000, ban_truc_tiep: false, trang_thai: 'active' },
        { ma_hang: 'NSTP00027', ten_hang: 'Chả ram tôm đất Định Chí đặc biệt', nhom_hang_id: groups[0]?._id, nha_cung_cap_id: supplierB?._id, gia_co_dinh: 120000, gia_von: 90000, gia_nhap_cuoi: 88000, ban_truc_tiep: true, trang_thai: 'active' }
    ]);

    var firstWarehouse = await Kho.findOne({}).lean();
    if (!firstWarehouse) return;

    await TonKho.insertMany(products.map(function(item, index) {
        return {
            kho_id: firstWarehouse._id,
            hang_hoa_id: item._id,
            so_luong: [14, 0, 0, 0][index] || 0
        };
    }));
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
        ? 'Tồn thực tế còn nhưng không đủ điều kiện giao (ngoài lô hết hạn).'
        : '';

    selectedProductInventory = selectedProductInventory.map(function(row) {
        var summary = stockSummaryByWarehouse[String(row.kho_id || '')] || null;
        row.ton_thuc_te = normalizeStockNumber(row.so_luong);
        var rawSellable = item.quan_ly_theo_lo && summary ? summary.sellable : row.ton_thuc_te;
        row.ton_co_the_giao = Math.max(rawSellable - Number(row.khach_dat || 0), 0);
        row.ton_het_han = item.quan_ly_theo_lo && summary ? summary.expired : 0;
        row.ly_do_khong_the_giao = row.ton_thuc_te > 0 && row.ton_co_the_giao <= 0 && row.ton_het_han < row.ton_thuc_te
            ? 'Tồn kho còn nhưng không đủ điều kiện giao (ngoài lô hết hạn).'
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

exports.apiProductDetail = async function(req, res, next) {
    try {
        var ctx = await loadProductDetailById(req.params.id, req);
        if (!ctx) {
            return res.status(404).type('html').send('<div class="kv-detail-panel product-detail kv-detail-error"><p>Không tìm thấy hàng hóa.</p></div>');
        }
        res.render('hang-hoa/_detail-panel', ctx);
    } catch (err) {
        next(err);
    }
};

exports.apiUpdateProductNotes = async function(req, res, next) {
    try {
        var productId = normalizeIdParam(req && req.params && req.params.id);
        if (!productId || !mongoose.Types.ObjectId.isValid(productId)) {
            return res.status(400).json({ success: false, message: 'Hàng hóa không hợp lệ.' });
        }

        var storeId = await resolveStoreId(req);
        var productQuery = { _id: productId };
        if (storeId && mongoose.Types.ObjectId.isValid(storeId)) {
            productQuery.$or = [
                { cua_hang_id: storeId },
                { cua_hang_id: null },
                { cua_hang_id: { $exists: false } }
            ];
        }

        var existing = await HangHoa.findOne(productQuery).select('_id').lean();
        if (!existing) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy hàng hóa.' });
        }

        var payload = normalizeProductNotePayload(req && req.body);
        var updated = await HangHoa.findByIdAndUpdate(
            productId,
            { $set: payload },
            { runValidators: true, new: true }
        ).select('mo_ta ghi_chu_dat_hang').lean();

        res.json({
            success: true,
            message: 'Đã lưu mô tả và ghi chú đặt hàng.',
            data: {
                mo_ta: decodeLegacyEntities(updated.mo_ta || ''),
                ghi_chu_dat_hang: decodeLegacyEntities(updated.ghi_chu_dat_hang || '')
            }
        });
    } catch (err) {
        res.status(err.status || err.statusCode || 500).json({
            success: false,
            message: err.message || 'Không cập nhật được mô tả/ghi chú.'
        });
    }
};

function lotProfitQueryFromRequest(req) {
    return {
        hang_hoa_id: req.params.id,
        lo_hang_id: req.query.lo_hang_id,
        cua_hang_id: null
    };
}

exports.apiLotProfitReport = async function(req, res, next) {
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
            message: err.message || 'Không tải được báo cáo lời lỗ theo lô'
        });
    }
};

exports.exportLotProfitReport = async function(req, res, next) {
    try {
        var ExcelJS = require('exceljs');
        var storeId = await resolveStoreId(req);
        var query = lotProfitQueryFromRequest(req);
        query.cua_hang_id = storeId;
        var result = await buildLotProfitReport(query);
        if (!result.product) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy hàng hóa' });
        }

        var workbook = new ExcelJS.Workbook();
        var sheet = workbook.addWorksheet('Loi lo theo lo');
        sheet.columns = [
            { header: 'Ngày nhập / Ngày lô', key: 'ngay_nhap', width: 16 },
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

function resolveQuyCachImportPrice(qc) {
    if (!qc) return 0;
    if (qc.don_gia_nhap != null && qc.don_gia_nhap !== '') {
        return Number(qc.don_gia_nhap) || 0;
    }
    if (qc.gia_von != null && qc.gia_von !== '') {
        return Number(qc.gia_von) || 0;
    }
    return 0;
}

function buildAllocationLineKey(parts) {
    return [
        String(parts.product_id || ''),
        String(parts.lo_hang_id || ''),
        String(parts.kho_id || ''),
        String(parts.gia_tri_thuoc_tinh_id || ''),
        String(parts.ten_quy_cach || '').trim()
    ].join('|');
}

function resolveLineReservedQty(reserved, line) {
    var productId = String(line && line.product_id ? line.product_id : '');
    if (!productId || !reserved) return 0;
    var tenQuyCach = String(line.ten_quy_cach || '').trim();
    if (tenQuyCach === '---') tenQuyCach = '';
    var variantKey = buildVariantKey({
        hang_hoa_id: productId,
        gia_tri_thuoc_tinh_id: line.gia_tri_thuoc_tinh_id || '',
        ten_quy_cach: tenQuyCach
    });
    var lotKey = line.lo_hang_id ? buildLotKey(productId, line.lo_hang_id) : '';
    var fromVariant = reserved.byVariant && reserved.byVariant[variantKey]
        ? Number(reserved.byVariant[variantKey].so_luong_khach_dat || 0)
        : 0;
    var fromLot = lotKey && reserved.byLot && reserved.byLot[lotKey]
        ? Number(reserved.byLot[lotKey].so_luong_khach_dat || 0)
        : 0;
    return Math.max(fromVariant, fromLot, 0);
}

function buildAllocationLineExtras(product, row, lot, qc) {
    var lotId = lot && lot._id ? lot._id : (row && row.lo_hang_id ? row.lo_hang_id : null);
    var khoId = row && row.kho_id ? row.kho_id : null;
    var giaTriId = qc && qc.gia_tri_thuoc_tinh_id ? qc.gia_tri_thuoc_tinh_id : null;
    var tenQuyCach = qc
        ? (qc.ten_quy_cach || qc.ten_thuoc_tinh || '---')
        : '---';
    return {
        line_key: buildAllocationLineKey({
            product_id: product._id,
            lo_hang_id: lotId,
            kho_id: khoId,
            gia_tri_thuoc_tinh_id: giaTriId,
            ten_quy_cach: tenQuyCach === '---' ? '' : tenQuyCach
        }),
        lo_hang_id: lotId,
        kho_id: khoId,
        gia_tri_thuoc_tinh_id: giaTriId,
        ton_kho_lo_quy_cach_id: qc && qc._id ? qc._id : null,
        don_vi_tinh_id: product.don_vi_tinh_id || null,
        gia_ban_mac_dinh: Number(product.gia_co_dinh || 0)
    };
}

async function loadAllocationPageData(req) {
    var storeId = await resolveStoreId(req);
    var hasStoreScope = storeId && mongoose.Types.ObjectId.isValid(storeId);
    var filter = normalizeFilterQuery(req?.query || {});
    var productQuery = {};
    applyProductListStatusFilter(productQuery, filter);
    if (filter.keyword) {
        productQuery.$or = [
            { ma_hang: { $regex: filter.keyword, $options: 'i' } },
            { ten_hang: { $regex: filter.keyword, $options: 'i' } }
        ];
    }

    var products = await HangHoa.find(productQuery).sort({ ma_hang: 1, created_at: -1 }).lean();
    var productIds = products.map(function(item) { return item._id; });
    if (!productIds.length) {
        return { lines: [], filter: filter, filterQueryString: buildFilterQueryString(filter) };
    }

    var tonMatch = { hang_hoa_id: { $in: productIds } };
    if (hasStoreScope) tonMatch.cua_hang_id = new mongoose.Types.ObjectId(storeId);
    var inventoryRows = await TonKho.aggregate([
        { $match: tonMatch },
        { $group: { _id: '$hang_hoa_id', total: { $sum: { $ifNull: ['$so_luong', 0] } } } }
    ]);
    var inventoryMap = inventoryRows.reduce(function(map, row) {
        map[String(row._id)] = Number(row.total || 0);
        return map;
    }, {});

    var scopedQuery = hasStoreScope ? { cua_hang_id: storeId } : {};
    var warehouses = await Kho.find(scopedQuery).sort({ ten_kho: 1, ma_kho: 1 }).lean();
    var warehouseMap = warehouses.reduce(function(map, warehouse) {
        map[String(warehouse._id)] = warehouse.ten_kho || warehouse.ma_kho || '---';
        return map;
    }, {});
    var units = await loadUnitOptions();
    var unitMap = units.reduce(function(map, unit) {
        map[String(unit._id)] = unit.ten_don_vi || '---';
        return map;
    }, {});

    var lotStockQuery = { hang_hoa_id: { $in: productIds }, so_luong: { $gt: 0 } };
    if (hasStoreScope) lotStockQuery.cua_hang_id = storeId;
    var lotStockRows = await TonKhoLo.find(lotStockQuery)
        .populate({
            path: 'lo_hang_id',
            select: 'ma_lo ten_lo ngay_nhap han_su_dung so_luong_ban_dau so_luong_con_lai don_gia_nhap gia_von trang_thai phieu_nhap_id',
            populate: { path: 'phieu_nhap_id', select: 'ma_phieu_nhap ngay_nhap' }
        })
        .sort({ updated_at: -1, created_at: -1 })
        .lean();

    var qcQuery = { hang_hoa_id: { $in: productIds }, so_luong: { $gt: 0 } };
    if (hasStoreScope) qcQuery.cua_hang_id = storeId;
    var qcRows = await TonKhoLoQuyCach.find(qcQuery).sort({ ten_quy_cach: 1, updated_at: -1 }).lean();
    var qcByLot = qcRows.reduce(function(map, row) {
        var lotId = String(row.lo_hang_id || '');
        if (!lotId) return map;
        if (!map[lotId]) map[lotId] = [];
        map[lotId].push(row);
        return map;
    }, {});
    var lotsByProduct = lotStockRows.reduce(function(map, row) {
        var productId = String(row.hang_hoa_id || '');
        if (!map[productId]) map[productId] = [];
        map[productId].push(row);
        return map;
    }, {});
    var tonKhoRows = await TonKho.find(Object.assign({}, tonMatch, { so_luong: { $gt: 0 } })).sort({ updated_at: -1 }).lean();
    var tonKhoByProduct = tonKhoRows.reduce(function(map, row) {
        var productId = String(row.hang_hoa_id || '');
        if (!map[productId]) map[productId] = [];
        map[productId].push(row);
        return map;
    }, {});

    var lines = [];
    products.forEach(function(product) {
        var productId = String(product._id);
        var donVi = unitMap[String(product.don_vi_tinh_id || '')] || '---';
        var tonKho = Number(inventoryMap[productId] || 0);
        if (product.quan_ly_theo_lo) {
            var productLots = lotsByProduct[productId] || [];
            if (!productLots.length) {
                if (tonKho > 0) {
                    lines.push(Object.assign({
                        product_id: product._id,
                        ma_hang: product.ma_hang || '---',
                        ten_hang: product.ten_hang || '---',
                        don_vi_tinh_ten: donVi,
                        ma_lo: '---',
                        ten_lo: '---',
                        ten_quy_cach: '---',
                        kho_ten: '---',
                        ngay_nhap: null,
                        han_su_dung: null,
                        so_luong_ban_dau: 0,
                        ton_thuc_te: tonKho,
                        ton_co_the_giao: 0,
                        ton_het_han: 0,
                        gia_von: Number(product.gia_von || 0),
                        ma_phieu_nhap: '---',
                        trang_thai_lo: '---'
                    }, buildAllocationLineExtras(product, null, null, null)));
                }
                return;
            }
            productLots.forEach(function(row) {
                var lot = row.lo_hang_id || {};
                var lotId = String(lot._id || row.lo_hang_id || '');
                var rawQty = normalizeStockNumber(row.so_luong !== undefined && row.so_luong !== null ? row.so_luong : lot.so_luong_con_lai);
                var qcItems = qcByLot[lotId] || [];
                var base = {
                    product_id: product._id,
                    ma_hang: product.ma_hang || '---',
                    ten_hang: product.ten_hang || '---',
                    don_vi_tinh_ten: donVi,
                    ma_lo: lot.ma_lo || '---',
                    ten_lo: lot.ten_lo || '---',
                    kho_ten: warehouseMap[String(row.kho_id || '')] || '---',
                    ngay_nhap: lot.ngay_nhap || null,
                    han_su_dung: lot.han_su_dung || null,
                    so_luong_ban_dau: Number(lot.so_luong_ban_dau || 0),
                    gia_von: Number(row.gia_von != null ? row.gia_von : (lot.gia_von || lot.don_gia_nhap || 0)),
                    ma_phieu_nhap: lot.phieu_nhap_id && lot.phieu_nhap_id.ma_phieu_nhap ? lot.phieu_nhap_id.ma_phieu_nhap : '---',
                    trang_thai_lo: lot.trang_thai || '---'
                };
                if (qcItems.length) {
                    qcItems.forEach(function(qc) {
                        var qty = normalizeStockNumber(qc.so_luong);
                        var lotExpired = isExpiredLot(lot);
                        lines.push(Object.assign({}, base, buildAllocationLineExtras(product, row, lot, qc), {
                            ten_quy_cach: qc.ten_quy_cach || qc.ten_thuoc_tinh || '---',
                            ton_thuc_te: qty,
                            ton_co_the_giao: isSellableLot(lot) ? qty : 0,
                            ton_het_han: lotExpired ? qty : 0,
                            gia_von: resolveQuyCachImportPrice(qc)
                        }));
                    });
                } else {
                    lines.push(Object.assign({}, base, buildAllocationLineExtras(product, row, lot, null), {
                        ten_quy_cach: '---',
                        ton_thuc_te: rawQty,
                        ton_co_the_giao: isSellableLot(lot) ? rawQty : 0,
                        ton_het_han: isExpiredLot(lot) ? rawQty : 0
                    }));
                }
            });
            return;
        }
        var warehouseRows = tonKhoByProduct[productId] || [];
        if (!warehouseRows.length && tonKho <= 0) return;
        if (!warehouseRows.length) {
            lines.push(Object.assign({
                product_id: product._id,
                ma_hang: product.ma_hang || '---',
                ten_hang: product.ten_hang || '---',
                don_vi_tinh_ten: donVi,
                ma_lo: '---',
                ten_lo: 'Không theo lô',
                ten_quy_cach: '---',
                kho_ten: '---',
                ngay_nhap: null,
                han_su_dung: null,
                so_luong_ban_dau: 0,
                ton_thuc_te: tonKho,
                ton_co_the_giao: tonKho,
                ton_het_han: 0,
                gia_von: Number(product.gia_von || 0),
                ma_phieu_nhap: '---',
                trang_thai_lo: '---'
            }, buildAllocationLineExtras(product, null, null, null)));
            return;
        }
        warehouseRows.forEach(function(row) {
            var qty = normalizeStockNumber(row.so_luong);
            lines.push(Object.assign({
                product_id: product._id,
                ma_hang: product.ma_hang || '---',
                ten_hang: product.ten_hang || '---',
                don_vi_tinh_ten: donVi,
                ma_lo: '---',
                ten_lo: 'Không theo lô',
                ten_quy_cach: '---',
                kho_ten: warehouseMap[String(row.kho_id || '')] || '---',
                ngay_nhap: null,
                han_su_dung: null,
                so_luong_ban_dau: 0,
                ton_thuc_te: qty,
                ton_co_the_giao: qty,
                ton_het_han: 0,
                gia_von: Number(product.gia_von || 0),
                ma_phieu_nhap: '---',
                trang_thai_lo: '---'
            }, buildAllocationLineExtras(product, row, null, null)));
        });
    });

    lines = lines.filter(function(line) {
        return Number(line.ton_thuc_te || 0) > 0;
    });

    var khoProductMap = {};
    lines.forEach(function(line) {
        var khoId = String(line.kho_id || '');
        var productId = String(line.product_id || '');
        if (!khoId || !productId) return;
        if (!khoProductMap[khoId]) khoProductMap[khoId] = {};
        khoProductMap[khoId][productId] = productId;
    });
    var reservedByKho = {};
    var khoIds = Object.keys(khoProductMap);
    await Promise.all(khoIds.map(async function(khoId) {
        var productIds = Object.keys(khoProductMap[khoId]);
        reservedByKho[khoId] = await getReservedQuantitiesForSale({
            kho_id: khoId,
            hang_hoa_ids: productIds
        });
    }));
    lines = lines.map(function(line) {
        var khoId = String(line.kho_id || '');
        var reserved = khoId ? reservedByKho[khoId] : null;
        return Object.assign({}, line, {
            so_luong_khach_dat: resolveLineReservedQty(reserved, line)
        });
    });

    return { lines: lines, filter: filter, filterQueryString: buildFilterQueryString(filter) };
}

exports.allocationPage = async function(req, res, next) {
    try {
        var data = await loadAllocationPageData(req);
        var storeId = await resolveStoreId(req);
        var customerQuery = { trang_thai: { $ne: 'inactive' } };
        if (storeId && mongoose.Types.ObjectId.isValid(storeId)) {
            customerQuery.cua_hang_id = storeId;
        }
        var customersRaw = await KhachHang.find(customerQuery)
            .sort({ ten_khach_hang: 1 })
            .select('ma_khach_hang ten_khach_hang sdt sdt2 email dia_chi_day_du dia_chi_nhan tinh_thanh phuong_xa')
            .lean();
        if (!customersRaw.length) {
            customersRaw = await KhachHang.find({ trang_thai: { $ne: 'inactive' } })
                .sort({ ten_khach_hang: 1 })
                .select('ma_khach_hang ten_khach_hang sdt sdt2 email dia_chi_day_du dia_chi_nhan tinh_thanh phuong_xa')
                .lean();
        }
        var customerIds = customersRaw.map(function(item) { return item._id; });
        var addresses = customerIds.length
            ? await DiaChiKhachHang.find({ khach_hang_id: { $in: customerIds } }).lean()
            : [];
        var addressesByCustomer = addresses.reduce(function(map, address) {
            var key = String(address.khach_hang_id || '');
            if (!key) return map;
            if (!map[key]) map[key] = [];
            map[key].push(address);
            return map;
        }, {});
        var customers = customersRaw.map(function(customer) {
            return Object.assign({}, customer, {
                dia_chi_list: addressesByCustomer[String(customer._id)] || []
            });
        });
        var vatChuaQuery = { trang_thai: 'active' };
        if (storeId && mongoose.Types.ObjectId.isValid(storeId)) {
            vatChuaQuery.cua_hang_id = storeId;
        }
        var vatChuaList = await VatChua.find(vatChuaQuery)
            .sort({ ten_vat_chua: 1, ma_vat_chua: 1 })
            .select('ma_vat_chua ten_vat_chua so_luong_ton')
            .lean();
        res.render('hang-hoa/phan-bo', {
            title: 'Phân bổ hàng tồn kho',
            pageTitle: 'Phân bổ hàng tồn kho',
            activeMenu: 'hang-hoa',
            user: req.user,
            flash: req.query || {},
            lines: data.lines,
            filter: data.filter,
            filterQueryString: data.filterQueryString,
            customers: customers,
            vatChuaList: vatChuaList,
            formatDate: formatDate
        });
    } catch (error) {
        next(error);
    }
};

exports.submitAllocation = async function(req, res, next) {
    try {
        var result = await submitStockAllocation(req);
        res.json(result);
    } catch (error) {
        if (error && error.statusCode) {
            return res.status(error.statusCode).json({ success: false, message: error.message, details: error.details || null });
        }
        next(error);
    }
};

exports.index = async function(req, res, next) {
    try {
        var requestQuery = req?.query || {};
        if (Object.prototype.hasOwnProperty.call(requestQuery, 'product')) {
            var redirectQuery = Object.assign({}, requestQuery);
            delete redirectQuery.product;
            var qs = querystring.stringify(redirectQuery);
            return res.redirect(302, '/hang-hoa' + (qs ? '?' + qs : ''));
        }
        var filter = normalizeFilterQuery(requestQuery);
        var dateRange = getDateRange(filter);
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
        if (dateRange.start || dateRange.end) {
            productQuery.created_at = {};
            if (dateRange.start) productQuery.created_at.$gte = dateRange.start;
            if (dateRange.end) productQuery.created_at.$lte = dateRange.end;
        }

        var products = await HangHoa.find(productQuery).sort({ created_at: -1, ma_hang: 1 }).lean();
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
        if (stockRange) {
            products = products.filter(function(item) {
                var qty = Number(inventoryMap[String(item._id)] || 0);
                if (Object.prototype.hasOwnProperty.call(stockRange, '$gte') && qty < stockRange.$gte) return false;
                if (Object.prototype.hasOwnProperty.call(stockRange, '$lte') && qty > stockRange.$lte) return false;
                return true;
            });
        }

        var storeId = await resolveStoreId(req);
        var groups = await loadProductGroups(storeId);
        var suppliers = await NhaCungCap.find({}).sort({ ten_ncc: 1 }).lean();
        var units = await loadUnitOptions();
        var groupMap = groups.reduce(function(map, group) {
            map[String(group._id)] = group.ten_nhom_hang || '---';
            return map;
        }, {});
        var supplierMap = suppliers.reduce(function(map, supplier) {
            map[String(supplier._id)] = supplier.ten_ncc || '---';
            return map;
        }, {});
        var unitMap = units.reduce(function(map, unit) {
            map[String(unit._id)] = unit.ten_don_vi || '---';
            return map;
        }, {});

        var finalProductIds = products.map(function(item) { return item._id; });
        var priceMaps = await buildProductListPriceMaps(finalProductIds);

        products = products.map(function(item) {
            item.ton_kho = Number(inventoryMap[String(item._id)] || 0);
            item.nhom_hang_ten = groupMap[String(item.nhom_hang_id || '')] || '---';
            item.nha_cung_cap_ten = supplierMap[String(item.nha_cung_cap_id || '')] || '---';
            item.don_vi_tinh_ten = unitMap[String(item.don_vi_tinh_id || '')] || '---';
            item.gia_ban_hien_thi = Number(item.gia_co_dinh || 0);
            return applyProductListPriceFields(item, priceMaps);
        });
        var filterQueryString = buildFilterQueryString(filter);

        var bangGiaList = await BangGia.find({ trang_thai: 'active' }).sort({ ten_bang_gia: 1 }).lean();

        res.render('hang-hoa/index', {
            title: 'Hàng hóa',
            pageTitle: 'Hàng hóa',
            activeMenu: 'hang-hoa',
            user: req.user,
            flash: requestQuery,
            bangGiaList: bangGiaList,
            products: products,
            groups: groups,
            units: units,
            suppliers: suppliers,
            filter: filter,
            formatDate: formatDate,
            filterQueryString: filterQueryString,
            formMode: requestQuery.mode === 'create' ? 'create' : ''
        });
    } catch (error) {
        next(error);
    }
};

exports.printContract = async function(req, res, next) {
    try {
        var data = await loadProductContractData(req);
        return res.render('nhap-hang/hd-mua-ban-nguyen-tac', data);
    } catch (error) {
        next(error);
    }
};

exports.printContractPdf = async function(req, res, next) {
    try {
        var data = await loadProductContractData(req);
        var viewPath = path.join(__dirname, '..', 'views', 'nhap-hang', 'hd-mua-ban-nguyen-tac.ejs');
        var html = await pdfService.renderViewToHtml(viewPath, data);
        var buffer = await pdfService.generatePdfFromHtml(html, {
            format: 'A4',
            printBackground: true,
            margin: {
                top: '10mm',
                right: '10mm',
                bottom: '10mm',
                left: '10mm'
            }
        });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="hd-nguyen-tac-hang-hoa.pdf"');
        return res.send(Buffer.from(buffer));
    } catch (error) {
        next(error);
    }
};

exports.add = async function(req, res, next) {
    try {
        var payload = normalizeProductPayload(req?.body);
        if (!payload.ten_hang) {
            return res.redirect('/hang-hoa?mode=create&error=missing_name');
        }
        if (!payload.ma_hang) {
            payload.ma_hang = await makeProductCode();
        }
        if (!payload.nhom_hang_id) delete payload.nhom_hang_id;
        if (!payload.don_vi_tinh_id) delete payload.don_vi_tinh_id;
        if (!payload.nha_cung_cap_id) delete payload.nha_cung_cap_id;

        var initialQty = Number(payload.ton_ban_dau || 0);
        var created = await HangHoa.create(payload);
        if (initialQty > 0) {
            var warehouse = await getDefaultWarehouseForProduct(created, req);
            if (warehouse) {
                var inventory = await TonKho.findOneAndUpdate(
                    { kho_id: warehouse._id, hang_hoa_id: created._id },
                    {
                        $setOnInsert: {
                            cua_hang_id: warehouse.cua_hang_id,
                            chi_nhanh_id: warehouse.chi_nhanh_id,
                            kho_id: warehouse._id,
                            hang_hoa_id: created._id
                        },
                        $inc: { so_luong: initialQty }
                    },
                    { upsert: true, new: true, setDefaultsOnInsert: true }
                ).lean();

                var lotOptions = {
                    ma_lo: String(req?.body?.initial_lot_ma || '').trim() || undefined,
                    ten_lo: String(req?.body?.initial_lot_ten || '').trim() || undefined,
                    han_su_dung: req?.body?.initial_lot_han_su_dung ? new Date(req.body.initial_lot_han_su_dung) : undefined,
                    ghi_chu: 'Tạo từ tồn ban đầu'
                };
                var createdLots = [];
                if (created.quan_ly_theo_lo) {
                    createdLots = await createDefaultLotFromInventory(created, [inventory], req, lotOptions);
                }

                if (LichSuKho) {
                    await LichSuKho.create({
                        cua_hang_id: warehouse.cua_hang_id,
                        chi_nhanh_id: warehouse.chi_nhanh_id,
                        kho_id: warehouse._id,
                        hang_hoa_id: created._id,
                        lo_hang_id: createdLots[0]?._id || undefined,
                        nguoi_tao_id: req.user && req.user._id ? req.user._id : undefined,
                        loai_phieu: 'dieu_chinh',
                        ma_phieu: 'TON_DAU_' + (created.ma_hang || created._id),
                        so_luong_thay_doi: initialQty,
                        ton_kho_sau: Number(inventory.so_luong || 0),
                        gia_tri_thay_doi: initialQty * Number(created.gia_von || 0),
                        ghi_chu: 'Tồn ban đầu'
                    });
                }
            }
        }
        res.redirect('/hang-hoa?success=created');
    } catch (error) {
        if (error && error.code === 11000) {
            return res.redirect('/hang-hoa?mode=create&error=duplicate_code');
        }
        next(error);
    }
};

exports.update = async function(req, res, next) {
    try {
        var productId = normalizeIdParam(req?.params?.id);
        if (!productId) return res.redirect('/hang-hoa?error=invalid_product');

        var payload = normalizeProductPayload(req?.body);
        if (!payload.ten_hang) {
            return res.redirect('/hang-hoa?mode=create&error=missing_name');
        }

        if (!payload.ma_hang) delete payload.ma_hang;
        if (!payload.nhom_hang_id) delete payload.nhom_hang_id;
        if (!payload.don_vi_tinh_id) delete payload.don_vi_tinh_id;
        if (!payload.nha_cung_cap_id) delete payload.nha_cung_cap_id;

        var oldProduct = await HangHoa.findById(productId).lean();
        var updatedProduct = await HangHoa.findByIdAndUpdate(productId, payload, { runValidators: true, new: true });
        if (oldProduct && !oldProduct.quan_ly_theo_lo && updatedProduct && updatedProduct.quan_ly_theo_lo) {
            var inventoryRows = await TonKho.find({ hang_hoa_id: updatedProduct._id, so_luong: { $gt: 0 } }).lean();
            await createDefaultLotFromInventory(updatedProduct, inventoryRows, req, {
                ma_lo: String(req?.body?.initial_lot_ma || '').trim() || undefined,
                ten_lo: String(req?.body?.initial_lot_ten || '').trim() || undefined,
                han_su_dung: req?.body?.initial_lot_han_su_dung ? new Date(req.body.initial_lot_han_su_dung) : undefined
            });
        }
        res.redirect('/hang-hoa?success=updated');
    } catch (error) {
        if (error && error.code === 11000) {
            return res.redirect('/hang-hoa?mode=create&error=duplicate_code');
        }
        next(error);
    }
};

exports.remove = async function(req, res, next) {
    try {
        var productId = normalizeIdParam(req?.params?.id);
        if (!productId) return res.redirect('/hang-hoa?error=invalid_product');

        await HangHoa.findByIdAndUpdate(productId, { trang_thai: 'inactive' });
        res.redirect('/hang-hoa?success=deleted');
    } catch (error) {
        next(error);
    }
};

exports.removeSelected = async function(req, res, next) {
    try {
        var ids = req?.body?.ids || [];
        if (!Array.isArray(ids)) ids = [ids];
        ids = ids.map(function(item) { return String(item || '').trim(); }).filter(Boolean);
        if (ids.length === 0) return res.redirect('/hang-hoa?error=no_selection');

        await HangHoa.updateMany({ _id: { $in: ids } }, { $set: { trang_thai: 'inactive' } });
        res.redirect('/hang-hoa?success=deleted');
    } catch (error) {
        next(error);
    }
};

exports.addGroup = async function(req, res, next) {
    try {
        var tenNhom = String(req?.body?.ten_nhom_hang || '').trim();
        var moTa = String(req?.body?.mo_ta || '').trim();
        var maNhom = String(req?.body?.ma_nhom_hang || '').trim().toUpperCase();
        if (!tenNhom) return respondProductGroupError(req, res, 400, 'Vui lòng nhập tên nhóm hàng.');
        if (!maNhom) maNhom = await makeProductGroupCode();

        var storeId = await resolveStoreId(req);
        var duplicate = await findDuplicateGroupName(storeId, tenNhom);
        if (duplicate) {
            return respondProductGroupError(req, res, 409, 'Tên nhóm hàng đã tồn tại trong cửa hàng này.');
        }

        var doc = {
            ma_nhom_hang: maNhom,
            ten_nhom_hang: tenNhom,
            mo_ta: moTa,
            trang_thai: 'active'
        };
        if (storeId && mongoose.Types.ObjectId.isValid(storeId)) doc.cua_hang_id = storeId;

        var created = await NhomHang.create(doc);

        if (shouldRespondJson(req)) {
            return res.json({
                success: true,
                message: 'Đã thêm nhóm hàng.',
                data: created,
                selectedId: String(created._id),
                groups: await loadProductGroups(storeId)
            });
        }

        res.redirect('/hang-hoa?success=created');
    } catch (error) {
        if (error && error.code === 11000) {
            return respondProductGroupError(req, res, 409, 'Mã nhóm hàng đã tồn tại.');
        }
        if (error && error.name === 'ValidationError') {
            return respondProductGroupError(req, res, 400, error.message || 'Dữ liệu nhóm hàng không hợp lệ.');
        }
        next(error);
    }
};

exports.updateGroup = async function(req, res, next) {
    try {
        var groupId = normalizeIdParam(req?.params?.groupId);
        if (!groupId || !mongoose.Types.ObjectId.isValid(groupId)) {
            return respondProductGroupError(req, res, 400, 'Nhóm hàng không hợp lệ.');
        }

        var tenNhom = String(req?.body?.ten_nhom_hang || '').trim();
        var moTa = String(req?.body?.mo_ta || '').trim();
        if (!tenNhom) return respondProductGroupError(req, res, 400, 'Vui lòng nhập tên nhóm hàng.');

        var existing = await NhomHang.findById(groupId).lean();
        if (!existing) return respondProductGroupError(req, res, 404, 'Không tìm thấy nhóm hàng.');

        var storeId = existing.cua_hang_id ? String(existing.cua_hang_id) : await resolveStoreId(req);
        var duplicate = await findDuplicateGroupName(storeId, tenNhom, groupId);
        if (duplicate) {
            return respondProductGroupError(req, res, 409, 'Tên nhóm hàng đã tồn tại trong cửa hàng này.');
        }

        var updated = await NhomHang.findByIdAndUpdate(
            groupId,
            { ten_nhom_hang: tenNhom, mo_ta: moTa },
            { runValidators: true, new: true }
        );
        if (!updated) return respondProductGroupError(req, res, 404, 'Không tìm thấy nhóm hàng.');

        if (shouldRespondJson(req)) {
            return res.json({
                success: true,
                message: 'Đã cập nhật nhóm hàng.',
                data: updated,
                selectedId: groupId,
                groups: await loadProductGroups(storeId)
            });
        }

        res.redirect('/hang-hoa?success=updated');
    } catch (error) {
        if (error && error.name === 'ValidationError') {
            return respondProductGroupError(req, res, 400, error.message || 'Dữ liệu nhóm hàng không hợp lệ.');
        }
        next(error);
    }
};

exports.removeGroup = async function(req, res, next) {
    try {
        var groupId = normalizeIdParam(req?.params?.groupId);
        if (!groupId || !mongoose.Types.ObjectId.isValid(groupId)) {
            return respondProductGroupError(req, res, 400, 'Nhóm hàng không hợp lệ.');
        }

        var usedCount = await HangHoa.countDocuments({ nhom_hang_id: groupId });
        var deleted = null;
        var message = 'Da xoa nhom hang.';
        if (usedCount > 0) {
            deleted = await NhomHang.findByIdAndUpdate(groupId, { trang_thai: 'inactive' }, { new: true });
            message = 'Nhom hang dang duoc su dung nen da chuyen sang ngung hoat dong.';
        } else {
            deleted = await NhomHang.findByIdAndDelete(groupId);
        }
        if (!deleted) return respondProductGroupError(req, res, 404, 'Không tìm thấy nhóm hàng.');
        if (shouldRespondJson(req)) {
            return res.json({
                success: true,
                message: message,
                groups: await loadProductGroups()
            });
        }

        res.redirect('/hang-hoa?success=deleted');
    } catch (error) {
        next(error);
    }
};

exports.addUnit = async function(req, res, next) {
    try {
        var tenDonVi = String(req?.body?.ten_don_vi || '').trim();
        var maDonVi = String(req?.body?.ma_don_vi || '').trim().toUpperCase();
        if (!tenDonVi) return respondUnitError(req, res, 400, 'Vui lòng nhập tên đơn vị tính.');
        if (!maDonVi) maDonVi = await makeUnitCode();

        var doc = {
            ma_don_vi: maDonVi,
            ten_don_vi: tenDonVi,
            trang_thai: 'active'
        };
        var storeId = await resolveStoreId(req);
        if (storeId && mongoose.Types.ObjectId.isValid(storeId)) doc.cua_hang_id = storeId;

        var created = await DonViTinh.create(doc);

        if (shouldRespondJson(req)) {
            return res.json({
                success: true,
                message: 'Đã thêm đơn vị tính.',
                data: created,
                selectedId: String(created._id),
                units: await loadUnitOptions()
            });
        }
        res.redirect('/hang-hoa?success=created');
    } catch (error) {
        if (error && error.code === 11000) {
            return respondUnitError(req, res, 409, 'Mã đơn vị tính đã tồn tại.');
        }
        if (error && error.name === 'ValidationError') {
            return respondUnitError(req, res, 400, error.message || 'Dữ liệu đơn vị tính không hợp lệ.');
        }
        next(error);
    }
};

exports.updateUnit = async function(req, res, next) {
    try {
        var unitId = normalizeIdParam(req?.params?.unitId);
        if (!unitId || !mongoose.Types.ObjectId.isValid(unitId)) {
            return respondUnitError(req, res, 400, 'Đơn vị tính không hợp lệ.');
        }

        var tenDonVi = String(req?.body?.ten_don_vi || '').trim();
        if (!tenDonVi) return respondUnitError(req, res, 400, 'Vui lòng nhập tên đơn vị tính.');

        var updated = await DonViTinh.findByIdAndUpdate(
            unitId,
            { ten_don_vi: tenDonVi },
            { runValidators: true, new: true }
        );
        if (!updated) return respondUnitError(req, res, 404, 'Không tìm thấy đơn vị tính.');

        if (shouldRespondJson(req)) {
            return res.json({
                success: true,
                message: 'Đã cập nhật đơn vị tính.',
                data: updated,
                selectedId: unitId,
                units: await loadUnitOptions()
            });
        }
        res.redirect('/hang-hoa?success=updated');
    } catch (error) {
        if (error && error.name === 'ValidationError') {
            return respondUnitError(req, res, 400, error.message || 'Dữ liệu đơn vị tính không hợp lệ.');
        }
        next(error);
    }
};

exports.removeUnit = async function(req, res, next) {
    try {
        var unitId = normalizeIdParam(req?.params?.unitId);
        if (!unitId || !mongoose.Types.ObjectId.isValid(unitId)) {
            return respondUnitError(req, res, 400, 'Đơn vị tính không hợp lệ.');
        }

        await HangHoa.updateMany(
            { don_vi_tinh_id: unitId },
            { $unset: { don_vi_tinh_id: 1 } }
        );
        var deleted = await DonViTinh.findByIdAndDelete(unitId);
        if (!deleted) return respondUnitError(req, res, 404, 'Không tìm thấy đơn vị tính.');

        if (shouldRespondJson(req)) {
            return res.json({
                success: true,
                message: 'Đã xóa đơn vị tính.',
                units: await loadUnitOptions()
            });
        }
        res.redirect('/hang-hoa?success=deleted');
    } catch (error) {
        next(error);
    }
};

exports.priceSetup = async function(req, res, next) {
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
            ? String(selectedBangGiaOrdered.length) + ' bảng giá'
            : 'Thiết lập giá';

        res.render('hang-hoa/thiet-lap-gia', {
            title: 'Thiết lập giá',
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

exports.attributesPage = async function(req, res, next) {
    try {
        var storeId = await resolveStoreId(req);
        await ensureDefaultAttributes(storeId);
        var attrQuery = {};
        if (storeId && mongoose.Types.ObjectId.isValid(storeId)) attrQuery.cua_hang_id = storeId;
        var attributes = await ThuocTinhHang.find(attrQuery).sort({ created_at: 1, ten_thuoc_tinh: 1 }).lean();
        if (attributes.length === 0 && attrQuery.cua_hang_id) {
            attributes = await ThuocTinhHang.find({}).sort({ created_at: 1, ten_thuoc_tinh: 1 }).lean();
        }
        var selectedId = String(req.query.thuoc_tinh_id || (attributes[0] && attributes[0]._id) || '');
        if (selectedId && !attributes.some(function(a) { return String(a._id) === selectedId; })) {
            selectedId = attributes[0] ? String(attributes[0]._id) : '';
        }
        var valueQuery = selectedId && mongoose.Types.ObjectId.isValid(selectedId) ? { thuoc_tinh_id: selectedId } : { _id: null };
        var values = await GiaTriThuocTinh.find(valueQuery).sort({ thu_tu: 1, ten_gia_tri: 1 }).lean();
        var countsAgg = await GiaTriThuocTinh.aggregate([
            { $match: { thuoc_tinh_id: { $in: attributes.map(function(a) { return a._id; }) } } },
            { $group: { _id: '$thuoc_tinh_id', count: { $sum: 1 } } }
        ]);
        var valueCounts = {};
        countsAgg.forEach(function(row) { valueCounts[String(row._id)] = row.count; });

        res.render('hang-hoa/thuoc-tinh', {
            title: 'Thuộc tính hàng hóa',
            pageTitle: 'Thuộc tính hàng hóa',
            activeMenu: 'hang-hoa',
            user: req.user,
            flash: req.query || {},
            attributes: attributes,
            values: values,
            valueCounts: valueCounts,
            selectedId: selectedId
        });
    } catch (error) {
        next(error);
    }
};

exports.addAttribute = async function(req, res, next) {
    try {
        var storeId = await resolveStoreId(req);
        var payload = normalizeAttributePayload(req.body);
        if (!payload.ten_thuoc_tinh) return res.redirect('/hang-hoa/thuoc-tinh?error=missing_name');
        if (!payload.ma_thuoc_tinh) payload.ma_thuoc_tinh = await nextAttributeCode(storeId);
        if (storeId && mongoose.Types.ObjectId.isValid(storeId)) payload.cua_hang_id = storeId;
        var created = await ThuocTinhHang.create(payload);
        res.redirect('/hang-hoa/thuoc-tinh?thuoc_tinh_id=' + created._id + '&success=created');
    } catch (error) {
        next(error);
    }
};

exports.updateAttribute = async function(req, res, next) {
    try {
        var id = String(req.params.id || '').trim();
        if (!mongoose.Types.ObjectId.isValid(id)) return res.redirect('/hang-hoa/thuoc-tinh?error=invalid_id');
        var payload = normalizeAttributePayload(req.body);
        if (!payload.ten_thuoc_tinh) return res.redirect('/hang-hoa/thuoc-tinh?error=missing_name');
        await ThuocTinhHang.updateOne({ _id: id }, { $set: payload }, { runValidators: true });
        res.redirect('/hang-hoa/thuoc-tinh?thuoc_tinh_id=' + id + '&success=updated');
    } catch (error) {
        next(error);
    }
};

exports.deleteAttribute = async function(req, res, next) {
    try {
        var id = String(req.params.id || '').trim();
        if (!mongoose.Types.ObjectId.isValid(id)) return res.redirect('/hang-hoa/thuoc-tinh?error=invalid_id');
        var usedByProduct = await HangHoaThuocTinh.exists({ thuoc_tinh_id: id });
        var hasValues = await GiaTriThuocTinh.exists({ thuoc_tinh_id: id });
        if (usedByProduct || hasValues) {
            await ThuocTinhHang.updateOne({ _id: id }, { $set: { trang_thai: 'inactive' } });
        } else {
            await ThuocTinhHang.deleteOne({ _id: id });
        }
        res.redirect('/hang-hoa/thuoc-tinh?success=deleted');
    } catch (error) {
        next(error);
    }
};

exports.addAttributeValue = async function(req, res, next) {
    try {
        var attrId = String(req.params.attributeId || '').trim();
        if (!mongoose.Types.ObjectId.isValid(attrId)) return res.redirect('/hang-hoa/thuoc-tinh?error=invalid_attribute');
        var attr = await ThuocTinhHang.findById(attrId).lean();
        if (!attr) return res.redirect('/hang-hoa/thuoc-tinh?error=attribute_not_found');
        var payload = normalizeAttributeValuePayload(req.body);
        if (!payload.ten_gia_tri) return res.redirect('/hang-hoa/thuoc-tinh?thuoc_tinh_id=' + attrId + '&error=missing_value');
        if (!payload.ma_gia_tri) payload.ma_gia_tri = await nextAttributeValueCode(attrId);
        payload.thuoc_tinh_id = attrId;
        payload.cua_hang_id = attr.cua_hang_id || undefined;
        await GiaTriThuocTinh.create(payload);
        res.redirect('/hang-hoa/thuoc-tinh?thuoc_tinh_id=' + attrId + '&success=value_created');
    } catch (error) {
        next(error);
    }
};

exports.updateAttributeValue = async function(req, res, next) {
    try {
        var id = String(req.params.id || '').trim();
        if (!mongoose.Types.ObjectId.isValid(id)) return res.redirect('/hang-hoa/thuoc-tinh?error=invalid_value');
        var value = await GiaTriThuocTinh.findById(id).lean();
        if (!value) return res.redirect('/hang-hoa/thuoc-tinh?error=value_not_found');
        var payload = normalizeAttributeValuePayload(req.body);
        if (!payload.ten_gia_tri) return res.redirect('/hang-hoa/thuoc-tinh?thuoc_tinh_id=' + value.thuoc_tinh_id + '&error=missing_value');
        await GiaTriThuocTinh.updateOne({ _id: id }, { $set: payload }, { runValidators: true });
        res.redirect('/hang-hoa/thuoc-tinh?thuoc_tinh_id=' + value.thuoc_tinh_id + '&success=value_updated');
    } catch (error) {
        next(error);
    }
};

exports.deleteAttributeValue = async function(req, res, next) {
    try {
        var id = String(req.params.id || '').trim();
        if (!mongoose.Types.ObjectId.isValid(id)) return res.redirect('/hang-hoa/thuoc-tinh?error=invalid_value');
        var value = await GiaTriThuocTinh.findById(id).lean();
        if (!value) return res.redirect('/hang-hoa/thuoc-tinh?error=value_not_found');
        var used = await HangHoaThuocTinh.exists({ gia_tri_id: id });
        if (used) await GiaTriThuocTinh.updateOne({ _id: id }, { $set: { trang_thai: 'inactive' } });
        else await GiaTriThuocTinh.deleteOne({ _id: id });
        res.redirect('/hang-hoa/thuoc-tinh?thuoc_tinh_id=' + value.thuoc_tinh_id + '&success=value_deleted');
    } catch (error) {
        next(error);
    }
};

exports.apiAttributes = async function(req, res, next) {
    try {
        var storeId = await resolveStoreId(req);
        await ensureDefaultAttributes(storeId);
        var query = {};
        if (storeId && mongoose.Types.ObjectId.isValid(storeId)) query.cua_hang_id = storeId;
        var items = await ThuocTinhHang.find(query).sort({ ten_thuoc_tinh: 1 }).lean();
        return res.json({ success: true, data: items });
    } catch (error) {
        next(error);
    }
};

exports.apiCreateAttribute = async function(req, res, next) {
    try {
        var storeId = await resolveStoreId(req);
        var payload = normalizeAttributePayload(req.body);
        if (!payload.ten_thuoc_tinh) return res.status(400).json({ success: false, message: 'Tên thuộc tính là bắt buộc' });
        if (!payload.ma_thuoc_tinh) payload.ma_thuoc_tinh = await nextAttributeCode(storeId);
        if (storeId && mongoose.Types.ObjectId.isValid(storeId)) payload.cua_hang_id = storeId;
        var created = await ThuocTinhHang.create(payload);
        return res.json({ success: true, data: created });
    } catch (error) {
        next(error);
    }
};

exports.apiUpdateAttribute = async function(req, res, next) {
    try {
        var id = String(req.params.id || '');
        if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ success: false, message: 'ID không hợp lệ' });
        var payload = normalizeAttributePayload(req.body);
        await ThuocTinhHang.updateOne({ _id: id }, { $set: payload }, { runValidators: true });
        return res.json({ success: true });
    } catch (error) {
        next(error);
    }
};

exports.apiDeleteAttribute = async function(req, res, next) {
    try {
        var id = String(req.params.id || '');
        if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ success: false, message: 'ID không hợp lệ' });
        var used = await HangHoaThuocTinh.exists({ thuoc_tinh_id: id });
        var hasValues = await GiaTriThuocTinh.exists({ thuoc_tinh_id: id });
        if (used || hasValues) await ThuocTinhHang.updateOne({ _id: id }, { $set: { trang_thai: 'inactive' } });
        else await ThuocTinhHang.deleteOne({ _id: id });
        return res.json({ success: true });
    } catch (error) {
        next(error);
    }
};

exports.apiAttributeValues = async function(req, res, next) {
    try {
        var query = {};
        var attrId = String(req.query.thuoc_tinh_id || '').trim();
        if (mongoose.Types.ObjectId.isValid(attrId)) query.thuoc_tinh_id = attrId;
        var items = await GiaTriThuocTinh.find(query).sort({ thu_tu: 1, ten_gia_tri: 1 }).lean();
        return res.json({ success: true, data: items });
    } catch (error) {
        next(error);
    }
};

exports.apiCreateAttributeValue = async function(req, res, next) {
    try {
        var attrId = String(req.body.thuoc_tinh_id || '').trim();
        if (!mongoose.Types.ObjectId.isValid(attrId)) return res.status(400).json({ success: false, message: 'Thuộc tính không hợp lệ' });
        var attr = await ThuocTinhHang.findById(attrId).lean();
        if (!attr) return res.status(404).json({ success: false, message: 'Không tìm thấy thuộc tính' });
        var payload = normalizeAttributeValuePayload(req.body);
        if (!payload.ten_gia_tri) return res.status(400).json({ success: false, message: 'Tên giá trị là bắt buộc' });
        if (!payload.ma_gia_tri) payload.ma_gia_tri = await nextAttributeValueCode(attrId);
        payload.thuoc_tinh_id = attrId;
        payload.cua_hang_id = attr.cua_hang_id || undefined;
        var created = await GiaTriThuocTinh.create(payload);
        return res.json({ success: true, data: created });
    } catch (error) {
        next(error);
    }
};

exports.apiUpdateAttributeValue = async function(req, res, next) {
    try {
        var id = String(req.params.id || '');
        if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ success: false, message: 'ID không hợp lệ' });
        var payload = normalizeAttributeValuePayload(req.body);
        await GiaTriThuocTinh.updateOne({ _id: id }, { $set: payload }, { runValidators: true });
        return res.json({ success: true });
    } catch (error) {
        next(error);
    }
};

exports.apiDeleteAttributeValue = async function(req, res, next) {
    try {
        var id = String(req.params.id || '');
        if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ success: false, message: 'ID không hợp lệ' });
        var used = await HangHoaThuocTinh.exists({ gia_tri_id: id });
        if (used) await GiaTriThuocTinh.updateOne({ _id: id }, { $set: { trang_thai: 'inactive' } });
        else await GiaTriThuocTinh.deleteOne({ _id: id });
        return res.json({ success: true });
    } catch (error) {
        next(error);
    }
};

exports.apiProductAttributes = async function(req, res, next) {
    try {
        var productId = String(req.params.id || '').trim();
        if (!mongoose.Types.ObjectId.isValid(productId)) return res.status(400).json({ success: false, message: 'Hàng hóa không hợp lệ' });
        var rows = await HangHoaThuocTinh.find({ hang_hoa_id: productId })
            .populate({ path: 'thuoc_tinh_id', select: 'ten_thuoc_tinh trang_thai' })
            .populate({ path: 'gia_tri_id', select: 'ten_gia_tri thu_tu trang_thai' })
            .lean();
        var grouped = {};
        rows.forEach(function(row) {
            if (!row.thuoc_tinh_id || !row.gia_tri_id) return;
            if (row.thuoc_tinh_id.trang_thai === 'inactive' || row.gia_tri_id.trang_thai === 'inactive') return;
            var key = String(row.thuoc_tinh_id._id);
            if (!grouped[key]) grouped[key] = { thuoc_tinh_id: key, ten_thuoc_tinh: row.thuoc_tinh_id.ten_thuoc_tinh, values: [] };
            grouped[key].values.push({ gia_tri_id: String(row.gia_tri_id._id), ten_gia_tri: row.gia_tri_id.ten_gia_tri, thu_tu: row.gia_tri_id.thu_tu || 0 });
        });
        var data = Object.values(grouped).map(function(group) {
            group.values.sort(function(a, b) { return (a.thu_tu || 0) - (b.thu_tu || 0) || String(a.ten_gia_tri || '').localeCompare(String(b.ten_gia_tri || ''), 'vi'); });
            return group;
        });
        return res.json({ success: true, data: data });
    } catch (error) {
        next(error);
    }
};

exports.updateRetailPrice = async function(req, res, next) {
    try {
        var productId = normalizeIdParam(req?.params?.id);
        if (!productId) {
            if (shouldRespondJson(req)) return res.status(400).json({ success: false, message: 'Mã hàng không hợp lệ.' });
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

exports.upsertGiaBanHangHoaPrice = async function(req, res, next) {
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
            return res.status(400).json({ success: false, message: error.message || 'Lưu giá thất bại.' });
        }
        next(error);
    }
};

exports.updateCTBangGiaPrice = async function(req, res, next) {
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
                return res.status(400).json({ success: false, message: 'Thiếu hoặc sai mã bảng giá / hàng hóa.' });
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

exports.addBangGia = async function(req, res, next) {
    try {
        var body = req.body || {};
        var ten = String(body.ten_bang_gia || '').trim();
        if (!ten) {
            if (shouldRespondJson(req)) {
                return res.status(400).json({ success: false, message: 'Vui lòng nhập tên bảng giá.' });
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
                message: 'Đã tạo bảng giá.',
                id: String(created._id),
                ma_bang_gia: created.ma_bang_gia
            });
        }
        res.redirect('/hang-hoa/thiet-lap-gia?success=created_bang_gia');
    } catch (error) {
        next(error);
    }
};

// ─── EXCEL EXPORT ─────────────────────────────────────────────────────────────
// Supported column keys and their definitions
var HANG_HOA_COLUMNS = {
    loai_hang:       { header: 'Loại hàng',           width: 16 },
    ma_hang:         { header: 'Mã hàng',              width: 16 },
    ten_hang:        { header: 'Tên hàng',             width: 30 },
    thuong_hieu:     { header: 'Thương hiệu',          width: 18 },
    nhom_hang:       { header: 'Nhóm hàng',            width: 20 },
    hinh_anh:        { header: 'Hình ảnh',             width: 20 },
    dang_kinh_doanh: { header: 'Đang kinh doanh',      width: 16 },
    ban_truc_tiep:   { header: 'Được bán trực tiếp',   width: 18 },
    gia_von_trung_binh: { header: 'Giá vốn trung bình', width: 18, numeric: true },
    gia_ban_trung_binh: { header: 'Giá bán trung bình', width: 18 },
    ton_kho:         { header: 'Tồn kho',              width: 12, numeric: true },
    kh_dat:          { header: 'KH đặt',               width: 12, numeric: true },
    du_kien_het:     { header: 'Dự kiến hết hàng',     width: 18 },
    ton_nho_nhat:    { header: 'Tồn nhỏ nhất',         width: 14, numeric: true },
    ton_lon_nhat:    { header: 'Tồn lớn nhất',         width: 14, numeric: true },
    dvt:             { header: 'ĐVT',                  width: 10 },
    ma_dvt_co_ban:   { header: 'Mã ĐVT cơ bản',        width: 14 },
    quy_doi:         { header: 'Quy đổi',              width: 12, numeric: true },
    gia_nhap_cuoi:   { header: 'Giá nhập cuối',        width: 16, numeric: true }
};

exports.exportExcel = async function(req, res, next) {
    try {
        var ExcelJS = require('exceljs');

        // --- 1. Validate selected columns ---
        var rawCols = req.body.columns;
        if (!rawCols) rawCols = [];
        if (!Array.isArray(rawCols)) rawCols = [rawCols];
        var selectedKeys = rawCols
            .map(function(k) { return String(k || '').trim(); })
            .filter(function(k) { return !!HANG_HOA_COLUMNS[k]; });

        if (selectedKeys.length === 0) {
            return res.status(400).json({ success: false, message: 'Vui lòng chọn ít nhất 1 cột để xuất.' });
        }

        // --- 2. Build product query from current filters (matching index behavior) ---
        var filter = normalizeFilterQuery(req.body);
        var dateRange = getDateRange(filter);
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
        if (dateRange.start || dateRange.end) {
            productQuery.created_at = {};
            if (dateRange.start) productQuery.created_at.$gte = dateRange.start;
            if (dateRange.end) productQuery.created_at.$lte = dateRange.end;
        }

        // --- 3. Query HangHoa with all related models ---
        var needStock = selectedKeys.indexOf('ton_kho') >= 0 || selectedKeys.indexOf('kh_dat') >= 0 || selectedKeys.indexOf('du_kien_het') >= 0;

        var products = await HangHoa.find(productQuery)
            .populate({ path: 'nhom_hang_id', select: 'ten_nhom_hang ma_nhom_hang' })
            .populate({ path: 'don_vi_tinh_id', select: 'ten_don_vi ma_don_vi' })
            .populate({ path: 'thuong_hieu_id', select: 'ten_thuong_hieu' })
            .populate({ path: 'nha_cung_cap_id', select: 'ten_ncc' })
            .sort({ created_at: -1, ma_hang: 1 })
            .lean();

        var inventoryMap = {};
        if (needStock && products.length > 0) {
            var productIds = products.map(function(p) { return p._id; });
            var inventoryRows = await TonKho.aggregate([
                { $match: { hang_hoa_id: { $in: productIds } } },
                { $group: { _id: '$hang_hoa_id', total: { $sum: { $ifNull: ['$so_luong', 0] } } } }
            ]);
            inventoryRows.forEach(function(row) {
                inventoryMap[String(row._id)] = Number(row.total || 0);
            });
        }

        // Apply stock range filter if needed
        var stockRange = makeRangeFilter(filter.stockFrom, filter.stockTo);
        if (stockRange && needStock) {
            products = products.filter(function(item) {
                var qty = Number(inventoryMap[String(item._id)] || 0);
                if (Object.prototype.hasOwnProperty.call(stockRange, '$gte') && qty < stockRange.$gte) return false;
                if (Object.prototype.hasOwnProperty.call(stockRange, '$lte') && qty > stockRange.$lte) return false;
                return true;
            });
        }

        var exportProductIds = products.map(function(item) { return item._id; });
        var exportPriceMaps = await buildProductListPriceMaps(exportProductIds);
        products.forEach(function(item) {
            item.gia_ban_hien_thi = Number(item.gia_co_dinh || 0);
            applyProductListPriceFields(item, exportPriceMaps);
        });

        // --- 4. Resolve selected Price Books ---
        var bangGiaIds = normalizeBangGiaIdsFromQuery(req.body);
        var selectedBangGias = [];
        var ctMap = {}; // product_id -> bang_gia_id -> price

        if (bangGiaIds.length > 0 && products.length > 0) {
            selectedBangGias = await BangGia.find({ _id: { $in: bangGiaIds } }).lean();
            // Sort by request order
            selectedBangGias.sort(function(a, b) {
                return bangGiaIds.indexOf(String(a._id)) - bangGiaIds.indexOf(String(b._id));
            });

            var allProductIds = products.map(function(p) { return p._id; });
            var ctRows = await CTBangGia.find({
                bang_gia_id: { $in: bangGiaIds },
                hang_hoa_id: { $in: allProductIds }
            }).lean();

            ctRows.forEach(function(row) {
                var pid = String(row.hang_hoa_id);
                var bid = String(row.bang_gia_id);
                if (!ctMap[pid]) ctMap[pid] = {};
                ctMap[pid][bid] = Number(row.gia_ban || 0);
            });
        }

        // --- 5. Build workbook ---
        var workbook = new ExcelJS.Workbook();
        var worksheet = workbook.addWorksheet('Danh sách hàng hóa');

        // Define columns
        var excelColumns = selectedKeys.map(function(key) {
            var def = HANG_HOA_COLUMNS[key];
            return { header: def.header, key: key, width: def.width };
        });

        // Add Price Book columns
        selectedBangGias.forEach(function(bg) {
            var key = 'bg_' + bg._id;
            excelColumns.push({
                header: bg.ten_bang_gia,
                key: key,
                width: 18
            });
        });

        worksheet.columns = excelColumns;

        // Header styling
        worksheet.getRow(1).eachCell(function(cell) {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD6E4F7' } };
            cell.font = { bold: true, size: 11 };
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
            cell.border = {
                bottom: { style: 'thin', color: { argb: 'FF9DC3E6' } }
            };
        });
        worksheet.getRow(1).height = 20;
        worksheet.autoFilter = { from: 'A1', to: String.fromCharCode(64 + excelColumns.length) + '1' };
        worksheet.views = [{ state: 'frozen', ySplit: 1 }];

        // --- 6. Add data rows ---
        products.forEach(function(item) {
            var tonKho = needStock ? Number(inventoryMap[String(item._id)] || 0) : 0;
            var rowData = {};

            selectedKeys.forEach(function(key) {
                switch (key) {
                    case 'loai_hang':
                        rowData[key] = item.quan_ly_theo_lo ? 'Quản lý theo lô' : 'Hàng hóa thường';
                        break;
                    case 'ma_hang':
                        rowData[key] = item.ma_hang || '';
                        break;
                    case 'ten_hang':
                        rowData[key] = item.ten_hang || '';
                        break;
                    case 'thuong_hieu':
                        rowData[key] = (item.thuong_hieu_id && item.thuong_hieu_id.ten_thuong_hieu) ? item.thuong_hieu_id.ten_thuong_hieu : '';
                        break;
                    case 'nhom_hang':
                        rowData[key] = (item.nhom_hang_id && item.nhom_hang_id.ten_nhom_hang) ? item.nhom_hang_id.ten_nhom_hang : '';
                        break;
                    case 'hinh_anh':
                        rowData[key] = item.anh_san_pham || '';
                        break;
                    case 'dang_kinh_doanh':
                        rowData[key] = item.trang_thai === 'active' ? 'Có' : 'Không';
                        break;
                    case 'ban_truc_tiep':
                        rowData[key] = item.ban_truc_tiep ? 'Có' : 'Không';
                        break;
                    case 'gia_von_trung_binh':
                        rowData[key] = Number(item.gia_von_trung_binh_hien_thi != null ? item.gia_von_trung_binh_hien_thi : (item.gia_von || 0));
                        break;
                    case 'gia_ban_trung_binh':
                        rowData[key] = item.gia_ban_trung_binh_hien_thi == null
                            ? '---'
                            : Number(item.gia_ban_trung_binh_hien_thi || 0);
                        break;
                    case 'ton_kho':
                        rowData[key] = tonKho;
                        break;
                    case 'kh_dat':
                        rowData[key] = 0;
                        break;
                    case 'du_kien_het':
                        rowData[key] = '';
                        break;
                    case 'ton_nho_nhat':
                        rowData[key] = Number(item.dinh_muc_toi_thieu || 0);
                        break;
                    case 'ton_lon_nhat':
                        rowData[key] = 0;
                        break;
                    case 'dvt':
                        rowData[key] = (item.don_vi_tinh_id && item.don_vi_tinh_id.ten_don_vi) ? item.don_vi_tinh_id.ten_don_vi : '';
                        break;
                    case 'ma_dvt_co_ban':
                        rowData[key] = (item.don_vi_tinh_id && item.don_vi_tinh_id.ma_don_vi) ? item.don_vi_tinh_id.ma_don_vi : '';
                        break;
                    case 'quy_doi':
                        rowData[key] = 1;
                        break;
                    case 'gia_nhap_cuoi':
                        rowData[key] = Number(item.gia_nhap_cuoi || 0);
                        break;
                    default:
                        rowData[key] = '';
                }
            });

            // Map Price Books
            var pid = String(item._id);
            selectedBangGias.forEach(function(bg) {
                var bid = String(bg._id);
                var key = 'bg_' + bid;
                rowData[key] = (ctMap[pid] && ctMap[pid][bid]) ? ctMap[pid][bid] : 0;
            });

            var row = worksheet.addRow(rowData);

            // Numeric formatting
            excelColumns.forEach(function(col, colIndex) {
                var key = col.key;
                if ((HANG_HOA_COLUMNS[key] && HANG_HOA_COLUMNS[key].numeric) || key.indexOf('bg_') === 0) {
                    row.getCell(colIndex + 1).numFmt = '#,##0';
                }
            });
        });

        // --- 7. Stream response ---
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="danh-sach-hang-hoa.xlsx"');
        await workbook.xlsx.write(res);
        res.end();
    } catch (error) {
        next(error);
    }
};

/** Re-export — nguồn giá bán mặc định Phase 0 (xem services/salePrice.service.js). */
exports.resolveSalePrice = resolveSalePrice;
