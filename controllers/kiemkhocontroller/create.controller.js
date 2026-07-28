const createService = require('./services/create.service');

exports.getCreate = async function(req, res, next) {
    try {
        const locals = await createService.loadCreatePageData({ query: req.query || {}, user: req.user });
        res.render('kiem-kho/create', locals);
    } catch (error) {
        next(error);
    }
};

exports.saveKiemKho = async function(req, res, next) {
    try {
        const result = await createService.createKiemKho({ body: req.body || {}, user: req.user });
        return res.json(result);
    } catch (error) {
        if (error.status || error.statusCode) {
            return res.status(error.status || error.statusCode).json({ success: false, message: error.message });
        }
        next(error);
    }
};
