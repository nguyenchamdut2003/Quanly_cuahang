exports.isAuthenticated = (req, res, next) => {
    const allowed = req.isAuthenticated()
        && req.user
        && req.user.vai_tro === 'admin'
        && req.user.trang_thai === 'active';

    if (allowed) return next();

    if (req.isAuthenticated() && req.logout) {
        return req.logout(() => res.redirect('/?error=admin_required'));
    }

    return res.redirect('/?error=unauthorized');
};

exports.checkRole = (roles) => {
    return (req, res, next) => {
        if (!req.isAuthenticated() || !req.user || req.user.trang_thai !== 'active') {
            return res.redirect('/?error=unauthorized');
        }

        if (Array.isArray(roles) && roles.includes(req.user.vai_tro)) {
            return next();
        }

        return res.status(403).send('Bạn không có quyền truy cập trang này!');
    };
};
