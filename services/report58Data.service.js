const mongoose = require('mongoose');
const {
    HoaDonBanHang,
    PhieuTraHang,
    PhieuNhap,
    PhieuThuChi,
    SoQuy,
    TonKho,
    GiaoDichCongNoKhachHang,
    GiaoDichCongNoNhaCungCap,
    KhachHang,
    NhaCungCap
} = require('../models/kiot.model');
const { numberToVietnameseWords } = require('../utils/numberToVietnameseWords');

const VAT_RATE = 0.05;

const B02_LINES = [
    { ma: '01', chi_tieu: 'Doanh thu bán hàng và cung cấp dịch vụ' },
    { ma: '02', chi_tieu: 'Các khoản giảm trừ doanh thu' },
    { ma: '10', chi_tieu: 'Doanh thu thuần về bán hàng và cung cấp dịch vụ' },
    { ma: '11', chi_tieu: 'Giá vốn hàng bán' },
    { ma: '20', chi_tieu: 'Lợi nhuận gộp về bán hàng và cung cấp dịch vụ' },
    { ma: '25', chi_tieu: 'Chi phí quản lý doanh nghiệp' },
    { ma: '26', chi_tieu: 'Chi phí khác' },
    { ma: '30', chi_tieu: 'Lợi nhuận thuần từ hoạt động kinh doanh' },
    { ma: '31', chi_tieu: 'Thu nhập khác' },
    { ma: '32', chi_tieu: 'Chi phí khác' },
    { ma: '50', chi_tieu: 'Lợi nhuận kế toán trước thuế' },
    { ma: '51', chi_tieu: 'Chi phí thuế TNDN' },
    { ma: '60', chi_tieu: 'Lợi nhuận sau thuế TNDN' }
];

const B01_LINES = [
    { ma: '100', chi_tieu: 'TÀI SẢN NGẮN HẠN' },
    { ma: '110', chi_tieu: 'Tiền và các khoản tương đương tiền' },
    { ma: '130', chi_tieu: 'Hàng tồn kho' },
    { ma: '140', chi_tieu: 'Phải thu khách hàng' },
    { ma: '200', chi_tieu: 'TÀI SẢN DÀI HẠN' },
    { ma: '300', chi_tieu: 'NỢ PHẢI TRẢ' },
    { ma: '310', chi_tieu: 'Phải trả người bán' },
    { ma: '400', chi_tieu: 'VỐN CHỦ SỞ HỮU' }
];

const VOUCHER_MAU = new Set(['01-TT', '02-TT', '01-VT', '02-VT']);

const LANDSCAPE_MAU = new Set([
    'S2b-DNSN', 'S2c-DNSN', 'S2d-DNSN', 'S3b-DNSN', 'S4a-DNSN',
    'S4b-DNSN', 'S4c-DNSN', 'S4d-DNSN', 'B01-DNSN', 'B02-DNSN'
]);

function roundMoney(value) {
    return Math.round(Number(value) || 0);
}

function formatDate(value) {
    if (!value) return '';
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('vi-VN');
}

function formatDateLong(value) {
    if (!value) return 'Ngày .... tháng .... năm ....';
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return 'Ngày .... tháng .... năm ....';
    return `Ngày ${date.getDate()} tháng ${date.getMonth() + 1} năm ${date.getFullYear()}`;
}

function storeFilter(store) {
    return store?._id ? { cua_hang_id: store._id } : {};
}

function rangeFilter(range, field) {
    const start = range?.start ? new Date(range.start) : new Date();
    const end = range?.end ? new Date(range.end) : new Date();
    return { [field]: { $gte: start, $lt: end } };
}

function paymentMethodLabel(value) {
    const map = {
        tien_mat: 'Tiền mặt',
        chuyen_khoan: 'Chuyển khoản',
        vi_dien_tu: 'Ví điện tử',
        khac: 'Khác'
    };
    return map[value] || value || '';
}

async function loadS2dFilterOptions() {
    const cashBooks = await SoQuy.find({ trang_thai: 'active' }).select('ten_so_quy').sort({ ten_so_quy: 1 }).lean();
    return { cashBooks };
}

