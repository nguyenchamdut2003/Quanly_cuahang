const trashService = require('./services/trash.service');

exports.previewTrash = async function(req, res) {
    try {
        const ids = req.body && req.body.phieu_kiem_kho_ids;
        const preview = await trashService.previewKiemKhoTrash(ids);
        return res.json({ success: true, data: preview });
    } catch (error) {
        const status = Number(error.statusCode || error.status) || 400;
        return res.status(status).json({ success: false, message: error.message || 'Không xem trước được dữ liệu xóa.' });
    }
};

exports.moveToTrash = async function(req, res) {
    try {
        const ids = req.body && req.body.phieu_kiem_kho_ids;
        const userId = req.user && req.user._id;
        const result = await trashService.moveKiemKhoToTrash(ids, userId);
        return res.json({
            success: true,
            message: 'Đã xóa ' + result.moved_count + ' phiếu kiểm kho.',
            data: result
        });
    } catch (error) {
        const status = Number(error.statusCode || error.status) || 400;
        return res.status(status).json({ success: false, message: error.message || 'Không xóa được phiếu kiểm kho.' });
    }
};
