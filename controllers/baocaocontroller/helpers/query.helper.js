function pickQueryParam(value) {
    if (value == null || value === '') return '';
    if (Array.isArray(value)) {
        const parts = value
            .map(item => String(item ?? '').trim())
            .filter(Boolean);
        return parts.length ? parts[parts.length - 1] : '';
    }
    return String(value).trim();
}


function normalizeReport58Query(query = {}) {
    return {
        ...query,
        mau: pickQueryParam(query.mau),
        view: pickQueryParam(query.view),
        from: pickQueryParam(query.from),
        to: pickQueryParam(query.to),
        phieu_id: pickQueryParam(query.phieu_id),
        phieu_nhap_id: pickQueryParam(query.phieu_nhap_id),
        xuat_ref: pickQueryParam(query.xuat_ref),
        hang_hoa_id: pickQueryParam(query.hang_hoa_id),
        kho_id: pickQueryParam(query.kho_id),
        so_quy_id: pickQueryParam(query.so_quy_id),
        year: pickQueryParam(query.year),
        don_vi_tinh: pickQueryParam(query.don_vi_tinh)
    };
}

module.exports = {
    pickQueryParam,
    normalizeReport58Query
};