async function loadVoucherFilterOptions(store = null) {
    const filter = {
        trang_thai: { $ne: 'cancelled' },
        ...storeFilter(store)
    };
    const receipts = await PhieuThuChi.find(filter)
        .select('ma_phieu loai_phieu ngay_lap gia_tri doi_tuong')
        .sort({ ngay_lap: -1 })
        .limit(200)
        .lean();
    return { receipts };
}

async function fetchPeriodAggregates(range, store) {
    const invoiceFilter = {
        trang_thai: { $ne: 'cancelled' },
        ...storeFilter(store),
        ...rangeFilter(range, 'ngay_ban')
    };
    const returnFilter = {
        deleted_at: null,
        ...storeFilter(store),
        ...rangeFilter(range, 'ngay_tra')
    };
    const purchaseFilter = {
        trang_thai: { $ne: 'cancelled' },
        deleted_at: null,
        ...storeFilter(store),
        ...rangeFilter(range, 'ngay_nhap')
    };
    const chiFilter = {
        loai_phieu: 'chi',
        trang_thai: { $ne: 'cancelled' },
        ...storeFilter(store),
        ...rangeFilter(range, 'ngay_lap')
    };

    const [invoices, returns, purchases, chiReceipts] = await Promise.all([
        HoaDonBanHang.find(invoiceFilter).select('tong_tien thanh_toan').lean(),
        PhieuTraHang.find(returnFilter).select('tong_tien_tra').lean(),
        PhieuNhap.find(purchaseFilter).select('tong_tien').lean(),
        PhieuThuChi.find(chiFilter).select('gia_tri phieu_nhap_id nha_cung_cap_id loai_thu_chi').lean()
    ]);

    const doanhThu = invoices.reduce((sum, row) => sum + roundMoney(row.tong_tien ?? row.thanh_toan), 0);
    const giamTru = returns.reduce((sum, row) => sum + roundMoney(row.tong_tien_tra), 0);
    const doanhThuThuan = Math.max(doanhThu - giamTru, 0);
    const giaVon = purchases.reduce((sum, row) => sum + roundMoney(row.tong_tien), 0);

    let chiQuanLy = 0;
    let chiKhac = 0;
    chiReceipts.forEach(row => {
        const amount = roundMoney(row.gia_tri);
        if (row.phieu_nhap_id || row.nha_cung_cap_id) return;
        const label = String(row.loai_thu_chi || '').toLowerCase();
        if (/lương|luong|quản lý|quan ly|bán hàng|ban hang/.test(label)) {
            chiQuanLy += amount;
        } else {
            chiKhac += amount;
        }
    });

    const loiNhuanGop = doanhThuThuan - giaVon;
    const loiNhuanKd = loiNhuanGop - chiQuanLy - chiKhac;

    return {
        doanhThu,
        giamTru,
        doanhThuThuan,
        giaVon,
        loiNhuanGop,
        chiQuanLy,
        chiKhac,
        loiNhuanKd,
        loiNhuanTruocThue: loiNhuanKd,
        thueTndn: 0,
        loiNhuanSauThue: loiNhuanKd
    };
}

