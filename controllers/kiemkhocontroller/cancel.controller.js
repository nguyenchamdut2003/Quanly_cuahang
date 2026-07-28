const cancelService = require('./services/cancel.service');

exports.postIdCancel = async function(req, res, next) {
    try {
        const result = await cancelService.cancelKiemKho({ id: req.params.id, userId: req.user?._id });
        return res.status(result.status).json(result.body);
    } catch (error) {
        next(error);
    }
};
