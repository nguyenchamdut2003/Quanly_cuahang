var mongoose = require('mongoose');
var { NhaCungCap, NhomNhaCungCap, PhieuNhap, PhieuTraHangNhap, CongNoNhaCungCap, CuaHang, DiaChiNcc, DiaChiDoiTuong, LoaiDiaChiKhachHang } = require('../models/kiot.model');
var DiaChiNhaCungCap = DiaChiNcc || DiaChiDoiTuong;

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

function normalizeSupplierPayload(body) {
    body = body || {};
    var tongNo = Number(body.tong_no || 0);
    var tongMua = Number(body.tong_mua || 0);

    return {
        ma_ncc: String(body.ma_ncc || '').trim(),
        ten_ncc: String(body.ten_ncc || '').trim(),
        sdt: String(body.sdt || '').trim(),
        email: String(body.email || '').trim(),
        ten_cong_ty: String(body.ten_cong_ty || '').trim(),
        ma_so_thue: String(body.ma_so_thue || '').trim(),
        ghi_chu: String(body.ghi_chu || '').trim(),
        tong_no: Number.isFinite(tongNo) && tongNo > 0 ? tongNo : 0,
        tong_mua: Number.isFinite(tongMua) && tongMua > 0 ? tongMua : 0,
        trang_thai: body.trang_thai === 'inactive' ? 'inactive' : 'active'
    };
}

function normalizeIdParam(value) {
    return String(value || '').trim();
}

function normalizeIdList(value) {
    var source = Array.isArray(value) ? value : [value];
    return source
        .map(function(item) { return String(item || '').trim(); })
        .filter(Boolean);
}

function shouldRespondJson(req) {
    var accept = String(req?.headers?.accept || '').toLowerCase();
    var requestedWith = String(req?.headers?.['x-requested-with'] || '').toLowerCase();
    return requestedWith === 'xmlhttprequest' || accept.indexOf('application/json') >= 0;
}

async function loadSupplierGroups() {
    return await NhomNhaCungCap.find({}).sort({ ten_nhom_ncc: 1 }).lean();
}

async function makeSupplierGroupCode() {
    var groups = await NhomNhaCungCap.find({ ma_nhom_ncc: /^NNCC\d+$/ }).select('ma_nhom_ncc').lean();
    var maxNumber = 0;
    for (var group of groups) {
        var number = Number(String(group.ma_nhom_ncc || '').replace(/\D/g, ''));
        if (Number.isFinite(number) && number > maxNumber) maxNumber = number;
    }
    return 'NNCC' + String(maxNumber + 1).padStart(4, '0');
}

function respondSupplierGroupError(req, res, statusCode, message) {
    console.error('[SupplierGroup]', message);
    if (shouldRespondJson(req)) {
        return res.status(statusCode || 400).json({ success: false, message: message || 'Không thể xử lý nhóm nhà cung cấp.' });
    }
    return res.redirect('/nha-cung-cap?error=group_error');
}

async function loadAddressTypes() {
    if (!LoaiDiaChiKhachHang) return [];
    return await LoaiDiaChiKhachHang.find({ trang_thai: 'active' }).sort({ created_at: 1 }).lean();
}

function normalizeFilterQuery(query) {
    query = query || {};
    var groupId = String(query.groupId || 'all').trim() || 'all';
    var status = query.status === 'active' || query.status === 'inactive' ? query.status : 'all';
    var totalBuyFrom = String(query.totalBuyFrom || '').trim();
    var totalBuyTo = String(query.totalBuyTo || '').trim();
    var currentDebtFrom = String(query.currentDebtFrom || '').trim();
    var currentDebtTo = String(query.currentDebtTo || '').trim();
    var created = ['all', 'today', '7days', '30days', 'custom'].indexOf(query.created) >= 0 ? query.created : 'all';
    var createdFrom = String(query.createdFrom || '').trim();
    var createdTo = String(query.createdTo || '').trim();

    return {
        groupId: groupId,
        status: status,
        totalBuyFrom: totalBuyFrom,
        totalBuyTo: totalBuyTo,
        currentDebtFrom: currentDebtFrom,
        currentDebtTo: currentDebtTo,
        created: created,
        createdFrom: createdFrom,
        createdTo: createdTo
    };
}