async function fetchBalanceAggregates(store) {
    const sf = storeFilter(store);
    const [cashRows, inventoryRows, receivableRows, payableRows] = await Promise.all([
        PhieuThuChi.aggregate([
            { $match: { ...sf, trang_thai: { $ne: 'cancelled' } } },
            {
                $group: {
                    _id: '$loai_phieu',
                    total: { $sum: { $ifNull: ['$gia_tri', 0] } }
                }
            }
        ]),
        TonKho.aggregate([
            { $match: sf },
            {
                $lookup: {
                    from: 'hang_hoa',
                    localField: 'hang_hoa_id',
                    foreignField: '_id',
                    as: 'product'
                }
            },
            { $unwind: { path: '$product', preserveNullAndEmptyArrays: true } },
            {
                $group: {
                    _id: null,
                    total: {
                        $sum: {
                            $multiply: [
                                { $ifNull: ['$so_luong', 0] },
                                { $ifNull: ['$product.gia_von', 0] }
                            ]
                        }
                    }
                }
            }
        ]),
        KhachHang.aggregate([
            { $match: { ...sf, trang_thai: { $ne: 'inactive' } } },
            { $group: { _id: null, total: { $sum: { $ifNull: ['$tong_no', 0] } } } }
        ]),
        NhaCungCap.aggregate([
            { $match: { ...sf, trang_thai: 'active' } },
            { $group: { _id: null, total: { $sum: { $ifNull: ['$tong_no', 0] } } } }
        ])
    ]);

    const thu = cashRows.find(row => row._id === 'thu');
    const chi = cashRows.find(row => row._id === 'chi');
    const cash = roundMoney((thu?.total || 0) - (chi?.total || 0));
    const inventory = roundMoney(inventoryRows[0]?.total || 0);
    const receivables = roundMoney(receivableRows[0]?.total || 0);
    const payables = roundMoney(payableRows[0]?.total || 0);
    const shortAssets = cash + inventory + receivables;
    const fixedAssets = 0;
    const liabilities = payables;
    const equity = shortAssets + fixedAssets - liabilities;

    return {
        cash,
        inventory,
        receivables,
        payables,
        shortAssets,
        fixedAssets,
        liabilities,
        equity
    };
}

async function fetchRevenueExpenseRows(range, store) {
    const events = [];
    const sf = storeFilter(store);
    const rf = rangeFilter(range, 'ngay_ban');

    const [invoices, purchases, chiReceipts] = await Promise.all([
        HoaDonBanHang.find({ trang_thai: { $ne: 'cancelled' }, ...sf, ...rf })
            .select('ma_hoa_don ngay_ban tong_tien thanh_toan ghi_chu')
            .sort({ ngay_ban: 1 })
            .lean(),
        PhieuNhap.find({ trang_thai: { $ne: 'cancelled' }, deleted_at: null, ...sf, ...rangeFilter(range, 'ngay_nhap') })
            .select('ma_phieu_nhap ngay_nhap tong_tien ghi_chu')
            .sort({ ngay_nhap: 1 })
            .lean(),
        PhieuThuChi.find({
            loai_phieu: 'chi',
            trang_thai: { $ne: 'cancelled' },
            ...sf,
            ...rangeFilter(range, 'ngay_lap')
        })
            .select('ma_phieu ngay_lap gia_tri loai_thu_chi doi_tuong ghi_chu phieu_nhap_id nha_cung_cap_id')
            .sort({ ngay_lap: 1 })
            .lean()
    ]);

    invoices.forEach(row => {
        events.push({
            ngay: row.ngay_ban,
            chung_tu: row.ma_hoa_don || '',
            dien_giai: 'Doanh thu bán hàng',
            doanh_thu: roundMoney(row.tong_tien ?? row.thanh_toan),
            chi_mua: 0,
            chi_ban_hang: 0,
            chi_khac: 0,
            ghi_chu: row.ghi_chu || ''
        });
    });

    purchases.forEach(row => {
        events.push({
            ngay: row.ngay_nhap,
            chung_tu: row.ma_phieu_nhap || '',
            dien_giai: 'Chi phí mua hàng',
            doanh_thu: 0,
            chi_mua: roundMoney(row.tong_tien),
            chi_ban_hang: 0,
            chi_khac: 0,
            ghi_chu: row.ghi_chu || ''
        });
    });

    chiReceipts.forEach(row => {
        const amount = roundMoney(row.gia_tri);
        const isPurchase = Boolean(row.phieu_nhap_id || row.nha_cung_cap_id);
        const label = String(row.loai_thu_chi || row.doi_tuong || '').toLowerCase();
        const isSalesExpense = /lương|luong|quản lý|quan ly|bán hàng|ban hang/.test(label);
        events.push({
            ngay: row.ngay_lap,
            chung_tu: row.ma_phieu || '',
            dien_giai: row.loai_thu_chi || row.doi_tuong || 'Chi phí',
            doanh_thu: 0,
            chi_mua: isPurchase ? amount : 0,
            chi_ban_hang: !isPurchase && isSalesExpense ? amount : 0,
            chi_khac: !isPurchase && !isSalesExpense ? amount : 0,
            ghi_chu: row.ghi_chu || ''
        });
    });

    events.sort((a, b) => new Date(a.ngay).getTime() - new Date(b.ngay).getTime());

    return events.map((row, index) => {
        const loiNhuan = row.doanh_thu - row.chi_mua - row.chi_ban_hang - row.chi_khac;
        return {
            stt: index + 1,
            ngay: formatDate(row.ngay),
            chung_tu: row.chung_tu,
            dien_giai: row.dien_giai,
            doanh_thu: row.doanh_thu,
            chi_mua: row.chi_mua,
            chi_ban_hang: row.chi_ban_hang,
            chi_khac: row.chi_khac,
            loi_nhuan: loiNhuan,
            ghi_chu: row.ghi_chu
        };
    });
}

