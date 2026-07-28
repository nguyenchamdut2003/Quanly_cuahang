function wantsJsonResponse(req) {
    const accept = String(req.get('accept') || '');
    const path = String(req.originalUrl || req.url || '');
    return accept.includes('application/json')
        || req.get('x-requested-with') === 'XMLHttpRequest'
        || path.startsWith('/api/');
}

function isSafeReturnUrl(value) {
    const url = String(value || '').trim();
    return !!url && url[0] === '/' && url.indexOf('//') !== 0;
}

function redirectToLogin(req, res, error) {
    let loginUrl = '/login';
    const isGetHtml = req.method === 'GET' && !wantsJsonResponse(req);

    if (isGetHtml && isSafeReturnUrl(req.originalUrl)) {
        if (req.session) req.session.returnUrl = req.originalUrl;
        loginUrl += '?returnUrl=' + encodeURIComponent(req.originalUrl);
    } else if (error) {
        loginUrl += '?error=' + encodeURIComponent(error);
    }

    return res.redirect(loginUrl);
}

exports.isAuthenticated = (req, res, next) => {
    const loggedIn = typeof req.isAuthenticated === 'function' && req.isAuthenticated() && req.user;

    if (loggedIn && req.user.trang_thai === 'active') {
        return next();
    }

    if (wantsJsonResponse(req)) {
        if (loggedIn) {
            return res.status(403).json({
                success: false,
                message: 'Tài khoản đã bị khóa hoặc ngừng hoạt động.'
            });
        }
        return res.status(401).json({
            success: false,
            message: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'
        });
    }

    return redirectToLogin(req, res, loggedIn ? 'account_inactive' : 'unauthorized');
};

exports.isGuest = (req, res, next) => {
    const loggedIn = typeof req.isAuthenticated === 'function' && req.isAuthenticated() && req.user;
    if (!loggedIn) return next();
    if (req.user.cua_hang_id) return res.redirect('/');
    return res.redirect('/cua-hang?mode=create');
};

exports.checkRole = (roles) => {
    const allowedRoles = Array.isArray(roles) ? roles : [roles];
    return (req, res, next) => {
        const loggedIn = typeof req.isAuthenticated === 'function' && req.isAuthenticated() && req.user;
        if (!loggedIn || req.user.trang_thai !== 'active') {
            if (wantsJsonResponse(req)) {
                return res.status(401).json({ success: false, message: 'Vui lòng đăng nhập lại.' });
            }
            return redirectToLogin(req, res, 'unauthorized');
        }

        if (allowedRoles.includes(req.user.vai_tro)) {
            return next();
        }

        if (wantsJsonResponse(req)) {
            return res.status(403).json({ success: false, message: 'Bạn không có quyền thực hiện thao tác này.' });
        }
        return res.status(403).send('Bạn không có quyền truy cập trang này!');
    };
};

exports.requireRole = exports.checkRole;