async function resolveStoreId(req) {
    var sessionStoreId = req && req.session ? String(req.session.cua_hang_id || '').trim() : '';
    if (sessionStoreId && mongoose.Types.ObjectId.isValid(sessionStoreId)) return sessionStoreId;
    var userStoreId = req && req.user ? String(req.user.cua_hang_id || '').trim() : '';
    if (userStoreId && mongoose.Types.ObjectId.isValid(userStoreId)) return userStoreId;
    var activeStore = await CuaHang.findOne({ trang_thai: 'active' }).sort({ created_at: 1 }).lean();
    return activeStore ? String(activeStore._id) : '';
}

function mapNhapHangStatus(value) {
    if (value === 'draft') return 'Phiếu tạm';
    if (value === 'cancelled') return 'Đã hủy';
    return 'Đã nhập hàng';
}

function mapCongNoLoai(value) {
    if (value === 'thanh_toan') return 'Thanh toán';
    if (value === 'giam_no') return 'Giảm nợ';
    return 'Nhập hàng';
}

function getDateRange(filter) {
    var now = new Date();
    var start = null;
    var end = null;

    if (filter.created === 'today') {
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
        end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    }
    if (filter.created === '7days') {
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6, 0, 0, 0, 0);
        end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    }
    if (filter.created === '30days') {
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29, 0, 0, 0, 0);
        end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    }
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

