function formatGenderLabel(value) {
    var gender = String(value || '').trim().toLowerCase();
    if (gender === 'nam' || gender === 'male') return 'Nam';
    if (gender === 'nu' || gender === 'female') return 'Nữ';
    if (gender === 'khac' || gender === 'other') return 'Khác';
    return '---';
}

function formatCustomerStatusLabel(value) {
    return value === 'inactive' ? 'Ngừng hoạt động' : (value === 'active' ? 'Đang hoạt động' : '---');
}

function formatDetailText(value) {
    var text = value === null || value === undefined ? '' : String(value).trim();
    return text || '---';
}

function getCreatorName(customer) {
    if (!customer) return '---';
    var creator = customer.nguoi_tao_id;
    if (creator && typeof creator === 'object') {
        return creator.ho_ten || creator.email || creator.username || '---';
    }
    return '---';
}
function normalizeCustomerPayload(body) {
    body = body || {};
    var tongNoRaw = Number(body.tong_no || 0);
    var tongBanRaw = Number(body.tong_ban || 0);
    var tongNo = Number.isFinite(tongNoRaw) ? tongNoRaw : 0;
    var tongBan = Number.isFinite(tongBanRaw) ? tongBanRaw : 0;

    var loaiKhachHang = body.loai_khach_hang === 'cong_ty' ? 'cong_ty' : 'ca_nhan';
    var tenCaNhan = String(body.ten_ca_nhan || '').trim();
    var tenCongTy = String(body.ten_cong_ty || '').trim();
    var tenKhachHang = String(body.ten_khach_hang || '').trim();

    if (!tenKhachHang) {
        tenKhachHang = loaiKhachHang === 'cong_ty' ? tenCongTy : tenCaNhan;
    }
    if (loaiKhachHang === 'ca_nhan' && tenKhachHang && !tenCaNhan) {
        tenCaNhan = tenKhachHang;
    }
    if (loaiKhachHang === 'cong_ty' && tenCongTy && !tenKhachHang) {
        tenKhachHang = tenCongTy;
    }

    var parsedNgaySinh = body.ngay_sinh ? new Date(body.ngay_sinh) : null;
    var hasTongNo = body.tong_no !== undefined && String(body.tong_no).trim() !== '';
    var hasTongBan = body.tong_ban !== undefined && String(body.tong_ban).trim() !== '';

    return {
        ma_khach_hang: String(body.ma_khach_hang || '').trim(),
        ten_khach_hang: tenKhachHang,
        ten_ca_nhan: tenCaNhan,
        mst: String(body.mst || '').trim(),
        ngay_sinh: parsedNgaySinh && !isNaN(parsedNgaySinh.getTime()) ? parsedNgaySinh : null,
        ten_cong_ty: tenCongTy,
        ma_so_thue: String(body.ma_so_thue || '').trim(),
        nguoi_dai_dien: String(body.nguoi_dai_dien || '').trim(),
        chuc_vu_nguoi_dai_dien: String(body.chuc_vu_nguoi_dai_dien || '').trim(),
        sdt: String(body.sdt || '').trim(),
        sdt2: String(body.sdt2 || '').trim(),
        email: String(body.email || '').trim(),
        facebook: String(body.facebook || '').trim(),
        ngan_hang: String(body.ngan_hang || '').trim(),
        stk_ngan_hang: String(body.stk_ngan_hang || '').trim(),
        chu_tai_khoan: String(body.chu_tai_khoan || '').trim(),
        nhom_khach_hang_id: body.nhom_khach_hang_id ? String(body.nhom_khach_hang_id).trim() : null,
        gioi_tinh: String(body.gioi_tinh || '').trim(),
        loai_khach_hang: loaiKhachHang,
        tong_no: hasTongNo ? (tongNo < 0 ? 0 : tongNo) : undefined,
        tong_ban: hasTongBan ? (tongBan < 0 ? 0 : tongBan) : undefined,
        khu_vuc_giao_hang: String(body.khu_vuc_giao_hang || '').trim(),
        ghi_chu: String(body.ghi_chu || '').trim(),
        trang_thai: body.trang_thai === 'inactive' ? 'inactive' : 'active'
    };
}

function finalizeCustomerPayload(payload, existing) {
    if (existing) {
        if (payload.tong_no === undefined) payload.tong_no = Number(existing.tong_no || 0);
        if (payload.tong_ban === undefined) payload.tong_ban = Number(existing.tong_ban || 0);
    } else {
        if (payload.tong_no === undefined) payload.tong_no = 0;
        if (payload.tong_ban === undefined) payload.tong_ban = 0;
    }
    return payload;
}

function phoneDigits(value) {
    return String(value || '').replace(/\./g, '').replace(/\s+/g, '');
}

function validateCustomerPayload(payload) {
    if (!payload.ten_khach_hang) return 'missing_name';
    var primaryPhone = phoneDigits(payload.sdt);
    if (!primaryPhone) return 'missing_phone';
    if (!/^0\d{9}$/.test(primaryPhone)) return 'invalid_phone';
    if (payload.loai_khach_hang === 'ca_nhan') {
        if (!payload.mst) return 'missing_mst';
        if (!/^\d{10,13}$/.test(payload.mst)) return 'invalid_mst';
    }
    return '';
}

module.exports = {
    normalizeCustomerPayload,
    finalizeCustomerPayload,
    phoneDigits,
    validateCustomerPayload,
    formatGenderLabel,
    formatCustomerStatusLabel,
    formatDetailText,
    getCreatorName
};
