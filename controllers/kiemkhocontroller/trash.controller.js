const trashService = require('./services/trash.service');

exports.postTrashPreview = async function(req, res, next) {
    try {
        const result = await trashService.previewKiemKhoTrash(req.body?.phieu_kiem_kho_ids || req.body?.ids);
        return res.status(result.status).json(result.body);
    } catch (error) {
        next(error);
    }
};

exports.postTrashMove = async function(req, res, next) {
    try {
        const result = await trashService.moveKiemKhoToTrash({ rawIds: req.body?.phieu_kiem_kho_ids || req.body?.ids, user: req.user });
        return res.status(result.status).json(result.body);
    } catch (error) {
        next(error);
    }
};