async function fetchCashLedgerRows(range, store, query = {}) {
    const sf = storeFilter(store);
    const periodStart = range?.start ? new Date(range.start) : new Date();
    const periodEnd = range?.end ? new Date(range.end) : new Date();
    const cashBookId = String(query.so_quy_id || '').trim();

    const baseFilter = {
        trang_thai: { $ne: 'cancelled' },
        ...sf
    };
    if (cashBookId && mongoose.Types.ObjectId.isValid(cashBookId)) {
        baseFilter.so_quy_id = cashBookId;
    }

    const [beforeRows, periodRows] = await Promise.all([
        PhieuThuChi.find({ ...baseFilter, ngay_lap: { $lt: periodStart } })
            .select('loai_phieu gia_tri')
            .lean(),
        PhieuThuChi.find({ ...baseFilter, ngay_lap: { $gte: periodStart, $lt: periodEnd } })
            .populate('so_quy_id', 'ten_so_quy')
            .sort({ ngay_lap: 1, ma_phieu: 1 })
            .lean()
    ]);

    let balance = beforeRows.reduce((sum, row) => {
        const amount = roundMoney(row.gia_tri);
        return sum + (row.loai_phieu === 'thu' ? amount : -amount);
    }, 0);

    return periodRows.map((row, index) => {
        const thu = row.loai_phieu === 'thu' ? roundMoney(row.gia_tri) : 0;
        const chi = row.loai_phieu === 'chi' ? roundMoney(row.gia_tri) : 0;
        balance += thu - chi;
        return {
            stt: index + 1,
            ngay: formatDate(row.ngay_lap),
            chung_tu: row.ma_phieu || '',
            dien_giai: row.loai_thu_chi || row.doi_tuong || row.ghi_chu || '',
            thu,
            chi,
            ton_quy: balance,
            so_quy: row.so_quy_id?.ten_so_quy || paymentMethodLabel(row.phuong_thuc_thanh_toan),
            ghi_chu: row.ghi_chu || ''
        };
    });
}

async function fetchVatTrackingRows(range, store, invoiceRows) {
    const periodLabel = range?.from && range?.to
        ? `${formatDate(range.from)} – ${formatDate(range.to)}`
        : '';
    return (invoiceRows || []).map((row, index) => ({
        stt: index + 1,
        ky_thue: periodLabel,
        chung_tu: row.so_chung_tu || '',
        dien_giai: row.dien_giai || '',
        doanh_thu_chiu_thue: roundMoney(row.doanh_thu),
        thue_suat: `${Math.round(VAT_RATE * 100)}%`,
        thue_dau_ra: roundMoney(row.thue_gtgt),
        thue_dau_vao: 0,
        thue_phai_nop: roundMoney(row.thue_gtgt),
        ghi_chu: row.ghi_chu || ''
    }));
}

