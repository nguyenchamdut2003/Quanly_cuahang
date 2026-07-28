const { PhieuKiemKho, CTPhieuKiemKho, NguoiDung } = require('../../../models/kiot.model');
const { buildKiemKhoFilter } = require('../helpers/filter.helper');
const { getKiemKhoExportColumnGroupsForView } = require('./export/excelExport.service');

const PAGE_SIZE = 10;

function parsePage(query) {
    const page = Number(query && query.page);
    return Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
}

function buildKiemKhoQueryString(query, overrides) {
    const params = new URLSearchParams();
    Object.entries(query || {}).forEach(([key, value]) => {
        if (key === 'page' || key === 'page_size') return;
        if (Array.isArray(value)) {
            value.forEach(item => params.append(key, item));
        } else if (value !== undefined && value !== null && String(value) !== '') {
            params.append(key, value);
        }
    });

    const merged = Object.assign({}, overrides || {});
    if (merged.page && Number(merged.page) > 1) {
        params.set('page', String(Math.floor(Number(merged.page))));
    }
    return params.toString();
}

async function loadKiemKhoListPage(query) {
    const { filter, q, dateMode, statuses } = buildKiemKhoFilter(query);
    const pageSize = PAGE_SIZE;
    let page = parsePage(query);
    const [total, users] = await Promise.all([
        PhieuKiemKho.countDocuments(filter),
        NguoiDung.find().sort({ ho_ten: 1, username: 1 })
    ]);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    if (page > totalPages) page = totalPages;
    const skip = (page - 1) * pageSize;
    const list = await PhieuKiemKho.find(filter)
        .populate('cua_hang_id')
        .populate('kho_id')
        .populate('nguoi_tao_id')
        .sort({ created_at: -1 })
        .skip(skip)
        .limit(pageSize);
    const ticketIds = list.map(item => item._id);
    const details = ticketIds.length
        ? await CTPhieuKiemKho.find({ phieu_kiem_kho_id: { $in: ticketIds } }).populate('hang_hoa_id').populate({ path: 'lo_hang_id', select: 'ten_lo ma_lo han_su_dung' })
        : [];
    const detailMap = details.reduce((acc, item) => {
        const key = String(item.phieu_kiem_kho_id);
        if (!acc[key]) acc[key] = { positive: 0, negative: 0, actual: 0, value: 0, items: [] };
        const diff = Number(item.so_luong_lech || 0);
        if (diff > 0) acc[key].positive += diff;
        if (diff < 0) acc[key].negative += Math.abs(diff);
        acc[key].actual += Number(item.so_luong_thuc_te || 0);
        acc[key].value += Number(item.gia_tri_lech || 0);
        acc[key].items.push(item.toObject());
        return acc;
    }, {});
    const tickets = list.map(item => {
        const obj = item.toObject();
        obj.summary = detailMap[String(item._id)] || { positive: 0, negative: 0, actual: 0, value: 0, items: [] };
        return obj;
    });
    return {
        tickets,
        users,
        exportColumnGroups: getKiemKhoExportColumnGroupsForView(),
        filters: {
            q,
            date_mode: dateMode,
            from_date: query.from_date || '',
            to_date: query.to_date || '',
            trang_thai: statuses,
            nguoi_tao_id: query.nguoi_tao_id || '',
            page: String(page),
            page_size: String(pageSize)
        },
        pagination: {
            total,
            page,
            limit: pageSize,
            totalPages,
            from: total === 0 ? 0 : skip + 1,
            to: Math.min(skip + pageSize, total)
        },
        qs: function(overrides) {
            return buildKiemKhoQueryString(query, overrides);
        }
    };
}

module.exports = { loadKiemKhoListPage };