function buildFilterQueryString(filter) {
    var params = [];
    if (filter.groupId !== 'all') params.push('groupId=' + encodeURIComponent(filter.groupId));
    if (filter.status !== 'all') params.push('status=' + encodeURIComponent(filter.status));
    if (filter.totalBuyFrom) params.push('totalBuyFrom=' + encodeURIComponent(filter.totalBuyFrom));
    if (filter.totalBuyTo) params.push('totalBuyTo=' + encodeURIComponent(filter.totalBuyTo));
    if (filter.currentDebtFrom) params.push('currentDebtFrom=' + encodeURIComponent(filter.currentDebtFrom));
    if (filter.currentDebtTo) params.push('currentDebtTo=' + encodeURIComponent(filter.currentDebtTo));
    if (filter.created !== 'all') params.push('created=' + encodeURIComponent(filter.created));
    if (filter.created === 'custom' && filter.createdFrom) params.push('createdFrom=' + encodeURIComponent(filter.createdFrom));
    if (filter.created === 'custom' && filter.createdTo) params.push('createdTo=' + encodeURIComponent(filter.createdTo));
    return params.join('&');
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

async function makeSupplierCode() {
    var lastSupplier = await NhaCungCap.findOne({ ma_ncc: /^NCC\d+$/ }).sort({ ma_ncc: -1 }).lean();
    var nextNumber = 1;
    if (lastSupplier && lastSupplier.ma_ncc) {
        nextNumber = Number(lastSupplier.ma_ncc.replace(/\D/g, '')) + 1;
    }
    return 'NCC' + String(nextNumber).padStart(4, '0');
}

async function makeSupplierAddressCode() {
    var addresses = await DiaChiNhaCungCap.find({ ma_dia_chi: /^DCNCC\d+$/ }).select('ma_dia_chi').lean();
    var maxNumber = 0;

    for (var address of addresses) {
        if (address.ma_dia_chi) {
            var num = Number(address.ma_dia_chi.replace(/\D/g, ''));
            if (num > maxNumber) maxNumber = num;
        }
    }

    return 'DCNCC' + String(maxNumber + 1).padStart(4, '0');
}

function normalizeSupplierAddressPayload(body) {
    body = body || {};
    return {
        ma_dia_chi: String(body.ma_dia_chi || '').trim(),
        ten_nguoi_nhan: String(body.ten_nguoi_nhan || '').trim(),
        sdt_nguoi_nhan: String(body.sdt_nguoi_nhan || '').trim(),
        so_nha: String(body.so_nha || '').trim(),
        dia_chi_day_du: String(body.dia_chi_day_du || '').trim(),
        tinh_thanh: String(body.tinh_thanh || '').trim(),
        quan_huyen: String(body.quan_huyen || '').trim(),
        phuong_xa: String(body.phuong_xa || '').trim(),
        loai_dia_chi: String(body.loai_dia_chi || '').trim(),
        ghi_chu: String(body.ghi_chu || '').trim(),
        mac_dinh: body.mac_dinh === 'true' || body.mac_dinh === true || body.mac_dinh === 'on'
    };
}

function buildSupplierReturnUrl(supplierId, returnQueryRaw) {
    var supplier = normalizeIdParam(supplierId);
    var returnQuery = String(returnQueryRaw || '').trim().replace(/^\?/, '');
    var params = returnQuery ? returnQuery.split('&').filter(Boolean) : [];
    var paramsWithoutSupplier = params.filter(function(item) {
        return item.indexOf('supplier=') !== 0;
    });
    if (supplier) paramsWithoutSupplier.push('supplier=' + encodeURIComponent(supplier));
    return '/nha-cung-cap' + (paramsWithoutSupplier.length ? '?' + paramsWithoutSupplier.join('&') : '');
}

async function seedSuppliersIfEmpty() {
    var count = await NhaCungCap.countDocuments();
    if (count > 0) return;

    await NhaCungCap.insertMany([
        { ma_ncc: 'NCC0001', ten_ncc: 'Nhà cung cấp An Phú', sdt: '0911000001', email: 'anphu@example.com', tong_no: 0, tong_mua: 5000000, trang_thai: 'active' },
        { ma_ncc: 'NCC0002', ten_ncc: 'Công ty Hoàng Gia', sdt: '0911000002', email: 'hoanggia@example.com', ten_cong_ty: 'Công ty Hoàng Gia', ma_so_thue: '0309998887', tong_no: 2400000, tong_mua: 12000000, trang_thai: 'active' },
        { ma_ncc: 'NCC0003', ten_ncc: 'Nhà cung cấp Minh Tâm', sdt: '0911000003', email: 'minhtam@example.com', tong_no: 900000, tong_mua: 3000000, trang_thai: 'inactive' }
    ]);
}

exports.index = async function(req, res, next) {
    try {
        var storeId = await resolveStoreId(req);

        var requestQuery = req?.query || {};
        var filter = normalizeFilterQuery(requestQuery);
        var dateRange = getDateRange(filter);
        var supplierQuery = {};

        if (filter.groupId !== 'all') supplierQuery.nhom_nha_cung_cap_id = filter.groupId;
        if (filter.status !== 'all') supplierQuery.trang_thai = filter.status;
        var totalBuyRange = makeRangeFilter(filter.totalBuyFrom, filter.totalBuyTo);
        if (totalBuyRange) supplierQuery.tong_mua = totalBuyRange;
        var currentDebtRange = makeRangeFilter(filter.currentDebtFrom, filter.currentDebtTo);
        if (currentDebtRange) supplierQuery.tong_no = currentDebtRange;
        if (dateRange.start || dateRange.end) {
            supplierQuery.created_at = {};
            if (dateRange.start) supplierQuery.created_at.$gte = dateRange.start;
            if (dateRange.end) supplierQuery.created_at.$lte = dateRange.end;
        }

        var supplierGroups = await loadSupplierGroups();
        var addressTypes = await loadAddressTypes();
        var suppliers = await NhaCungCap.find(supplierQuery).sort({ created_at: 1, ma_ncc: 1 }).lean();
        var selectedSupplierId = String(requestQuery.supplier || '').trim();
        var selectedSupplier = null;
        if (selectedSupplierId && mongoose.Types.ObjectId.isValid(selectedSupplierId)) {
            selectedSupplier = await NhaCungCap.findOne({ _id: selectedSupplierId }).lean();
        }
        var supplierPurchaseHistory = [];
        var supplierDebtHistory = [];
        var supplierAddresses = [];

        if (selectedSupplier) {
            supplierAddresses = await DiaChiNhaCungCap.find({ nha_cung_cap_id: selectedSupplier._id }).sort({ created_at: -1 }).lean();

            var phieuNhapQuery = {
                nha_cung_cap_id: selectedSupplier._id,
                trang_thai: { $in: ['completed', 'draft', 'cancelled'] }
            };
            var nhapRows = await PhieuNhap.find(phieuNhapQuery)
                .populate({ path: 'nguoi_tao_id', select: 'ho_ten email' })
                .populate({ path: 'kho_id', select: 'ten_kho ma_kho' })
                .sort({ ngay_nhap: -1, created_at: -1 })
                .lean();
            supplierPurchaseHistory = nhapRows.map(function(row) {
                return {
                    loai: 'nhap',
                    ma_phieu: row.ma_phieu_nhap || '--',
                    thoi_gian: row.ngay_nhap || row.created_at,
                    nguoi_tao: row?.nguoi_tao_id?.ho_ten || row?.nguoi_tao_id?.email || '--',
                    tong_cong: Number(row.can_tra_ncc || row.tong_tien || 0),
                    trang_thai: row.trang_thai || 'draft'
                };
            });

            if (PhieuTraHangNhap) {
                var phieuTraQuery = { nha_cung_cap_id: selectedSupplier._id };
                var traRows = await PhieuTraHangNhap.find(phieuTraQuery)
                    .populate({ path: 'nguoi_tao_id', select: 'ho_ten email' })
                    .sort({ ngay_tra: -1, created_at: -1 })
                    .lean();
                supplierPurchaseHistory = supplierPurchaseHistory.concat(traRows.map(function(row) {
                    return {
                        loai: 'tra',
                        ma_phieu: row.ma_phieu_tra_nhap || '--',
                        thoi_gian: row.ngay_tra || row.created_at,
                        nguoi_tao: row?.nguoi_tao_id?.ho_ten || row?.nguoi_tao_id?.email || '--',
                        tong_cong: Number(row.tong_tien_tra || 0),
                        trang_thai: row.trang_thai || 'completed'
                    };
                }));
            }
            supplierPurchaseHistory.sort(function(a, b) {
                return new Date(b.thoi_gian || 0).getTime() - new Date(a.thoi_gian || 0).getTime();
            });

            var debtQuery = { nha_cung_cap_id: selectedSupplier._id };
            var debtRows = await CongNoNhaCungCap.find(debtQuery)
                .populate({ path: 'phieu_nhap_id', select: 'ma_phieu_nhap' })
                .sort({ ngay: -1, created_at: -1 })
                .lean();
            var runningDebt = 0;
            var debtAsc = debtRows.slice().reverse();
            var mappedDebtAsc = debtAsc.map(function(row) {
                var soTien = Number(row.so_tien || 0);
                if (row.loai === 'tang_no') runningDebt += soTien;
                if (row.loai === 'giam_no' || row.loai === 'thanh_toan') runningDebt = Math.max(0, runningDebt - soTien);
                return {
                    ma_phieu: row?.phieu_nhap_id?.ma_phieu_nhap || '--',
                    thoi_gian: row.ngay || row.created_at,
                    loai: row.loai || 'tang_no',
                    gia_tri: soTien,
                    no_con_lai: runningDebt
                };
            });
            supplierDebtHistory = mappedDebtAsc.reverse();
        }

        res.render('nha-cung-cap/index', {
            title: 'Nha cung cap',
            pageTitle: 'Nha cung cap',
            activeMenu: 'nha-cung-cap',
            user: req.user,
            flash: requestQuery,
            suppliers: suppliers,
            supplierGroups: supplierGroups,
            addressTypes: addressTypes,
            selectedSupplier: selectedSupplier,
            supplierAddresses: supplierAddresses,
            supplierPurchaseHistory: supplierPurchaseHistory,
            supplierDebtHistory: supplierDebtHistory,
            formMode: requestQuery.mode === 'create' ? 'create' : '',
            formatDate: formatDate,
            filter: filter,
            filterQueryString: buildFilterQueryString(filter),
            mapNhapHangStatus: mapNhapHangStatus,
            mapCongNoLoai: mapCongNoLoai
        });
    } catch (error) {
        next(error);
    }
};

exports.add = async function(req, res, next) {
    try {
        var payload = normalizeSupplierPayload(req?.body);
        if (!payload.ten_ncc) return res.redirect('/nha-cung-cap?mode=create&error=missing_name');
        if (!payload.ma_ncc) payload.ma_ncc = await makeSupplierCode();
        var supplier = await NhaCungCap.create(payload);
        res.redirect('/nha-cung-cap?supplier=' + supplier._id + '&success=created');
    } catch (error) {
        if (error && error.code === 11000) return res.redirect('/nha-cung-cap?mode=create&error=duplicate_code');
        next(error);
    }
};

exports.update = async function(req, res, next) {
    try {
        var supplierId = normalizeIdParam(req?.params?.id);
        if (!supplierId) return res.redirect('/nha-cung-cap?error=invalid_supplier');

        var payload = normalizeSupplierPayload(req?.body);
        if (!payload.ten_ncc) return res.redirect('/nha-cung-cap?supplier=' + supplierId + '&error=missing_name');
        if (!payload.ma_ncc) delete payload.ma_ncc;
        await NhaCungCap.findByIdAndUpdate(supplierId, payload, { runValidators: true });
        res.redirect('/nha-cung-cap?supplier=' + supplierId + '&success=updated');
    } catch (error) {
        if (error && error.code === 11000) return res.redirect('/nha-cung-cap?error=duplicate_code');
        next(error);
    }
};

exports.remove = async function(req, res, next) {
    try {
        var supplierId = normalizeIdParam(req?.params?.id);
        if (!supplierId) return res.redirect('/nha-cung-cap?error=invalid_supplier');
        await NhaCungCap.findByIdAndDelete(supplierId);
        res.redirect('/nha-cung-cap?success=deleted');
    } catch (error) {
        next(error);
    }
};

exports.removeSelected = async function(req, res, next) {
    try {
        var ids = normalizeIdList(req?.body?.ids);
        if (ids.length === 0) return res.redirect('/nha-cung-cap?error=no_selection');
        await NhaCungCap.deleteMany({ _id: { $in: ids } });
        res.redirect('/nha-cung-cap?success=deleted');
    } catch (error) {
        next(error);
    }
};

exports.addGroup = async function(req, res, next) {
    try {
        var tenNhom = String(req?.body?.ten_nhom_ncc || '').trim();
        var moTa = String(req?.body?.mo_ta || '').trim();
        var maNhom = String(req?.body?.ma_nhom_ncc || '').trim().toUpperCase();
        if (!tenNhom) return respondSupplierGroupError(req, res, 400, 'Vui lòng nhập tên nhóm nhà cung cấp.');
        if (!maNhom) maNhom = await makeSupplierGroupCode();

        var doc = {
            ma_nhom_ncc: maNhom,
            ten_nhom_ncc: tenNhom,
            mo_ta: moTa,
            trang_thai: 'active'
        };
        var storeId = await resolveStoreId(req);
        if (storeId && mongoose.Types.ObjectId.isValid(storeId)) doc.cua_hang_id = storeId;

        var created = await NhomNhaCungCap.create(doc);

        if (shouldRespondJson(req)) {
            return res.json({
                success: true,
                message: 'Đã thêm nhóm nhà cung cấp.',
                data: created,
                selectedId: String(created._id),
                supplierGroups: await loadSupplierGroups()
            });
        }

        res.redirect('/nha-cung-cap?success=created');
    } catch (error) {
        console.error('[SupplierGroup] add failed:', error && error.message ? error.message : error);
        if (error && error.code === 11000) {
            return respondSupplierGroupError(req, res, 409, 'Mã nhóm nhà cung cấp đã tồn tại');
        }
        if (error && error.name === 'ValidationError') {
            return respondSupplierGroupError(req, res, 400, error.message || 'Dữ liệu nhóm nhà cung cấp không hợp lệ.');
        }
        if (shouldRespondJson(req)) {
            return res.status(500).json({ success: false, message: error && error.message ? error.message : 'Có lỗi khi xử lý nhóm nhà cung cấp.' });
        }
        next(error);
    }
};

exports.updateGroup = async function(req, res, next) {
    try {
        var groupId = normalizeIdParam(req?.params?.groupId);
        if (!groupId || !mongoose.Types.ObjectId.isValid(groupId)) {
            return respondSupplierGroupError(req, res, 400, 'Nhóm nhà cung cấp không hợp lệ.');
        }

        var tenNhom = String(req?.body?.ten_nhom_ncc || '').trim();
        var moTa = String(req?.body?.mo_ta || '').trim();
        if (!tenNhom) return respondSupplierGroupError(req, res, 400, 'Vui lòng nhập tên nhóm nhà cung cấp.');

        var updated = await NhomNhaCungCap.findByIdAndUpdate(groupId, { ten_nhom_ncc: tenNhom, mo_ta: moTa }, { runValidators: true, new: true });
        if (!updated) return respondSupplierGroupError(req, res, 404, 'Không tìm thấy nhóm nhà cung cấp.');

        if (shouldRespondJson(req)) {
            return res.json({
                success: true,
                message: 'Đã cập nhật nhóm nhà cung cấp.',
                data: updated,
                selectedId: groupId,
                supplierGroups: await loadSupplierGroups()
            });
        }

        res.redirect('/nha-cung-cap?success=updated');
    } catch (error) {
        console.error('[SupplierGroup] update failed:', error && error.message ? error.message : error);
        if (error && error.name === 'ValidationError') {
            return respondSupplierGroupError(req, res, 400, error.message || 'Dữ liệu nhóm nhà cung cấp không hợp lệ.');
        }
        if (shouldRespondJson(req)) {
            return res.status(500).json({ success: false, message: error && error.message ? error.message : 'Có lỗi khi xử lý nhóm nhà cung cấp.' });
        }
        next(error);
    }
};

exports.removeGroup = async function(req, res, next) {
    try {
        var groupId = normalizeIdParam(req?.params?.groupId);
        if (!groupId || !mongoose.Types.ObjectId.isValid(groupId)) {
            return respondSupplierGroupError(req, res, 400, 'Nhóm nhà cung cấp không hợp lệ.');
        }

        await NhaCungCap.updateMany(
            { nhom_nha_cung_cap_id: groupId },
            { $unset: { nhom_nha_cung_cap_id: 1 } }
        );
        var deleted = await NhomNhaCungCap.findByIdAndDelete(groupId);
        if (!deleted) return respondSupplierGroupError(req, res, 404, 'Không tìm thấy nhóm nhà cung cấp.');

        if (shouldRespondJson(req)) {
            return res.json({
                success: true,
                message: 'Đã xóa nhóm nhà cung cấp.',
                supplierGroups: await loadSupplierGroups()
            });
        }

        res.redirect('/nha-cung-cap?success=deleted');
    } catch (error) {
        console.error('[SupplierGroup] delete failed:', error && error.message ? error.message : error);
        if (shouldRespondJson(req)) {
            return res.status(500).json({ success: false, message: error && error.message ? error.message : 'Có lỗi khi xử lý nhóm nhà cung cấp.' });
        }
        next(error);
    }
};

exports.listAddresses = async function(req, res, next) {
    try {
        var supplierId = normalizeIdParam(req?.params?.id);
        if (!supplierId || !mongoose.Types.ObjectId.isValid(supplierId)) {
            return res.status(400).json({ success: false, message: 'invalid_supplier' });
        }

        var addresses = await DiaChiNhaCungCap.find({ nha_cung_cap_id: supplierId }).sort({ created_at: -1 }).lean();
        res.json({ success: true, data: addresses });
    } catch (error) {
        next(error);
    }
};

exports.addAddress = async function(req, res, next) {
    try {
        var supplierId = normalizeIdParam(req?.params?.id);
        if (!supplierId || !mongoose.Types.ObjectId.isValid(supplierId)) {
            return res.redirect('/nha-cung-cap?error=invalid_supplier');
        }

        var payload = normalizeSupplierAddressPayload(req?.body);
        if (!payload.ten_nguoi_nhan && !payload.sdt_nguoi_nhan && !payload.dia_chi_day_du) {
            return res.redirect(buildSupplierReturnUrl(supplierId, req?.body?.returnQuery) + '&error=missing_address_data');
        }

        if (!payload.ma_dia_chi) payload.ma_dia_chi = await makeSupplierAddressCode();
        if (!payload.loai_dia_chi) payload.loai_dia_chi = 'khac';
        payload.nha_cung_cap_id = supplierId;

        if (payload.mac_dinh) {
            await DiaChiNhaCungCap.updateMany({ nha_cung_cap_id: supplierId }, { $set: { mac_dinh: false } });
        }

        await DiaChiNhaCungCap.create(payload);
        res.redirect(buildSupplierReturnUrl(supplierId, req?.body?.returnQuery) + '&success=created_address');
    } catch (error) {
        if (error && error.code === 11000) {
            return res.redirect('/nha-cung-cap?supplier=' + normalizeIdParam(req?.params?.id) + '&error=duplicate_address_code');
        }
        next(error);
    }
};

exports.updateAddress = async function(req, res, next) {
    try {
        var addressId = normalizeIdParam(req?.params?.addressId);
        if (!addressId || !mongoose.Types.ObjectId.isValid(addressId)) {
            return res.redirect('/nha-cung-cap?error=invalid_address');
        }

        var existingAddress = await DiaChiNhaCungCap.findById(addressId).lean();
        if (!existingAddress) return res.redirect('/nha-cung-cap?error=invalid_address');
        var supplierId = String(existingAddress.nha_cung_cap_id || '');

        var payload = normalizeSupplierAddressPayload(req?.body);
        if (!payload.ten_nguoi_nhan && !payload.sdt_nguoi_nhan && !payload.dia_chi_day_du) {
            return res.redirect(buildSupplierReturnUrl(supplierId, req?.body?.returnQuery) + '&error=missing_address_data');
        }

        if (!payload.ma_dia_chi) delete payload.ma_dia_chi;
        if (!payload.loai_dia_chi) payload.loai_dia_chi = 'khac';

        if (payload.mac_dinh) {
            await DiaChiNhaCungCap.updateMany(
                { nha_cung_cap_id: supplierId, _id: { $ne: addressId } },
                { $set: { mac_dinh: false } }
            );
        }

        await DiaChiNhaCungCap.findByIdAndUpdate(addressId, payload, { runValidators: true });
        res.redirect(buildSupplierReturnUrl(supplierId, req?.body?.returnQuery) + '&success=updated_address');
    } catch (error) {
        if (error && error.code === 11000) {
            return res.redirect('/nha-cung-cap?error=duplicate_address_code');
        }
        next(error);
    }
};

exports.removeAddress = async function(req, res, next) {
    try {
        var addressId = normalizeIdParam(req?.params?.addressId);
        if (!addressId || !mongoose.Types.ObjectId.isValid(addressId)) {
            return res.redirect('/nha-cung-cap?error=invalid_address');
        }

        var existingAddress = await DiaChiNhaCungCap.findById(addressId).lean();
        if (!existingAddress) return res.redirect('/nha-cung-cap?error=invalid_address');
        var supplierId = String(existingAddress.nha_cung_cap_id || '');

        await DiaChiNhaCungCap.findByIdAndDelete(addressId);
        res.redirect(buildSupplierReturnUrl(supplierId, req?.body?.returnQuery) + '&success=deleted_address');
    } catch (error) {
        next(error);
    }
};
