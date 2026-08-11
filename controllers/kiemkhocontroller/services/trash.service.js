const mongoose = require('mongoose');
const { PhieuKiemKho, CTPhieuKiemKho } = require('../../../models/kiot.model');
const { activeKiemKhoDocumentFilter } = require('../helpers/filter.helper');
const { rollbackKiemKhoStock } = require('./rollback.service');

function normalizeIds(ids) {
    const raw = Array.isArray(ids) ? ids : [];
    return Array.from(new Set(raw.map(id => String(id || '').trim()).filter(id => mongoose.Types.ObjectId.isValid(id))));
}

async function previewKiemKhoTrash(ids) {
    const cleanIds = normalizeIds(ids);
    if (!cleanIds.length) {
        const error = new Error('Vui lòng chọn ít nhất một phiếu kiểm kho.');
        error.statusCode = 400;
        throw error;
    }

    const tickets = await PhieuKiemKho.find(activeKiemKhoDocumentFilter({ _id: { $in: cleanIds } }))
        .populate('kho_id')
        .lean();
    const ticketMap = new Map(tickets.map(ticket => [String(ticket._id), ticket]));
    const detailCount = await CTPhieuKiemKho.countDocuments({ phieu_kiem_kho_id: { $in: tickets.map(ticket => ticket._id) } });

    const items = cleanIds.map(id => {
        const ticket = ticketMap.get(id);
        if (!ticket) {
            return {
                phieu_kiem_kho_id: id,
                can_trash: false,
                block_reason: 'Không tìm thấy phiếu kiểm kho hoặc phiếu đã bị xóa.'
            };
        }
        return {
            phieu_kiem_kho_id: id,
            ma_kiem_kho: ticket.ma_kiem_kho || '',
            kho: ticket.kho_id ? (ticket.kho_id.ten_kho || ticket.kho_id.ma_kho || '') : '',
            can_trash: true,
            warnings: ticket.stock_rollback_at || ticket.trang_thai === 'cancelled'
                ? ['Phiếu đã hủy hoặc đã hoàn trả tồn trước đó, hệ thống chỉ chuyển trạng thái dữ liệu.']
                : []
        };
    });

    const canProceed = items.length > 0 && items.every(item => item.can_trash);
    return {
        can_proceed: canProceed,
        items,
        aggregate_groups: [
            { entity_type: 'phieu_kiem_kho', label: 'Phiếu kiểm kho', count: tickets.length },
            { entity_type: 'ct_phieu_kiem_kho', label: 'Dòng hàng kiểm kho', count: detailCount }
        ]
    };
}

async function moveKiemKhoToTrash(ids, userId) {
    const preview = await previewKiemKhoTrash(ids);
    if (!preview.can_proceed) {
        const error = new Error('Không thể xóa một hoặc nhiều phiếu kiểm kho đã chọn.');
        error.statusCode = 400;
        throw error;
    }

    const cleanIds = normalizeIds(ids);
    const tickets = await PhieuKiemKho.find(activeKiemKhoDocumentFilter({ _id: { $in: cleanIds } }));
    let movedCount = 0;
    for (const ticket of tickets) {
        await rollbackKiemKhoStock(ticket, userId);
        ticket.trang_thai = 'cancelled';
        ticket.trang_thai_du_lieu = 'inactive';
        await ticket.save();
        movedCount += 1;
    }

    return { moved_count: movedCount };
}

module.exports = {
    previewKiemKhoTrash,
    moveKiemKhoToTrash
};
