const { PhieuKiemKho, CTPhieuKiemKho } = require('../../../models/kiot.model');
const { ThungRacItem } = require('../../../models/trash.model');
const { ENTITY_LABELS, buildTrashChildFields } = require('../../../services/trashLabels.service');
const { normalizeKiemKhoIds } = require('../helpers/common.helper');
const { rollbackKiemKhoStock } = require('./rollback.service');

async function loadKiemKhoDetailCounts(ticketIds) {
    const detailCounts = await CTPhieuKiemKho.aggregate([
        { $match: { phieu_kiem_kho_id: { $in: ticketIds } } },
        { $group: { _id: '$phieu_kiem_kho_id', count: { $sum: 1 } } }
    ]);
    return detailCounts.reduce((map, row) => {
        map[String(row._id)] = row.count;
        return map;
    }, {});
}

function buildKiemKhoTrashGroups(ticket, countMap) {
    const diff = Number(ticket.tong_so_luong_lech || 0);
    return [
        { entity_type: 'CTPhieuKiemKho', label: ENTITY_LABELS.CTPhieuKiemKho || 'Chi tiết kiểm kho', count: Number(countMap[String(ticket._id)] || 0), samples: [] },
        { entity_type: 'LichSuKho', label: 'Lịch sử kho liên quan', count: Math.abs(diff) > 0 ? 1 : 0, samples: [] }
    ].filter(group => Number(group.count || 0) > 0);
}

async function previewKiemKhoTrash(rawIds) {
    const ids = normalizeKiemKhoIds(rawIds);
    if (!ids.length) return { status: 400, body: { success: false, message: 'Vui lòng chọn ít nhất một phiếu kiểm kho.' } };
    const tickets = await PhieuKiemKho.find({ _id: { $in: ids } }).populate('kho_id').populate('nguoi_tao_id').lean();
    if (tickets.length !== ids.length) return { status: 404, body: { success: false, message: 'Một hoặc nhiều phiếu kiểm kho không tồn tại.' } };
    const countMap = await loadKiemKhoDetailCounts(tickets.map(item => item._id));
    const ticketMap = tickets.reduce((map, row) => { map[String(row._id)] = row; return map; }, {});
    const trashRows = await ThungRacItem.find({ entity_type: 'PhieuKiemKho', entity_id: { $in: tickets.map(item => item._id) }, restored_at: null }).select('entity_id').lean();
    const trashMap = trashRows.reduce((map, row) => { map[String(row.entity_id)] = true; return map; }, {});
    const items = ids.map(id => {
        const ticket = ticketMap[id];
        const isDeleted = Boolean(ticket.deleted_at || trashMap[id]);
        const diff = Number(ticket.tong_so_luong_lech || 0);
        return {
            phieu_kiem_kho_id: id,
            ma_kiem_kho: ticket.ma_kiem_kho || '',
            kho: ticket.kho_id ? (ticket.kho_id.ten_kho || ticket.kho_id.ma_kho || '') : '',
            trang_thai: ticket.trang_thai || '',
            can_trash: !isDeleted,
            block_reason: isDeleted ? 'Phiếu kiểm kho đã nằm trong thùng rác.' : '',
            warnings: ticket.trang_thai === 'completed' && diff ? ['Phiếu đã cân bằng kho. Khi đưa vào thùng rác, hệ thống sẽ đảo lại phần tồn kho do phiếu này đã ghi nhận.'] : [],
            groups: buildKiemKhoTrashGroups(ticket, countMap)
        };
    });
    const blocked = items.filter(item => !item.can_trash);
    const aggregateMap = {};
    items.forEach(item => item.groups.forEach(group => {
        if (!aggregateMap[group.entity_type]) aggregateMap[group.entity_type] = { entity_type: group.entity_type, label: group.label, count: 0, samples: [] };
        aggregateMap[group.entity_type].count += Number(group.count || 0);
    }));
    return { status: 200, body: { success: true, data: { items, allowed_count: items.length - blocked.length, blocked_count: blocked.length, can_proceed: blocked.length === 0 && items.length > 0, aggregate_groups: Object.keys(aggregateMap).map(key => aggregateMap[key]) } } };
}

async function moveKiemKhoToTrash({ rawIds, user }) {
    const ids = normalizeKiemKhoIds(rawIds);
    if (!ids.length) return { status: 400, body: { success: false, message: 'Vui lòng chọn ít nhất một phiếu kiểm kho.' } };
    const tickets = await PhieuKiemKho.find({ _id: { $in: ids } });
    if (tickets.length !== ids.length) return { status: 404, body: { success: false, message: 'Một hoặc nhiều phiếu kiểm kho không tồn tại.' } };
    const existingTrash = await ThungRacItem.exists({ entity_type: 'PhieuKiemKho', entity_id: { $in: tickets.map(ticket => ticket._id) }, restored_at: null });
    if (existingTrash || tickets.some(ticket => ticket.deleted_at)) return { status: 400, body: { success: false, message: 'Danh sách chọn có phiếu kiểm kho đã nằm trong thùng rác.' } };
    const countMap = await loadKiemKhoDetailCounts(tickets.map(ticket => ticket._id));
    const now = new Date();
    const moved = [];
    for (const ticket of tickets) {
        await rollbackKiemKhoStock(ticket, user?._id);
        ticket.deleted_at = now;
        ticket.deleted_by = user?._id || null;
        await ticket.save();
        const root = await ThungRacItem.create({ entity_type: 'PhieuKiemKho', entity_id: ticket._id, ma_chung_tu: ticket.ma_kiem_kho || '', ten_hien_thi: ticket.ma_kiem_kho || 'Phiếu kiểm kho', mo_ta_phu: ticket.trang_thai === 'completed' ? 'Đã cân bằng kho' : (ticket.trang_thai === 'cancelled' ? 'Đã hủy' : 'Phiếu tạm'), cua_hang_id: ticket.cua_hang_id || null, deleted_at: now, deleted_by: user?._id || null, is_trash_root: true, trash_group_id: null, sort_order: 0 });
        let sortOrder = 1;
        for (const group of buildKiemKhoTrashGroups(ticket, countMap)) {
            const childFields = buildTrashChildFields(group);
            await ThungRacItem.create({ entity_type: group.entity_type, entity_id: ticket._id, ma_chung_tu: childFields.ma_chung_tu, ten_hien_thi: childFields.ten_hien_thi, mo_ta_phu: childFields.mo_ta_phu, cua_hang_id: ticket.cua_hang_id || null, deleted_at: now, deleted_by: user?._id || null, is_trash_root: false, trash_group_id: root._id, sort_order: sortOrder });
            sortOrder += 1;
        }
        moved.push({ phieu_kiem_kho_id: String(ticket._id), ma_kiem_kho: ticket.ma_kiem_kho || '', trash_root_id: String(root._id) });
    }
    return { status: 200, body: { success: true, message: 'Đã đưa ' + moved.length + ' phiếu kiểm kho vào thùng rác.', data: { moved } } };
}

module.exports = { previewKiemKhoTrash, moveKiemKhoToTrash, loadKiemKhoDetailCounts, buildKiemKhoTrashGroups };
