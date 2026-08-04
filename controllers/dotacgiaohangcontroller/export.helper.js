const ExcelJS = require('exceljs');
const {
    DoiTacGiaoHang,
    BangGiaVanChuyen
} = require('../../models/kiot.model');

const DELIVERY_PARTNER_STATUS_MAP = {
    active: 'Đang hoạt động',
    inactive: 'Ngừng hoạt động'
};

const SHIPPING_PRICE_TYPE_MAP = {
    theo_km: 'Theo km',
    co_dinh: 'Cố định',
    theo_tuyen: 'Theo tuyến'
};

const DELIVERY_PARTNER_EXPORT_COLUMNS = [
    { header: 'Mã đối tác', key: 'ma_doi_tac' },
    { header: 'Tên đối tác', key: 'ten_doi_tac' },
    { header: 'Điện thoại', key: 'dien_thoai' },
    { header: 'Email', key: 'email' },
    { header: 'Địa chỉ', key: 'dia_chi' },
    { header: 'Ghi chú', key: 'ghi_chu' },
    { header: 'Trạng thái', key: 'trang_thai' },
    { header: 'Ngày tạo', key: 'ngay_tao' },
    { header: 'Ngày cập nhật', key: 'ngay_cap_nhat' },
    { header: 'Tên bảng giá', key: 'ten_bang_gia' },
    { header: 'Loại tính phí', key: 'loai_tinh_phi' },
    { header: 'Điểm đi', key: 'diem_di' },
    { header: 'Điểm đến', key: 'diem_den' },
    { header: 'Khoảng cách km', key: 'khoang_cach_km', style: { numFmt: '#,##0.##' } },
    { header: 'Đơn giá/km', key: 'don_gia_km', style: { numFmt: '#,##0' } },
    { header: 'Phí cố định', key: 'phi_co_dinh', style: { numFmt: '#,##0' } },
    { header: 'Phí tối thiểu', key: 'phi_toi_thieu', style: { numFmt: '#,##0' } },
    { header: 'Trạng thái bảng giá', key: 'trang_thai_bang_gia' }
];

function formatExportDate(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString('vi-VN');
}

function applyDeliveryPartnerWorksheetFormat(worksheet) {
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    worksheet.columns.forEach(column => {
        column.width = Math.max(14, String(column.header || '').length + 4);
    });
    worksheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: DELIVERY_PARTNER_EXPORT_COLUMNS.length }
    };
    worksheet.views = [{ state: 'frozen', ySplit: 1 }];
}

function buildDeliveryPartnerExportRow(partner, priceList) {
    return {
        ma_doi_tac: partner.ma_doi_tac || '',
        ten_doi_tac: partner.ten_doi_tac || '',
        dien_thoai: partner.sdt || '',
        email: partner.email || '',
        dia_chi: partner.dia_chi_day_du || '',
        ghi_chu: partner.ghi_chu || '',
        trang_thai: DELIVERY_PARTNER_STATUS_MAP[partner.trang_thai] || partner.trang_thai || '',
        ngay_tao: formatExportDate(partner.created_at),
        ngay_cap_nhat: formatExportDate(partner.updated_at),
        ten_bang_gia: priceList?.ten_bang_gia || '',
        loai_tinh_phi: priceList ? (SHIPPING_PRICE_TYPE_MAP[priceList.loai_tinh_phi] || priceList.loai_tinh_phi || '') : '',
        diem_di: priceList?.diem_di || '',
        diem_den: priceList?.diem_den || '',
        khoang_cach_km: priceList ? Number(priceList.khoang_cach_km || 0) : 0,
        don_gia_km: priceList ? Number(priceList.don_gia_km || 0) : 0,
        phi_co_dinh: priceList ? Number(priceList.phi_co_dinh || 0) : 0,
        phi_toi_thieu: priceList ? Number(priceList.phi_toi_thieu || 0) : 0,
        trang_thai_bang_gia: priceList ? (DELIVERY_PARTNER_STATUS_MAP[priceList.trang_thai] || priceList.trang_thai || '') : ''
    };
}

async function loadDeliveryPartnerExportData(filter = {}) {
    const partners = await DoiTacGiaoHang.find(filter).sort({ created_at: -1 }).lean();
    const partnerIds = partners.map(partner => partner._id);
    const priceLists = partnerIds.length
        ? await BangGiaVanChuyen.find({ doi_tac_giao_hang_id: { $in: partnerIds } })
            .sort({ created_at: -1 })
            .lean()
        : [];
    const priceMap = priceLists.reduce((map, priceList) => {
        const key = String(priceList.doi_tac_giao_hang_id || '');
        if (!map[key]) map[key] = [];
        map[key].push(priceList);
        return map;
    }, {});
    return { partners, priceMap };
}

async function sendDeliveryPartnerWorkbook(res, filename, partners, priceMap) {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Đối tác giao hàng');
    worksheet.columns = DELIVERY_PARTNER_EXPORT_COLUMNS;

    partners.forEach(partner => {
        const priceLists = priceMap[String(partner._id)] || [];
        if (!priceLists.length) {
            worksheet.addRow(buildDeliveryPartnerExportRow(partner, null));
            return;
        }
        priceLists.forEach(priceList => worksheet.addRow(buildDeliveryPartnerExportRow(partner, priceList)));
    });

    applyDeliveryPartnerWorksheetFormat(worksheet);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
    await workbook.xlsx.write(res);
    res.end();
}

module.exports = {
    DELIVERY_PARTNER_EXPORT_COLUMNS,
    DELIVERY_PARTNER_STATUS_MAP,
    applyDeliveryPartnerWorksheetFormat,
    buildDeliveryPartnerExportRow,
    loadDeliveryPartnerExportData,
    sendDeliveryPartnerWorkbook
};