async function fetchDebtLedgerRows(range, store) {
    const sf = storeFilter(store);
    const rf = rangeFilter(range, 'ngay_giao_dich');
    const [khRows, nccRows] = await Promise.all([
        GiaoDichCongNoKhachHang.find({ ...sf, ...rf })
            .populate('khach_hang_id', 'ten_khach_hang ma_khach_hang')
            .sort({ ngay_giao_dich: 1, ma_giao_dich: 1 })
            .lean(),
        GiaoDichCongNoNhaCungCap.find({ ...sf, ...rf, deleted_at: null, trang_thai: 'active' })
            .populate('nha_cung_cap_id', 'ten_ncc ma_ncc')
            .sort({ ngay_giao_dich: 1, ma_giao_dich: 1 })
            .lean()
    ]);

    const events = [];
    khRows.forEach(row => {
        events.push({
            ngay: row.ngay_giao_dich,
            chung_tu: row.ma_giao_dich,
            doi_tuong: row.khach_hang_id?.ten_khach_hang || '',
            loai_doi_tuong: 'Khách hàng',
            dien_giai: row.loai_giao_dich,
            no_tang: row.huong_cong_no === 'tang_no' ? roundMoney(row.gia_tri) : 0,
            no_giam: row.huong_cong_no === 'giam_no' ? roundMoney(row.gia_tri) : 0,
            so_du: roundMoney(row.no_sau),
            ghi_chu: row.ghi_chu || ''
        });
    });
    nccRows.forEach(row => {
        events.push({
            ngay: row.ngay_giao_dich,
            chung_tu: row.ma_giao_dich,
            doi_tuong: row.nha_cung_cap_id?.ten_ncc || '',
            loai_doi_tuong: 'Nhà cung cấp',
            dien_giai: row.loai_giao_dich,
            no_tang: row.huong_cong_no === 'tang_no' ? roundMoney(row.gia_tri) : 0,
            no_giam: row.huong_cong_no === 'giam_no' ? roundMoney(row.gia_tri) : 0,
            so_du: roundMoney(row.no_sau),
            ghi_chu: row.ghi_chu || ''
        });
    });

    events.sort((a, b) => new Date(a.ngay).getTime() - new Date(b.ngay).getTime());
    return events.map((row, index) => ({
        stt: index + 1,
        ngay: formatDate(row.ngay),
        chung_tu: row.chung_tu,
        doi_tuong: row.doi_tuong,
        loai_doi_tuong: row.loai_doi_tuong,
        dien_giai: row.dien_giai,
        no_tang: row.no_tang,
        no_giam: row.no_giam,
        so_du: row.so_du,
        ghi_chu: row.ghi_chu
    }));
}

function buildB02Rows(agg) {
    const values = {
        '01': agg.doanhThu,
        '02': agg.giamTru,
        '10': agg.doanhThuThuan,
        '11': agg.giaVon,
        '20': agg.loiNhuanGop,
        '25': agg.chiQuanLy,
        '26': agg.chiKhac,
        '30': agg.loiNhuanKd,
        '31': 0,
        '32': 0,
        '50': agg.loiNhuanTruocThue,
        '51': agg.thueTndn,
        '60': agg.loiNhuanSauThue
    };
    return B02_LINES.map((line, index) => ({
        stt: index + 1,
        ma_so: line.ma,
        chi_tieu: line.chi_tieu,
        thuyet_minh: '',
        nam_nay: values[line.ma] ?? 0,
        nam_truoc: 0,
        ghi_chu: ''
    }));
}

function buildB01Rows(balance) {
    const values = {
        '100': balance.shortAssets,
        '110': balance.cash,
        '130': balance.inventory,
        '140': balance.receivables,
        '200': balance.fixedAssets,
        '300': balance.liabilities,
        '310': balance.payables,
        '400': balance.equity
    };
    return B01_LINES.map((line, index) => ({
        stt: index + 1,
        ma_so: line.ma,
        chi_tieu: line.chi_tieu,
        thuyet_minh: '',
        cuoi_nam: values[line.ma] ?? 0,
        dau_nam: 0,
        ghi_chu: ''
    }));
}

