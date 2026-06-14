function wantsJsonResponse(req) {
    const accept = String(req.get('accept') || '');
    const path = String(req.originalUrl || req.url || '');
    return accept.includes('application/json')
        || req.get('x-requested-with') === 'XMLHttpRequest'
        || path.startsWith('/api/');
}

exports.isAuthenticated = (req, res, next) => {
    const allowed = req.isAuthenticated()
        && req.user
        && req.user.vai_tro === 'admin'
        && req.user.trang_thai === 'active';

    if (allowed) return next();

    if (wantsJsonResponse(req)) {
        if (req.isAuthenticated() && req.user) {
            return res.status(403).json({
                success: false,
                message: 'Chỉ tài khoản admin mới được thực hiện thao tác này.'
            });
        }
        return res.status(401).json({
            success: false,
            message: 'Phiên đăng nhập đã hết hạn. Vui lòng tải lại trang và đăng nhập lại.'
        });
    }

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
