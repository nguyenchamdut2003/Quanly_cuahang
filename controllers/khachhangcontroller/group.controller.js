var { normalizeIdParam, shouldRespondJson } = require('./helpers/common.helper');
var groupService = require('./services/group.service');

exports.addGroup = async function(req, res, next) {
    try {
        var created = await groupService.createGroup(req.body || {});
        if (shouldRespondJson(req)) {
            return res.json({
                success: true,
                message: 'Đã thêm nhóm khách hàng.',
                selectedId: String(created._id),
                customerGroups: await groupService.loadCustomerGroups()
            });
        }
        res.redirect('/khach-hang?success=created');
    } catch (error) {
        if (error.code === 'missing_group_name') return res.redirect('/khach-hang?error=missing_group_name');
        next(error);
    }
};

exports.updateGroup = async function(req, res, next) {
    try {
        var groupId = normalizeIdParam(req?.params?.groupId);
        if (!groupId) return res.redirect('/khach-hang?error=invalid_group');
        await groupService.updateGroup(groupId, req.body || {});
        if (shouldRespondJson(req)) {
            return res.json({
                success: true,
                message: 'Đã cập nhật nhóm khách hàng.',
                selectedId: groupId,
                customerGroups: await groupService.loadCustomerGroups()
            });
        }
        res.redirect('/khach-hang?success=updated');
    } catch (error) {
        if (error.code === 'missing_group_name') return res.redirect('/khach-hang?error=missing_group_name');
        next(error);
    }
};

exports.removeGroup = async function(req, res, next) {
    try {
        var groupId = normalizeIdParam(req?.params?.groupId);
        if (!groupId) return res.redirect('/khach-hang?error=invalid_group');
        await groupService.removeGroup(groupId);
        if (shouldRespondJson(req)) {
            return res.json({
                success: true,
                message: 'Đã xóa nhóm khách hàng.',
                customerGroups: await groupService.loadCustomerGroups()
            });
        }
        res.redirect('/khach-hang?success=deleted');
    } catch (error) {
        next(error);
    }
};