async function fetchVoucherFormData(query = {}, store = null, mau = '') {
    const phieuId = String(query.phieu_id || '').trim();
    if (!phieuId || !mongoose.Types.ObjectId.isValid(phieuId)) {
        return { missingPhieu: true, rows: [] };
    }

    const filter = { _id: phieuId, ...storeFilter(store) };
    const receipt = await PhieuThuChi.findOne(filter)
        .populate('so_quy_id', 'ten_so_quy')
        .populate('khach_hang_id', 'ten_khach_hang dia_chi')
        .populate('nha_cung_cap_id', 'ten_ncc')
        .lean();

    if (!receipt) return { missingPhieu: true, rows: [] };

    const amount = roundMoney(receipt.gia_tri);
    const personName = receipt.doi_tuong
        || receipt.khach_hang_id?.ten_khach_hang
        || receipt.nha_cung_cap_id?.ten_ncc
        || '';
    const address = receipt.khach_hang_id?.dia_chi || '';
    const reason = receipt.loai_thu_chi || receipt.ghi_chu || '';
    const relatedDoc = receipt.chung_tu_khac || receipt.ma_chung_tu_goc || '';

    return {
        missingPhieu: false,
        mau,
        ngay_so: `${formatDateLong(receipt.ngay_lap)}        Số: ${receipt.ma_phieu || '........'}`,
        person_label: mau === '01-TT' ? 'Họ tên người nộp tiền:' : (mau === '02-TT' ? 'Họ tên người nhận tiền:' : (mau === '01-VT' ? 'Họ tên người giao hàng:' : 'Họ tên người nhận hàng:')),
        person_name: personName,
        address,
        reason,
        amount,
        amount_text: numberToVietnameseWords(amount),
        detail_rows: [{
            stt: 1,
            noi_dung: reason || (receipt.loai_phieu === 'thu' ? 'Thu tiền' : 'Chi tiền'),
            tai_khoan: receipt.so_quy_id?.ten_so_quy || paymentMethodLabel(receipt.phuong_thuc_thanh_toan),
            so_tien: amount,
            chung_tu_lien_quan: relatedDoc,
            doi_tuong: personName,
            ghi_chu: receipt.ghi_chu || ''
        }]
    };
}

async function buildMauDataset(mau, query = {}, store = null, range = null, helpers = {}) {
    const invoiceRows = helpers.invoiceRows
        || (helpers.fetchInvoiceLedgerRows
            ? await helpers.fetchInvoiceLedgerRows({ range }, store)
            : []);

    switch (mau) {
        case 'S2b-DNSN':
            return { rows: await fetchRevenueExpenseRows(range, store) };
        case 'S2d-DNSN':
            return {
                rows: await fetchCashLedgerRows(range, store, query),
                filters: await loadS2dFilterOptions(store)
            };
        case 'S3b-DNSN':
            return { rows: await fetchVatTrackingRows(range, store, invoiceRows) };
        case 'S4a-DNSN':
            return { rows: await fetchDebtLedgerRows(range, store) };
        case 'B02-DNSN':
            return { rows: buildB02Rows(await fetchPeriodAggregates(range, store)) };
        case 'B01-DNSN':
            return { rows: buildB01Rows(await fetchBalanceAggregates(store)) };
        case '01-TT':
        case '02-TT':
        case '01-VT':
        case '02-VT':
            return {
                ...(await fetchVoucherFormData(query, store, mau)),
                filters: await loadVoucherFilterOptions(store)
            };
        default:
            return { rows: [] };
    }
}

module.exports = {
    VOUCHER_MAU,
    LANDSCAPE_MAU,
    B02_LINES,
    B01_LINES,
    roundMoney,
    formatDate,
    formatDateLong,
    loadS2dFilterOptions,
    loadVoucherFilterOptions,
    fetchRevenueExpenseRows,
    fetchCashLedgerRows,
    fetchVatTrackingRows,
    fetchDebtLedgerRows,
    fetchPeriodAggregates,
    fetchBalanceAggregates,
    buildB02Rows,
    buildB01Rows,
    fetchVoucherFormData,
    buildMauDataset
};
