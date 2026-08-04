const {
    loadDeliveryPartnerExportData,
    sendDeliveryPartnerWorkbook
} = require('./export.helper');

exports.getDoiTacGiaoHangExportXlsx = async (req, res, next) => {
    try {
        const { partners, priceMap } = await loadDeliveryPartnerExportData();
        await sendDeliveryPartnerWorkbook(res, 'doi-tac-giao-hang.xlsx', partners, priceMap);
    } catch (error) {
        next(error);
    }
};

exports.getDoiTacGiaoHangIdExportXlsx = async (req, res, next) => {
    try {
        if (!/^[0-9a-fA-F]{24}$/.test(String(req.params.id || ''))) {
            return res.status(404).send('Không tìm thấy đối tác giao hàng');
        }
        const { partners, priceMap } = await loadDeliveryPartnerExportData({ _id: req.params.id });
        if (!partners.length) return res.status(404).send('Không tìm thấy đối tác giao hàng');
        await sendDeliveryPartnerWorkbook(
            res,
            'doi-tac-giao-hang-' + (partners[0].ma_doi_tac || 'unknown') + '.xlsx',
            partners,
            priceMap
        );
    } catch (error) {
        next(error);
    }
};
