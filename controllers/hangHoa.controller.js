var mongoose = require('mongoose');
var querystring = require('querystring');
var { HangHoa, NhomHang, DonViTinh, NhaCungCap, TonKho, Kho, BangGia, CTBangGia, CuaHang, LoHang, TonKhoLo, LichSuKho, ThuocTinhHang, GiaTriThuocTinh, HangHoaThuocTinh } = require('../models/kiot.model');

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

async function loadProductGroups() {
    return await NhomHang.find({}).sort({ ten_nhom_hang: 1 }).lean();
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

async function loadProductDetailById(productId) {
    if (!mongoose.Types.ObjectId.isValid(productId)) return null;
    var item = await HangHoa.findById(productId).lean();
    if (!item) return null;

    var groups = await loadProductGroups();
    var suppliers = await NhaCungCap.find({}).sort({ ten_ncc: 1 }).lean();
    var units = await loadUnitOptions();
    var warehouses = await Kho.find({}).sort({ ten_kho: 1, ma_kho: 1 }).lean();
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
    var warehouseMap = warehouses.reduce(function(map, warehouse) {
        map[String(warehouse._id)] = warehouse.ten_kho || warehouse.ma_kho || '---';
        return map;
    }, {});

    var inventoryRows = await TonKho.aggregate([
        { $match: { hang_hoa_id: new mongoose.Types.ObjectId(productId) } },
        { $group: { _id: '$hang_hoa_id', total: { $sum: { $ifNull: ['$so_luong', 0] } } } }
    ]);
    item.ton_kho = inventoryRows[0] ? Number(inventoryRows[0].total || 0) : 0;
    item.nhom_hang_ten = groupMap[String(item.nhom_hang_id || '')] || '---';
    item.nha_cung_cap_ten = supplierMap[String(item.nha_cung_cap_id || '')] || '---';
    item.don_vi_tinh_ten = unitMap[String(item.don_vi_tinh_id || '')] || '---';
    item.gia_ban_hien_thi = Number(item.gia_co_dinh || 0);

    var selectedProductInventory = await TonKho.find({ hang_hoa_id: item._id }).sort({ updated_at: -1 }).lean();
    selectedProductInventory = selectedProductInventory.map(function(row) {
        row.kho_ten = warehouseMap[String(row.kho_id || '')] || '---';
        return row;
    });

    var selectedProductHistories = await LichSuKho.find({ hang_hoa_id: item._id })
        .populate({ path: 'lo_hang_id', select: 'ma_lo ten_lo han_su_dung' })
        .sort({ ngay: -1, created_at: -1 })
        .lean();
    selectedProductHistories = selectedProductHistories.map(function(row) {
        row.kho_ten = warehouseMap[String(row.kho_id || '')] || '---';
        return row;
    });

    var selectedProductLots = item.quan_ly_theo_lo
        ? await TonKhoLo.find({ hang_hoa_id: item._id })
            .populate({ path: 'lo_hang_id', select: 'ma_lo ten_lo han_su_dung ngay_nhap so_luong_ban_dau so_luong_con_lai trang_thai' })
            .sort({ updated_at: -1, created_at: -1 })
            .lean()
        : [];
    selectedProductLots = selectedProductLots.map(function(row) {
        row.kho_ten = warehouseMap[String(row.kho_id || '')] || '---';
        return row;
    });

    return {
        item: item,
        selectedProductInventory: selectedProductInventory,
        selectedProductHistories: selectedProductHistories,
        selectedProductLots: selectedProductLots,
        formatDate: formatDate
    };
}

exports.apiProductDetail = async function(req, res, next) {
    try {
        var ctx = await loadProductDetailById(req.params.id);
        if (!ctx) {
            return res.status(404).type('html').send('<div class="kv-detail-panel product-detail kv-detail-error"><p>Không tìm thấy hàng hóa.</p></div>');
        }
        res.render('hang-hoa/_detail-panel', ctx);
    } catch (err) {
        next(err);
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

        var groups = await loadProductGroups();
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

        products = products.map(function(item) {
            item.ton_kho = Number(inventoryMap[String(item._id)] || 0);
            item.nhom_hang_ten = groupMap[String(item.nhom_hang_id || '')] || '---';
            item.nha_cung_cap_ten = supplierMap[String(item.nha_cung_cap_id || '')] || '---';
            item.don_vi_tinh_ten = unitMap[String(item.don_vi_tinh_id || '')] || '---';
            item.gia_ban_hien_thi = Number(item.gia_co_dinh || 0);
            return item;
        });
        var filterQueryString = buildFilterQueryString(filter);

        var bangGiaList = await BangGia.find({ trang_thai: 'active' }).sort({ ten_bang_gia: 1 }).lean();
        var storeId = await resolveStoreId(req);
        await ensureDefaultAttributes(storeId);
        var attrQuery = storeId && mongoose.Types.ObjectId.isValid(storeId) ? { cua_hang_id: storeId, trang_thai: 'active' } : { trang_thai: 'active' };
        var attributes = await ThuocTinhHang.find(attrQuery).sort({ ten_thuoc_tinh: 1 }).lean();
        if (attributes.length === 0 && attrQuery.cua_hang_id) attributes = await ThuocTinhHang.find({ trang_thai: 'active' }).sort({ ten_thuoc_tinh: 1 }).lean();
        var attrIds = attributes.map(function(a) { return a._id; });
        var attributeValues = attrIds.length
            ? await GiaTriThuocTinh.find({ thuoc_tinh_id: { $in: attrIds }, trang_thai: 'active' }).sort({ thu_tu: 1, ten_gia_tri: 1 }).lean()
            : [];
        var productAttributeRows = productIds.length
            ? await HangHoaThuocTinh.find({ hang_hoa_id: { $in: productIds } }).lean()
            : [];
        var productAttributeIds = {};
        productAttributeRows.forEach(function(row) {
            var pid = String(row.hang_hoa_id);
            if (!productAttributeIds[pid]) productAttributeIds[pid] = [];
            productAttributeIds[pid].push(String(row.gia_tri_id));
        });

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
            attributes: attributes,
            attributeValues: attributeValues,
            productAttributeIds: productAttributeIds,
            filter: filter,
            formatDate: formatDate,
            filterQueryString: filterQueryString,
            formMode: requestQuery.mode === 'create' ? 'create' : ''
        });
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
        await saveProductAttributeValues(created._id, normalizeSelectedAttributeValues(req.body));
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
        await saveProductAttributeValues(productId, normalizeSelectedAttributeValues(req.body));
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

        var doc = {
            ma_nhom_hang: maNhom,
            ten_nhom_hang: tenNhom,
            mo_ta: moTa,
            trang_thai: 'active'
        };
        var storeId = await resolveStoreId(req);
        if (storeId && mongoose.Types.ObjectId.isValid(storeId)) doc.cua_hang_id = storeId;

        var created = await NhomHang.create(doc);

        if (shouldRespondJson(req)) {
            return res.json({
                success: true,
                message: 'Đã thêm nhóm hàng.',
                data: created,
                selectedId: String(created._id),
                groups: await loadProductGroups()
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
                groups: await loadProductGroups()
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

        var total = products.length;
        var totalPages = Math.max(1, Math.ceil(total / filter.limit));
        if (filter.page > totalPages) filter.page = totalPages;
        var start = (filter.page - 1) * filter.limit;
        var pageItems = products.slice(start, start + filter.limit);

        var groups = await loadProductGroups();
        var groupMap = groups.reduce(function(map, group) {
            map[String(group._id)] = group.ten_nhom_hang || '';
            return map;
        }, {});

        pageItems = pageItems.map(function(item) {
            item.ton_kho = Number(inventoryMap[String(item._id)] || 0);
            item.nhom_hang_ten = groupMap[String(item.nhom_hang_id || '')] || '---';
            return item;
        });

        var bangGiaList = await BangGia.find({}).sort({ ten_bang_gia: 1 }).lean();
        var selectedBangGiaOrdered = filter.bangGiaIds.map(function(id) {
            return bangGiaList.find(function(b) { return String(b._id) === id; });
        }).filter(Boolean);

        var ctMapByProduct = {};
        if (selectedBangGiaOrdered.length > 0 && pageItems.length > 0) {
            var pageIds = pageItems.map(function(p) { return p._id; });
            var bangIds = selectedBangGiaOrdered.map(function(b) { return b._id; });
            var ctRows = await CTBangGia.find({
                bang_gia_id: { $in: bangIds },
                hang_hoa_id: { $in: pageIds }
            }).lean();
            ctRows.forEach(function(row) {
                var hid = String(row.hang_hoa_id);
                var bid = String(row.bang_gia_id);
                if (!ctMapByProduct[hid]) ctMapByProduct[hid] = {};
                ctMapByProduct[hid][bid] = {
                    gia_ban: Number(row.gia_ban || 0),
                    _id: row._id
                };
            });
        }

        pageItems = pageItems.map(function(item) {
            item.ctBangGiaByBangId = ctMapByProduct[String(item._id)] || {};
            return item;
        });

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
            products: pageItems,
            groups: groups,
            bangGiaList: bangGiaList,
            selectedBangGiaOrdered: selectedBangGiaOrdered,
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
    gia_ban:         { header: 'Giá bán',              width: 14, numeric: true },
    gia_von:         { header: 'Giá vốn',              width: 14, numeric: true },
    ton_kho:         { header: 'Tồn kho',              width: 12, numeric: true },
    kh_dat:          { header: 'KH đặt',               width: 12, numeric: true },
    du_kien_het:     { header: 'Dự kiến hết hàng',     width: 18 },
    ton_nho_nhat:    { header: 'Tồn nhỏ nhất',         width: 14, numeric: true },
    ton_lon_nhat:    { header: 'Tồn lớn nhất',         width: 14, numeric: true },
    dvt:             { header: 'ĐVT',                  width: 10 },
    ma_dvt_co_ban:   { header: 'Mã ĐVT cơ bản',        width: 14 },
    quy_doi:         { header: 'Quy đổi',              width: 12, numeric: true },
    thuoc_tinh:      { header: 'Thuộc tính',           width: 24 },
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
                    case 'gia_ban':
                        rowData[key] = Number(item.gia_co_dinh || 0);
                        break;
                    case 'gia_von':
                        rowData[key] = Number(item.gia_von || 0);
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
                    case 'thuoc_tinh':
                        rowData[key] = item.mo_ta || '';
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


