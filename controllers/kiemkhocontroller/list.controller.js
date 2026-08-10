const listService = require('./services/list.service');

exports.index = async function(req, res, next) {
    try {
        const locals = await listService.loadKiemKhoListPage(req.query || {});
        res.render('kiem-kho/index', locals);
    } catch (error) {
        next(error);
    }
};
