/**
 * Nguồn dữ liệu PDF cho Báo cáo Thông tư 58/2026/TT-BTC.
 *
 * Chỉ phục vụ phần PDF (/bao-cao/58/preview.pdf, /bao-cao/58/export.pdf).
 * Không dùng cho Excel/CSV — phần đó vẫn đi qua report58Excel.service.js.
 *
 * Quy ước chung:
 * - Mỗi mẫu có một builder riêng, trả về { view, landscape, locals }.
 * - locals luôn có: mauSo, title, storeInfo, periodLabel, warnings[], notes[].
 * - Không lấy chứng từ cancelled; không lấy draft vào sổ/báo cáo chính thức.
 * - Không hardcode thuế suất: mọi logic thuế đi qua getConfiguredVatRate().
 * - Chỉ tiêu nào DB chưa có dữ liệu → hiển thị '—' / 0 kèm ghi chú, không bịa số.
 */

const mongoose = require('mongoose');
const {
    Kho,
    HangHoa,
    KhachHang,
    NhaCungCap,
    PhieuNhap,
    CTPhieuNhap,
    HoaDonBanHang,
    CTHoaDonBanHang,
    PhieuTraHang,
    PhieuThuChi,
    GiaoDichCongNoKhachHang,
    GiaoDichCongNoNhaCungCap,
    LichSuKho,
    LoHang,
    PhieuKiemKho,
    CTPhieuKiemKho,
    PhieuXuatHuy,
    CTXuatHuy,
    PhieuXuatNoiBo,
    CTXuatNoiBo
} = require('../models/kiot.model');
const { numberToVietnameseWords } = require('../utils/numberToVietnameseWords');
const { formatLotName } = require('../utils/kiemKhoDisplay');

const NOTICE_VIEW = 'report58-pdf-notice.ejs';
const LEDGER_VIEW = 'report58-pdf-ledger.ejs';
const VOUCHER_TT_VIEW = 'report58-pdf-voucher-tt.ejs';
const VOUCHER_VT_VIEW = 'report58-pdf-voucher-vt.ejs';

const MAU_TITLES = {
    'S1-DNSN': 'SỔ DOANH THU BÁN HÀNG HÓA, DỊCH VỤ',
    'S2a-DNSN': 'SỔ DOANH THU BÁN HÀNG HÓA, DỊCH VỤ',
    'S3a-DNSN': 'SỔ DOANH THU BÁN HÀNG HÓA, DỊCH VỤ',
    'S2b-DNSN': 'SỔ CHI TIẾT DOANH THU, CHI PHÍ',
    'S2c-DNSN': 'SỔ CHI TIẾT VẬT LIỆU, DỤNG CỤ, SẢN PHẨM, HÀNG HÓA',
    'S2d-DNSN': 'SỔ CHI TIẾT TIỀN',
    'S3b-DNSN': 'SỔ THEO DÕI NGHĨA VỤ THUẾ GTGT',
    'S4a-DNSN': 'SỔ CHI TIẾT THANH TOÁN CÔNG NỢ',
    'S4b-DNSN': 'SỔ TÀI SẢN CỐ ĐỊNH',
    'S4c-DNSN': 'SỔ THEO DÕI NGHĨA VỤ THUẾ KHÁC',
    'S4d-DNSN': 'SỔ THEO DÕI VỐN CHỦ SỞ HỮU',
    'B01-DNSN': 'BÁO CÁO TÌNH HÌNH TÀI CHÍNH',
    'B02-DNSN': 'BÁO CÁO KẾT QUẢ HOẠT ĐỘNG KINH DOANH',
    '01-TT': 'PHIẾU THU',
    '02-TT': 'PHIẾU CHI',
    '01-VT': 'PHIẾU NHẬP KHO',
    '02-VT': 'PHIẾU XUẤT KHO'
};

// ===========================================================================
// Helpers chung
// ===========================================================================

function isObjectId(value) {
    return mongoose.Types.ObjectId.isValid(String(value || ''));
}

function roundMoney(value) {
    return Math.round(Number(value) || 0);
}

/** Format tiền 1.000.000; null/undefined → '—'. */
function fmtMoney(value) {
    if (value === null || value === undefined || value === '') return '—';
    const num = Number(value);
    if (!Number.isFinite(num)) return '—';
    return Math.round(num).toLocaleString('vi-VN');
}

function fmtQty(value) {
    if (value === null || value === undefined || value === '') return '';
    const num = Number(value);
    if (!Number.isFinite(num)) return '';
    if (Number.isInteger(num)) return num.toLocaleString('vi-VN');
    return num.toLocaleString('vi-VN', { maximumFractionDigits: 3 });
}

function fmtDate(value) {
    if (!value) return '';
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('vi-VN');
}

function fmtDateLong(value) {
    if (!value) return 'Ngày .... tháng .... năm ....';
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return 'Ngày .... tháng .... năm ....';
    return `Ngày ${date.getDate()} tháng ${date.getMonth() + 1} năm ${date.getFullYear()}`;
}

function safeText(value, fallback = '') {
    const text = String(value ?? '').trim();
    return text || fallback;
}

function pickQueryParam(value) {
    if (value == null || value === '') return '';
    if (Array.isArray(value)) {
        const parts = value
            .map(item => String(item ?? '').trim())
            .filter(Boolean);
        return parts.length ? parts[parts.length - 1] : '';
    }
    return String(value).trim();
}

function storeFilter(store) {
    return store?._id ? { cua_hang_id: store._id } : {};
}

function rangeFilter(range, field) {
    const start = range?.start ? new Date(range.start) : new Date();
    const end = range?.end ? new Date(range.end) : new Date();
    return { [field]: { $gte: start, $lt: end } };
}

function periodBounds(range) {
    const end = range?.end ? new Date(range.end) : new Date();
    const start = range?.start ? new Date(range.start) : new Date(end.getTime() - 7 * 86400000);
    return { start, end };
}

function buildStoreInfo(store) {
    return {
        ten_cua_hang: safeText(store?.ten_cua_hang),
        dia_chi: safeText(store?.dia_chi_day_du) || [
            store?.dia_chi_chi_tiet,
            store?.phuong_xa,
            store?.tinh_thanh
        ].filter(Boolean).join(', '),
        ma_so_thue: safeText(store?.ma_so_thue),
        sdt: safeText(store?.sdt)
    };
}

function buildPeriodLabel(range) {
    if (range?.from && range?.to) {
        return `Từ ngày ${fmtDate(`${range.from}T00:00:00`)} đến hết ngày ${fmtDate(`${range.to}T00:00:00`)}`;
    }
    return '';
}

/**
 * Thuế suất GTGT theo cấu hình hệ thống.
 * Hiện DB CHƯA có cấu hình phương pháp thuế / thuế suất theo chứng từ,
 * nên trả về null → các builder hiển thị '—'/0 kèm ghi chú, không tự tính 5%.
 */
function getConfiguredVatRate() {
    return null;
}

const VAT_MISSING_NOTE = 'Hệ thống chưa có cấu hình thuế GTGT theo chứng từ, số liệu thuế chỉ hiển thị khi có cấu hình/dữ liệu thuế.';
const TAX_METHOD_NOTE = 'Hệ thống chưa có cấu hình phương pháp tính thuế của doanh nghiệp; cần xác nhận mẫu sổ doanh thu áp dụng (S1/S2a/S3a) trước khi dùng làm sổ chính thức.';

/** Doanh thu sau giảm giá của một hóa đơn. */
function invoiceRevenue(invoice) {
    if (invoice == null) return 0;
    if (invoice.thanh_toan !== undefined && invoice.thanh_toan !== null) {
        return roundMoney(invoice.thanh_toan);
    }
    return roundMoney(Number(invoice.tong_tien || 0) - Number(invoice.giam_gia || 0));
}

/** Giá trị giảm trừ doanh thu của một phiếu trả hàng bán. */
function returnDeduction(slip) {
    const value = Number(slip?.tong_tien_hang_tra || 0) || Number(slip?.tong_tien_tra || 0);
    return roundMoney(value);
}

const PAYMENT_METHOD_LABELS = {
    tien_mat: 'Tiền mặt',
    chuyen_khoan: 'Chuyển khoản',
    vi_dien_tu: 'Ví điện tử',
    khac: 'Khác'
};

const NHOM_DOI_TUONG_LABELS = {
    khach_hang: 'Khách hàng',
    nha_cung_cap: 'Nhà cung cấp',
    doi_tac_giao_hang: 'Đối tác giao hàng',
    nhan_vien: 'Nhân viên',
    khac: 'Khác'
};

const LOAI_PHIEU_KHO_LABELS = {
    nhap_hang: 'Nhập hàng',
    tra_hang_nhap: 'Trả hàng nhập',
    tra_hang: 'Trả hàng bán',
    kiem_kho: 'Kiểm kho',
    ban_hang: 'Bán hàng',
    xuat_huy: 'Xuất hủy',
    xuat_noi_bo: 'Xuất dùng nội bộ',
    dieu_chinh: 'Điều chỉnh tồn kho'
};

/** Filter lịch sử kho cấp tổng (tránh đếm trùng bản ghi cấp lô/quy cách). */
const TONG_LEVEL_FILTER = {
    $or: [
        { cap_ton: 'tong' },
        { cap_ton: null },
        { cap_ton: { $exists: false } }
    ]
};

function baseLocals(mau, store, range, extra = {}) {
    return {
        mau,
        mauSo: `Mẫu số ${mau}`,
        title: MAU_TITLES[mau] || mau,
        storeInfo: buildStoreInfo(store),
        periodLabel: buildPeriodLabel(range),
        donViTinh: 'Đồng',
        warnings: [],
        notes: [],
        ...extra
    };
}

function noticeResult(mau, store, range, message, notes = []) {
    return {
        view: NOTICE_VIEW,
        landscape: false,
        locals: {
            ...baseLocals(mau, store, range),
            message,
            notes
        }
    };
}

// ===========================================================================
// 01-TT / 02-TT — Phiếu thu / Phiếu chi (PhieuThuChi)
// ===========================================================================

function collectRelatedDocuments(receipt) {
    const docs = [];
    const push = (label, code) => {
        const text = safeText(code);
        if (text) docs.push({ label, code: text });
    };
    push('Hóa đơn bán hàng', receipt.hoa_don_id?.ma_hoa_don);
    push('Đơn hàng', receipt.don_hang_id?.ma_don_hang);
    push('Phiếu nhập hàng', receipt.phieu_nhap_id?.ma_phieu_nhap);
    push('Phiếu trả hàng bán', receipt.phieu_tra_hang_id?.ma_phieu_tra);
    push('Phiếu trả hàng nhập', receipt.phieu_tra_hang_nhap_id?.ma_phieu_tra_nhap);
    push('Vận đơn', receipt.van_don_id?.ma_van_don);
    if (Array.isArray(receipt.allocations)) {
        receipt.allocations.forEach(alloc => {
            const code = safeText(alloc?.ma_phieu_nhap);
            if (code && !docs.some(d => d.code === code)) {
                docs.push({
                    label: 'Phân bổ phiếu nhập',
                    code,
                    amount: roundMoney(alloc.so_tien)
                });
            }
        });
    }
    if (!docs.length) {
        const fallback = safeText(receipt.ma_chung_tu_goc);
        if (fallback) docs.push({ label: 'Chứng từ gốc', code: fallback });
    }
    return docs;
}

async function buildVoucherTtPdfData(mau, query, store, range) {
    const expectedType = mau === '01-TT' ? 'thu' : 'chi';
    const phieuId = pickQueryParam(query.phieu_id);

    if (!phieuId || !isObjectId(phieuId)) {
        return noticeResult(mau, store, range,
            `Chọn một ${expectedType === 'thu' ? 'phiếu thu' : 'phiếu chi'} ở bộ lọc để in mẫu ${mau}.`);
    }

    const receipt = await PhieuThuChi.findOne({ _id: phieuId, ...storeFilter(store) })
        .populate('so_quy_id', 'ten_so_quy')
        .populate('khach_hang_id', 'ten_khach_hang dia_chi')
        .populate('nha_cung_cap_id', 'ten_ncc dia_chi')
        .populate('nhan_vien_id', 'ho_ten')
        .populate('doi_tac_giao_hang_id', 'ten_doi_tac')
        .populate('nguoi_tao_id', 'ho_ten email')
        .populate('hoa_don_id', 'ma_hoa_don')
        .populate('don_hang_id', 'ma_don_hang')
        .populate('phieu_nhap_id', 'ma_phieu_nhap')
        .populate('phieu_tra_hang_id', 'ma_phieu_tra')
        .populate('phieu_tra_hang_nhap_id', 'ma_phieu_tra_nhap')
        .populate('van_don_id', 'ma_van_don')
        .lean();

    if (!receipt) {
        return noticeResult(mau, store, range, 'Không tìm thấy phiếu thu/chi trong cửa hàng hiện tại.');
    }
    if (receipt.loai_phieu !== expectedType) {
        const actual = receipt.loai_phieu === 'thu' ? 'phiếu thu' : 'phiếu chi';
        const suggestion = receipt.loai_phieu === 'thu' ? '01-TT' : '02-TT';
        return noticeResult(mau, store, range,
            `Phiếu ${safeText(receipt.ma_phieu)} là ${actual} — không in được trên mẫu ${mau}. Hãy chọn mẫu ${suggestion}.`);
    }
    if (receipt.trang_thai === 'cancelled') {
        return noticeResult(mau, store, range,
            `Phiếu ${safeText(receipt.ma_phieu)} đã bị hủy${receipt.ly_do_huy ? ` (lý do: ${receipt.ly_do_huy})` : ''} — không in chứng từ đã hủy.`);
    }

    // Phiếu chi luôn in số dương: tiêu đề "PHIẾU CHI" đã thể hiện chiều tiền ra.
    const amount = Math.abs(roundMoney(receipt.gia_tri));
    const detail = receipt.chi_tiet_thanh_toan || {};
    const tienMat = Math.max(0, roundMoney(detail.tien_mat));
    const chuyenKhoan = Math.max(0, roundMoney(detail.chuyen_khoan));
    const tienTraKhach = Math.max(0, roundMoney(detail.tien_tra_khach));
    const tongChiTiet = tienMat + chuyenKhoan;
    const giaTriRong = tongChiTiet - tienTraKhach;
    const hasPaymentDetail = tongChiTiet > 0 || tienTraKhach > 0;

    const personName = safeText(receipt.doi_tuong)
        || safeText(receipt.khach_hang_id?.ten_khach_hang)
        || safeText(receipt.nha_cung_cap_id?.ten_ncc)
        || safeText(receipt.nhan_vien_id?.ho_ten)
        || safeText(receipt.doi_tac_giao_hang_id?.ten_doi_tac);
    const personAddress = safeText(receipt.khach_hang_id?.dia_chi)
        || safeText(receipt.nha_cung_cap_id?.dia_chi);

    const warnings = [];
    if (hasPaymentDetail && Math.abs(giaTriRong - amount) > 0.5) {
        warnings.push(`Chi tiết thanh toán (tiền mặt + chuyển khoản − tiền trả khách = ${fmtMoney(giaTriRong)}) đang lệch với giá trị phiếu ${fmtMoney(amount)}.`);
    }

    const notes = [];
    if (receipt.hach_toan === false) {
        notes.push('Phiếu không tính vào kết quả hoạt động kinh doanh (không hạch toán).');
    }

    return {
        view: VOUCHER_TT_VIEW,
        landscape: false,
        locals: {
            ...baseLocals(mau, store, range),
            warnings,
            notes,
            voucher: {
                loai_phieu: receipt.loai_phieu,
                ma_phieu: safeText(receipt.ma_phieu),
                ngay_lap: receipt.ngay_lap,
                ngay_lap_text: fmtDateLong(receipt.ngay_lap),
                person_label: expectedType === 'thu' ? 'Họ và tên người nộp tiền' : 'Họ và tên người nhận tiền',
                person_name: personName,
                person_address: personAddress,
                nhom_doi_tuong: NHOM_DOI_TUONG_LABELS[receipt.nhom_doi_tuong] || safeText(receipt.nhom_doi_tuong),
                ly_do: safeText(receipt.loai_thu_chi) || safeText(receipt.ghi_chu)
                    || (expectedType === 'thu' ? 'Thu tiền' : 'Chi tiền'),
                amount,
                amount_text: fmtMoney(amount),
                amount_words: numberToVietnameseWords(amount),
                phuong_thuc: PAYMENT_METHOD_LABELS[receipt.phuong_thuc_thanh_toan] || safeText(receipt.phuong_thuc_thanh_toan),
                so_quy: safeText(receipt.so_quy_id?.ten_so_quy),
                nguoi_lap: safeText(receipt.nguoi_tao_id?.ho_ten) || safeText(receipt.nguoi_tao_id?.email),
                ghi_chu: safeText(receipt.ghi_chu),
                hach_toan: receipt.hach_toan !== false,
                payment_detail: hasPaymentDetail ? {
                    tien_mat: fmtMoney(tienMat),
                    chuyen_khoan: fmtMoney(chuyenKhoan),
                    tien_tra_khach: fmtMoney(tienTraKhach),
                    tong_label: expectedType === 'thu' ? 'Tổng khách đưa' : 'Tổng thanh toán',
                    tong: fmtMoney(tongChiTiet),
                    rong_label: expectedType === 'thu' ? 'Thực thu' : 'Giá trị ròng',
                    rong: fmtMoney(giaTriRong)
                } : null,
                related_docs: collectRelatedDocuments(receipt)
            }
        }
    };
}

// ===========================================================================
// 01-VT — Phiếu nhập kho (PhieuNhap + CTPhieuNhap)
// ===========================================================================

function lotDisplayName(lotDoc, lotInfo) {
    const fromDoc = formatLotName(lotDoc);
    if (fromDoc) return fromDoc;
    const ten = safeText(lotInfo?.ten_lo);
    const ma = safeText(lotInfo?.ma_lo);
    if (ten) return ten;
    if (ma) return ma;
    if (lotInfo) return 'Lô không tên';
    return '';
}

function buildPurchaseLineRows(lines) {
    const rows = [];
    lines.forEach(line => {
        const product = line.hang_hoa_id || {};
        const unit = line.don_vi_tinh_id || {};
        const lotInfo = line.lot_info && typeof line.lot_info === 'object' ? line.lot_info : null;
        const lotName = lotDisplayName(line.lo_hang_id, lotInfo);
        const expiry = line.lo_hang_id?.han_su_dung || lotInfo?.han_su_dung || null;
        const quyCachItems = Array.isArray(lotInfo?.quy_cach_items)
            ? lotInfo.quy_cach_items.filter(item => item && safeText(item.ten_quy_cach))
            : [];

        const base = {
            ma_hang: safeText(product.ma_hang),
            ten_hang: safeText(product.ten_hang),
            dvt: safeText(unit.ten_don_vi) || safeText(unit.ma_don_vi),
            lo: lotName,
            han_su_dung: fmtDate(expiry),
            ghi_chu: safeText(line.ghi_chu)
        };

        if (quyCachItems.length) {
            // Tách dòng theo từng quy cách trong lô để không gộp mất quy cách.
            quyCachItems.forEach(item => {
                const qty = Number(item.so_luong || 0);
                const price = Number(item.don_gia ?? line.don_gia_nhap ?? 0);
                rows.push({
                    ...base,
                    quy_cach: safeText(item.ten_quy_cach),
                    so_luong: qty,
                    don_gia: price,
                    thanh_tien: roundMoney(qty * price)
                });
            });
            return;
        }

        const qty = Number(line.so_luong || 0);
        const price = Number(line.don_gia_nhap || 0);
        rows.push({
            ...base,
            quy_cach: '',
            so_luong: qty,
            don_gia: price,
            thanh_tien: roundMoney(line.thanh_tien ?? qty * price)
        });
    });
    return rows;
}

async function build01VtPdfData(query, store, range) {
    const mau = '01-VT';
    const phieuId = pickQueryParam(query.phieu_nhap_id) || pickQueryParam(query.phieu_id);

    if (!phieuId || !isObjectId(phieuId)) {
        return noticeResult(mau, store, range,
            'Chọn một phiếu nhập hàng ở bộ lọc bên trái để in mẫu 01-VT (Phiếu nhập kho).');
    }

    const purchase = await PhieuNhap.findOne({ _id: phieuId, ...storeFilter(store) })
        .populate('kho_id', 'ten_kho dia_chi_day_du dia_chi')
        .populate('nha_cung_cap_id', 'ten_ncc dia_chi')
        .populate('nguoi_tao_id', 'ho_ten email')
        .lean();

    if (!purchase) {
        return noticeResult(mau, store, range, 'Không tìm thấy phiếu nhập hàng trong cửa hàng hiện tại.');
    }
    if (purchase.trang_thai === 'cancelled') {
        return noticeResult(mau, store, range,
            `Phiếu nhập ${safeText(purchase.ma_phieu_nhap)} đã bị hủy — không in chứng từ đã hủy.`);
    }

    const lines = await CTPhieuNhap.find({ phieu_nhap_id: purchase._id })
        .populate('hang_hoa_id', 'ma_hang ten_hang')
        .populate('don_vi_tinh_id', 'ten_don_vi ma_don_vi')
        .populate('lo_hang_id', 'ten_lo ma_lo han_su_dung')
        .lean();

    const rows = buildPurchaseLineRows(lines);
    const totalQty = rows.reduce((sum, row) => sum + Number(row.so_luong || 0), 0);
    const totalValue = roundMoney(purchase.tong_tien_hang)
        || rows.reduce((sum, row) => sum + Number(row.thanh_tien || 0), 0);
    const grandTotal = roundMoney(purchase.tong_tien) || totalValue;

    const warnings = [];
    const isDraft = purchase.trang_thai === 'draft';
    if (isDraft) {
        warnings.push('Phiếu nhập này đang ở trạng thái nháp. Bản in chỉ dùng để kiểm tra, chưa phải chứng từ chính thức.');
    }
    if (!rows.length) {
        warnings.push('Phiếu nhập không có dòng hàng hóa chi tiết.');
    }

    return {
        view: VOUCHER_VT_VIEW,
        landscape: false,
        locals: {
            ...baseLocals(mau, store, range),
            warnings,
            voucher: {
                direction: 'nhap',
                is_draft: isDraft,
                ma_phieu: safeText(purchase.ma_phieu_nhap),
                ngay_text: fmtDateLong(purchase.ngay_nhap),
                kho_label: 'Nhập tại kho',
                kho: safeText(purchase.kho_id?.ten_kho),
                kho_dia_chi: safeText(purchase.kho_id?.dia_chi_day_du) || safeText(purchase.kho_id?.dia_chi),
                partner_label: 'Họ tên người giao hàng',
                partner: safeText(purchase.nha_cung_cap_id?.ten_ncc),
                partner_extra: safeText(purchase.nha_cung_cap_id?.dia_chi),
                ly_do: safeText(purchase.ghi_chu) || 'Nhập hàng từ nhà cung cấp',
                nguoi_lap: safeText(purchase.nguoi_tao_id?.ho_ten) || safeText(purchase.nguoi_tao_id?.email),
                rows,
                totals: {
                    so_luong: totalQty,
                    tien_hang: totalValue,
                    giam_gia: roundMoney(purchase.giam_gia),
                    tong_thanh_toan: grandTotal,
                    da_tra: roundMoney(purchase.da_tra_ncc),
                    con_no: roundMoney(purchase.con_no_ncc)
                },
                amount_words: numberToVietnameseWords(grandTotal),
                sign_giver_label: 'Người giao hàng',
                sign_receiver_label: 'Thủ kho'
            }
        }
    };
}

// ===========================================================================
// 02-VT — Phiếu xuất kho (hóa đơn bán / xuất hủy / xuất nội bộ / kiểm kho giảm)
// ===========================================================================

const EXPORT_SOURCE_TYPES = ['hoa_don', 'xuat_huy', 'xuat_noi_bo', 'kiem_kho'];

function parseExportSource(query) {
    let sourceType = pickQueryParam(query.sourceType) || pickQueryParam(query.source_type);
    let id = pickQueryParam(query.id) || pickQueryParam(query.phieu_id);
    const combined = pickQueryParam(query.xuat_ref);
    if (combined && combined.includes(':')) {
        const [type, refId] = combined.split(':');
        if (!sourceType) sourceType = safeText(type);
        if (!id) id = safeText(refId);
    }
    return { sourceType, id };
}

async function detectExportSource(id, store) {
    const sf = storeFilter(store);
    const activeCheckFilter = { $or: [{ deleted_at: null }, { deleted_at: { $exists: false } }] };
    const [invoice, destroy, internal, check] = await Promise.all([
        HoaDonBanHang.exists({ _id: id, ...sf }),
        PhieuXuatHuy.exists({ _id: id, ...sf }),
        PhieuXuatNoiBo.exists({ _id: id, ...sf }),
        PhieuKiemKho.exists({ _id: id, ...sf, ...activeCheckFilter })
    ]);
    if (invoice) return 'hoa_don';
    if (destroy) return 'xuat_huy';
    if (internal) return 'xuat_noi_bo';
    if (check) return 'kiem_kho';
    return '';
}

function exportRowBase(line) {
    const product = line.hang_hoa_id || {};
    return {
        ma_hang: safeText(product.ma_hang),
        ten_hang: safeText(product.ten_hang) || safeText(line.ten_hang_snapshot),
        dvt: safeText(line.don_vi_tinh_id?.ten_don_vi)
            || safeText(line.don_vi_tinh_id?.ma_don_vi)
            || safeText(line.don_vi_tinh_snapshot),
        lo: formatLotName(line.lo_hang_id) || '',
        quy_cach: safeText(line.ten_quy_cach) || safeText(line.ten_thuoc_tinh),
        ghi_chu: safeText(line.ghi_chu)
    };
}

async function loadExportFromInvoice(id, store) {
    const invoice = await HoaDonBanHang.findOne({ _id: id, ...storeFilter(store) })
        .populate('kho_id', 'ten_kho')
        .populate('khach_hang_id', 'ten_khach_hang')
        .populate('nguoi_ban_id', 'ho_ten email')
        .lean();
    if (!invoice) return null;
    if (invoice.trang_thai === 'cancelled') {
        return { cancelled: true, code: safeText(invoice.ma_hoa_don) };
    }

    const lines = await CTHoaDonBanHang.find({ hoa_don_id: invoice._id })
        .populate('hang_hoa_id', 'ma_hang ten_hang')
        .populate('don_vi_tinh_id', 'ten_don_vi ma_don_vi')
        .populate('lo_hang_id', 'ten_lo ma_lo')
        .lean();

    const rows = [];
    lines.forEach(line => {
        const base = exportRowBase(line);
        const allocations = Array.isArray(line.lot_allocations)
            ? line.lot_allocations.filter(a => a && Number(a.so_luong || 0) > 0)
            : [];
        const price = Number(line.don_gia || 0);

        if (allocations.length) {
            // Hiển thị lô theo lot_allocations đã lưu lúc bán, không suy từ lịch sử kho.
            allocations.forEach(alloc => {
                const qty = Number(alloc.so_luong || 0);
                rows.push({
                    ...base,
                    lo: formatLotName(alloc) || base.lo || 'Lô không tên',
                    so_luong: qty,
                    don_gia: price,
                    thanh_tien: roundMoney(qty * price)
                });
            });
            return;
        }
        const qty = Number(line.so_luong || 0);
        rows.push({
            ...base,
            so_luong: qty,
            don_gia: price,
            thanh_tien: roundMoney(line.thanh_tien ?? qty * price)
        });
    });

    return {
        ma_phieu: safeText(invoice.ma_hoa_don),
        ngay: invoice.ngay_ban,
        kho: safeText(invoice.kho_id?.ten_kho),
        partner_label: 'Họ tên người nhận hàng',
        partner: safeText(invoice.khach_hang_id?.ten_khach_hang) || 'Khách lẻ',
        ly_do: 'Xuất kho bán hàng',
        nguoi_lap: safeText(invoice.nguoi_ban_id?.ho_ten) || safeText(invoice.nguoi_ban_id?.email),
        rows,
        total_value: invoiceRevenue(invoice)
    };
}

async function loadExportFromDestroy(id, store) {
    const ticket = await PhieuXuatHuy.findOne({ _id: id, ...storeFilter(store) })
        .populate('kho_id', 'ten_kho')
        .populate('nguoi_tao_id', 'ho_ten email')
        .lean();
    if (!ticket) return null;
    if (ticket.trang_thai === 'cancelled') {
        return { cancelled: true, code: safeText(ticket.ma_xuat_huy) };
    }

    const lines = await CTXuatHuy.find({ phieu_xuat_huy_id: ticket._id })
        .populate('hang_hoa_id', 'ma_hang ten_hang')
        .populate('lo_hang_id', 'ten_lo ma_lo')
        .lean();

    const rows = lines.map(line => {
        const qty = Number(line.so_luong || 0);
        const price = Number(line.gia_von || 0);
        return {
            ...exportRowBase(line),
            so_luong: qty,
            don_gia: price,
            thanh_tien: roundMoney(line.thanh_tien ?? qty * price)
        };
    });

    return {
        ma_phieu: safeText(ticket.ma_xuat_huy),
        ngay: ticket.ngay_xuat,
        kho: safeText(ticket.kho_id?.ten_kho),
        partner_label: 'Người đề nghị/thực hiện hủy',
        partner: safeText(ticket.nguoi_tao_id?.ho_ten) || safeText(ticket.nguoi_tao_id?.email),
        ly_do: safeText(ticket.ly_do_huy) || 'Xuất hủy hàng hóa',
        nguoi_lap: safeText(ticket.nguoi_tao_id?.ho_ten) || safeText(ticket.nguoi_tao_id?.email),
        rows,
        total_value: roundMoney(ticket.tong_gia_tri),
        draft: ticket.trang_thai === 'draft'
    };
}

async function loadExportFromInternal(id, store) {
    const ticket = await PhieuXuatNoiBo.findOne({ _id: id, ...storeFilter(store) })
        .populate('kho_id', 'ten_kho')
        .populate('nguoi_tao_id', 'ho_ten email')
        .lean();
    if (!ticket) return null;
    if (ticket.trang_thai === 'cancelled') {
        return { cancelled: true, code: safeText(ticket.ma_xuat_noi_bo) };
    }

    const lines = await CTXuatNoiBo.find({ phieu_xuat_id: ticket._id })
        .populate('hang_hoa_id', 'ma_hang ten_hang')
        .populate('lo_hang_id', 'ten_lo ma_lo')
        .lean();

    const rows = lines.map(line => {
        const qty = Number(line.so_luong || 0);
        const price = Number(line.gia_von || 0);
        return {
            ...exportRowBase(line),
            so_luong: qty,
            don_gia: price,
            thanh_tien: roundMoney(line.thanh_tien ?? qty * price)
        };
    });

    return {
        ma_phieu: safeText(ticket.ma_xuat_noi_bo),
        ngay: ticket.ngay_xuat,
        kho: safeText(ticket.kho_id?.ten_kho),
        partner_label: 'Họ tên người nhận hàng',
        partner: safeText(ticket.nguoi_nhan),
        ly_do: safeText(ticket.loai_xuat) || safeText(ticket.ghi_chu) || 'Xuất dùng nội bộ',
        nguoi_lap: safeText(ticket.nguoi_tao_id?.ho_ten) || safeText(ticket.nguoi_tao_id?.email),
        rows,
        total_value: roundMoney(ticket.tong_gia_tri),
        draft: ticket.trang_thai === 'draft'
    };
}

async function loadExportFromInventoryCheck(id, store) {
    const ticket = await PhieuKiemKho.findOne({
        _id: id,
        ...storeFilter(store),
        $or: [{ deleted_at: null }, { deleted_at: { $exists: false } }]
    })
        .populate('kho_id', 'ten_kho')
        .populate('nguoi_tao_id', 'ho_ten email')
        .lean();
    if (!ticket) return null;
    if (ticket.trang_thai === 'cancelled') {
        return { cancelled: true, code: safeText(ticket.ma_kiem_kho) };
    }

    const lines = await CTPhieuKiemKho.find({ phieu_kiem_kho_id: ticket._id })
        .populate('hang_hoa_id', 'ma_hang ten_hang gia_von')
        .populate('lo_hang_id', 'ten_lo ma_lo gia_von')
        .lean();

    // Mẫu 02-VT chỉ thể hiện phần lệch GIẢM (xuất khỏi kho) của phiếu kiểm.
    const rows = lines
        .filter(line => Number(line.so_luong_lech || 0) < 0)
        .map(line => {
            const qty = Math.abs(Number(line.so_luong_lech || 0));
            const value = Math.abs(Number(line.gia_tri_lech || 0));
            const price = qty > 0 ? value / qty : Number(line.lo_hang_id?.gia_von || line.hang_hoa_id?.gia_von || 0);
            return {
                ...exportRowBase(line),
                so_luong: qty,
                don_gia: roundMoney(price),
                thanh_tien: roundMoney(value || qty * price),
                ghi_chu: safeText(line.nguyen_nhan_lech)
            };
        });

    return {
        ma_phieu: safeText(ticket.ma_kiem_kho),
        ngay: ticket.ngay_kiem,
        kho: safeText(ticket.kho_id?.ten_kho),
        partner_label: 'Người kiểm kho',
        partner: safeText(ticket.nguoi_tao_id?.ho_ten) || safeText(ticket.nguoi_tao_id?.email),
        ly_do: 'Xuất điều chỉnh giảm theo kết quả kiểm kho',
        nguoi_lap: safeText(ticket.nguoi_tao_id?.ho_ten) || safeText(ticket.nguoi_tao_id?.email),
        rows,
        total_value: rows.reduce((sum, row) => sum + Number(row.thanh_tien || 0), 0),
        extra_note: 'Chỉ thể hiện các dòng lệch giảm của phiếu kiểm kho.'
    };
}

async function build02VtPdfData(query, store, range) {
    const mau = '02-VT';
    let { sourceType, id } = parseExportSource(query);

    if (!id || !isObjectId(id)) {
        return noticeResult(mau, store, range,
            'Chọn một chứng từ xuất kho (hóa đơn bán, xuất hủy, xuất nội bộ, kiểm kho giảm) để in mẫu 02-VT.');
    }
    if (!sourceType) {
        sourceType = await detectExportSource(id, store);
    }
    if (!EXPORT_SOURCE_TYPES.includes(sourceType)) {
        return noticeResult(mau, store, range, 'Chưa xác định nguồn chứng từ xuất kho.');
    }

    const loaders = {
        hoa_don: loadExportFromInvoice,
        xuat_huy: loadExportFromDestroy,
        xuat_noi_bo: loadExportFromInternal,
        kiem_kho: loadExportFromInventoryCheck
    };
    const data = await loaders[sourceType](id, store);

    if (!data) {
        return noticeResult(mau, store, range, 'Không tìm thấy chứng từ xuất kho trong cửa hàng hiện tại.');
    }
    if (data.cancelled) {
        return noticeResult(mau, store, range,
            `Chứng từ ${data.code || ''} đã bị hủy — không in chứng từ đã hủy.`);
    }

    const totalQty = data.rows.reduce((sum, row) => sum + Number(row.so_luong || 0), 0);
    const totalValue = roundMoney(data.total_value)
        || data.rows.reduce((sum, row) => sum + Number(row.thanh_tien || 0), 0);

    const warnings = [];
    if (data.draft) warnings.push('Chứng từ đang ở trạng thái NHÁP — chưa trừ tồn kho chính thức.');
    if (!data.rows.length) warnings.push('Chứng từ không có dòng hàng hóa xuất.');

    const notes = [];
    if (data.extra_note) notes.push(data.extra_note);

    return {
        view: VOUCHER_VT_VIEW,
        landscape: false,
        locals: {
            ...baseLocals(mau, store, range),
            warnings,
            notes,
            voucher: {
                direction: 'xuat',
                ma_phieu: data.ma_phieu,
                ngay_text: fmtDateLong(data.ngay),
                kho_label: 'Xuất tại kho',
                kho: data.kho,
                kho_dia_chi: '',
                partner_label: data.partner_label,
                partner: data.partner,
                partner_extra: '',
                ly_do: data.ly_do,
                nguoi_lap: data.nguoi_lap,
                rows: data.rows,
                totals: {
                    so_luong: totalQty,
                    tien_hang: totalValue,
                    giam_gia: 0,
                    tong_thanh_toan: totalValue,
                    da_tra: null,
                    con_no: null
                },
                amount_words: numberToVietnameseWords(totalValue),
                sign_giver_label: 'Người nhận hàng',
                sign_receiver_label: 'Thủ kho'
            }
        }
    };
}

// ===========================================================================
// S1-DNSN / S3a-DNSN — Sổ doanh thu bán hàng hóa, dịch vụ
// ===========================================================================

async function fetchSalesLedgerEvents(query, store, range) {
    const sf = storeFilter(store);
    const [invoices, returns] = await Promise.all([
        HoaDonBanHang.find({
            ...sf,
            ...rangeFilter(range, 'ngay_ban'),
            trang_thai: { $ne: 'cancelled' }
        })
            .select('ma_hoa_don ngay_ban tong_tien giam_gia thanh_toan ghi_chu khach_hang_id')
            .populate('khach_hang_id', 'ten_khach_hang')
            .sort({ ngay_ban: 1, ma_hoa_don: 1 })
            .lean(),
        PhieuTraHang.find({
            ...sf,
            ...rangeFilter(range, 'ngay_tra'),
            trang_thai: { $nin: ['cancelled', 'draft'] }
        })
            .select('ma_phieu_tra ngay_tra tong_tien_tra tong_tien_hang_tra ly_do khach_hang_id')
            .populate('khach_hang_id', 'ten_khach_hang')
            .sort({ ngay_tra: 1, ma_phieu_tra: 1 })
            .lean()
    ]);

    const events = [];
    invoices.forEach(invoice => {
        events.push({
            ngay: invoice.ngay_ban,
            chung_tu: safeText(invoice.ma_hoa_don),
            dien_giai: safeText(invoice.khach_hang_id?.ten_khach_hang)
                || safeText(invoice.ghi_chu)
                || 'Doanh thu bán hàng',
            doanh_thu: invoiceRevenue(invoice),
            ghi_chu: ''
        });
    });
    returns.forEach(slip => {
        events.push({
            ngay: slip.ngay_tra,
            chung_tu: safeText(slip.ma_phieu_tra),
            dien_giai: `Trả hàng bán${slip.khach_hang_id?.ten_khach_hang ? ` — ${slip.khach_hang_id.ten_khach_hang}` : ''}`,
            doanh_thu: -returnDeduction(slip),
            ghi_chu: 'Giảm trừ doanh thu'
        });
    });
    events.sort((a, b) => new Date(a.ngay).getTime() - new Date(b.ngay).getTime());
    return events;
}

async function buildSalesLedgerPdfData(mau, query, store, range) {
    const vatRate = getConfiguredVatRate();
    const events = await fetchSalesLedgerEvents(query, store, range);

    let totalRevenue = 0;
    let totalVat = 0;
    const rows = events.map((event, index) => {
        const vat = vatRate == null ? null : roundMoney(event.doanh_thu * vatRate);
        totalRevenue += event.doanh_thu;
        if (vat != null) totalVat += vat;
        const total = event.doanh_thu + (vat || 0);
        return {
            kind: 'data',
            cells: [
                { text: String(index + 1), align: 'center' },
                { text: fmtDate(event.ngay), align: 'center' },
                { text: event.chung_tu },
                { text: event.dien_giai },
                { text: fmtMoney(event.doanh_thu), align: 'right' },
                { text: vat == null ? '—' : fmtMoney(vat), align: 'right' },
                { text: fmtMoney(total), align: 'right' },
                { text: event.ghi_chu }
            ]
        };
    });

    rows.push({
        kind: 'total',
        cells: [
            { text: 'Tổng cộng', colSpan: 4, align: 'center', bold: true },
            { text: fmtMoney(totalRevenue), align: 'right', bold: true },
            { text: vatRate == null ? '—' : fmtMoney(totalVat), align: 'right', bold: true },
            { text: fmtMoney(totalRevenue + totalVat), align: 'right', bold: true },
            { text: '' }
        ]
    });

    const notes = [VAT_MISSING_NOTE];
    if (mau !== 'S1-DNSN') notes.push(TAX_METHOD_NOTE);

    return {
        view: LEDGER_VIEW,
        landscape: false,
        locals: {
            ...baseLocals(mau, store, range),
            notes,
            columns: [
                { label: 'STT', width: '5%' },
                { label: 'Ngày, tháng', width: '10%' },
                { label: 'Số hiệu chứng từ', width: '13%' },
                { label: 'Diễn giải', width: '26%' },
                { label: 'Doanh thu bán hàng hóa, dịch vụ', width: '14%' },
                { label: 'Thuế GTGT', width: '11%' },
                { label: 'Tổng cộng', width: '13%' },
                { label: 'Ghi chú', width: '8%' }
            ],
            rows
        }
    };
}

// ===========================================================================
// S2a-DNSN — Sổ doanh thu + theo dõi thuế GTGT đầu kỳ/cuối kỳ (view riêng)
// ===========================================================================

function isVatPaymentReceipt(receipt) {
    const label = `${safeText(receipt.loai_thu_chi)} ${safeText(receipt.ghi_chu)}`.toLowerCase();
    return /gtgt|gia tri gia tang|giá trị gia tăng|nop thue|nộp thuế/.test(label);
}

async function buildS2aPdfData(query, store, range) {
    const mau = 'S2a-DNSN';
    const vatRate = getConfiguredVatRate();
    const events = await fetchSalesLedgerEvents(query, store, range);

    const detailRows = events.map(event => ({
        so_hieu: event.chung_tu,
        ngay_thang: fmtDate(event.ngay),
        dien_giai: event.dien_giai,
        so_tien: event.doanh_thu
    }));

    const tongCong1 = events.reduce((sum, event) => sum + event.doanh_thu, 0);
    const thueGtgt1 = vatRate == null ? 0 : roundMoney(tongCong1 * vatRate);

    // Thuế GTGT đã nộp trong kỳ: chỉ nhận phiếu chi ghi rõ nộp thuế GTGT.
    const { start, end } = periodBounds(range);
    const paidReceipts = await PhieuThuChi.find({
        ...storeFilter(store),
        loai_phieu: 'chi',
        trang_thai: { $ne: 'cancelled' },
        ngay_lap: { $gte: start, $lt: end }
    }).select('loai_thu_chi ghi_chu gia_tri').lean();
    const gtgtDaNopKy = paidReceipts
        .filter(isVatPaymentReceipt)
        .reduce((sum, receipt) => sum + Math.abs(roundMoney(receipt.gia_tri)), 0);

    // DB chưa có sổ thuế GTGT riêng → số dư đầu kỳ chưa xác định được, để 0 + ghi chú.
    const gtgtDauKy = 0;
    const gtgtPhaiNopKy = thueGtgt1;
    const gtgtCuoiKy = gtgtDauKy + gtgtPhaiNopKy - gtgtDaNopKy;

    const vatConfigured = vatRate != null;
    const notes = [
        VAT_MISSING_NOTE,
        vatConfigured
            ? null
            : 'Số thuế GTGT còn phải nộp đầu kỳ chưa có nguồn dữ liệu trong hệ thống.',
        gtgtDaNopKy > 0
            ? 'Số thuế GTGT đã nộp trong kỳ lấy từ các phiếu chi có nội dung nộp thuế GTGT.'
            : (vatConfigured ? 'Không tìm thấy phiếu chi nộp thuế GTGT trong kỳ.' : null),
        TAX_METHOD_NOTE
    ].filter(Boolean);

    return {
        view: 's2a-dnsn.ejs',
        landscape: false,
        locals: {
            ...baseLocals(mau, store, range),
            // locals riêng theo layout s2a-dnsn.ejs
            store,
            range,
            year: range?.to ? String(range.to).slice(0, 4) : String(new Date().getFullYear()),
            donViTinh: 'Đồng',
            storeName: safeText(store?.ten_cua_hang),
            storeAddress: buildStoreInfo(store).dia_chi,
            storeTaxCode: safeText(store?.ma_so_thue),
            storePhone: safeText(store?.sdt),
            standalone: true,
            embedded: false,
            vatConfigured,
            detailRows,
            tongCong1,
            thueGtgt1,
            gtgtDauKy,
            gtgtPhaiNopKy,
            gtgtDaNopKy,
            gtgtCuoiKy,
            notes
        }
    };
}

// ===========================================================================
// S2b-DNSN — Sổ chi tiết doanh thu, chi phí
// ===========================================================================

function isSupplierPaymentReceipt(receipt) {
    return Boolean(
        receipt.phieu_nhap_id
        || receipt.nha_cung_cap_id
        || (Array.isArray(receipt.allocations) && receipt.allocations.length)
    );
}

function isCashflowOnlyReceipt(receipt) {
    // Hoàn tiền trả hàng / chi liên quan hóa đơn, đơn hàng: dòng tiền, không phải chi phí mới.
    return Boolean(receipt.phieu_tra_hang_id || receipt.hoa_don_id || receipt.don_hang_id);
}

function isSalesAdminExpense(receipt) {
    const label = `${safeText(receipt.loai_thu_chi)} ${safeText(receipt.doi_tuong)}`.toLowerCase();
    return /lương|luong|quản lý|quan ly|bán hàng|ban hang|van chuyen|vận chuyển|thuê|thue mat bang/.test(label);
}

async function buildS2bPdfData(query, store, range) {
    const mau = 'S2b-DNSN';
    const sf = storeFilter(store);

    const [invoices, returns, purchases, chiReceipts] = await Promise.all([
        HoaDonBanHang.find({ ...sf, ...rangeFilter(range, 'ngay_ban'), trang_thai: { $ne: 'cancelled' } })
            .select('ma_hoa_don ngay_ban tong_tien giam_gia thanh_toan ghi_chu')
            .sort({ ngay_ban: 1 })
            .lean(),
        PhieuTraHang.find({ ...sf, ...rangeFilter(range, 'ngay_tra'), trang_thai: { $nin: ['cancelled', 'draft'] } })
            .select('ma_phieu_tra ngay_tra tong_tien_tra tong_tien_hang_tra')
            .sort({ ngay_tra: 1 })
            .lean(),
        PhieuNhap.find({ ...sf, ...rangeFilter(range, 'ngay_nhap'), trang_thai: 'completed' })
            .select('ma_phieu_nhap ngay_nhap tong_tien ghi_chu')
            .sort({ ngay_nhap: 1 })
            .lean(),
        PhieuThuChi.find({ ...sf, ...rangeFilter(range, 'ngay_lap'), loai_phieu: 'chi', trang_thai: { $ne: 'cancelled' } })
            .select('ma_phieu ngay_lap gia_tri loai_thu_chi doi_tuong ghi_chu phieu_nhap_id nha_cung_cap_id allocations phieu_tra_hang_id hoa_don_id don_hang_id')
            .sort({ ngay_lap: 1 })
            .lean()
    ]);

    const events = [];
    invoices.forEach(invoice => {
        events.push({
            ngay: invoice.ngay_ban,
            chung_tu: safeText(invoice.ma_hoa_don),
            dien_giai: 'Doanh thu bán hàng',
            doanh_thu: invoiceRevenue(invoice),
            chi_mua: 0, chi_bh_ql: 0, chi_khac: 0,
            ghi_chu: ''
        });
    });
    returns.forEach(slip => {
        events.push({
            ngay: slip.ngay_tra,
            chung_tu: safeText(slip.ma_phieu_tra),
            dien_giai: 'Trả hàng bán (giảm trừ doanh thu)',
            doanh_thu: -returnDeduction(slip),
            chi_mua: 0, chi_bh_ql: 0, chi_khac: 0,
            ghi_chu: ''
        });
    });
    purchases.forEach(purchase => {
        events.push({
            ngay: purchase.ngay_nhap,
            chung_tu: safeText(purchase.ma_phieu_nhap),
            dien_giai: 'Mua hàng nhập kho',
            doanh_thu: 0,
            chi_mua: roundMoney(purchase.tong_tien),
            chi_bh_ql: 0, chi_khac: 0,
            ghi_chu: ''
        });
    });

    let skippedSupplierPayments = 0;
    chiReceipts.forEach(receipt => {
        // Tránh double-count: phiếu chi trả NCC là thanh toán công nợ,
        // chi phí mua đã ghi nhận theo phiếu nhập completed ở trên.
        if (isSupplierPaymentReceipt(receipt)) {
            skippedSupplierPayments += 1;
            return;
        }
        if (isCashflowOnlyReceipt(receipt)) return;
        const amount = Math.abs(roundMoney(receipt.gia_tri));
        const isAdmin = isSalesAdminExpense(receipt);
        events.push({
            ngay: receipt.ngay_lap,
            chung_tu: safeText(receipt.ma_phieu),
            dien_giai: safeText(receipt.loai_thu_chi) || safeText(receipt.doi_tuong) || 'Chi phí',
            doanh_thu: 0,
            chi_mua: 0,
            chi_bh_ql: isAdmin ? amount : 0,
            chi_khac: isAdmin ? 0 : amount,
            ghi_chu: safeText(receipt.ghi_chu)
        });
    });

    events.sort((a, b) => new Date(a.ngay).getTime() - new Date(b.ngay).getTime());

    const totals = { doanh_thu: 0, chi_mua: 0, chi_bh_ql: 0, chi_khac: 0 };
    const rows = events.map((event, index) => {
        totals.doanh_thu += event.doanh_thu;
        totals.chi_mua += event.chi_mua;
        totals.chi_bh_ql += event.chi_bh_ql;
        totals.chi_khac += event.chi_khac;
        return {
            kind: 'data',
            cells: [
                { text: String(index + 1), align: 'center' },
                { text: fmtDate(event.ngay), align: 'center' },
                { text: event.chung_tu },
                { text: event.dien_giai },
                { text: event.doanh_thu ? fmtMoney(event.doanh_thu) : '', align: 'right' },
                { text: event.chi_mua ? fmtMoney(event.chi_mua) : '', align: 'right' },
                { text: event.chi_bh_ql ? fmtMoney(event.chi_bh_ql) : '', align: 'right' },
                { text: event.chi_khac ? fmtMoney(event.chi_khac) : '', align: 'right' },
                { text: event.ghi_chu }
            ]
        };
    });

    rows.push({
        kind: 'total',
        cells: [
            { text: 'Tổng cộng', colSpan: 4, align: 'center', bold: true },
            { text: fmtMoney(totals.doanh_thu), align: 'right', bold: true },
            { text: fmtMoney(totals.chi_mua), align: 'right', bold: true },
            { text: fmtMoney(totals.chi_bh_ql), align: 'right', bold: true },
            { text: fmtMoney(totals.chi_khac), align: 'right', bold: true },
            { text: '' }
        ]
    });

    const notes = [
        'Chi phí mua hàng lấy theo phiếu nhập đã hoàn thành; phiếu chi thanh toán nhà cung cấp không cộng lại để tránh tính trùng.',
        'Phân loại chi phí bán hàng/quản lý dựa trên nội dung loại thu chi — hệ thống chưa có danh mục chi phí kế toán riêng.'
    ];
    if (skippedSupplierPayments > 0) {
        notes.push(`Đã loại ${skippedSupplierPayments} phiếu chi thanh toán công nợ nhà cung cấp khỏi chi phí (chỉ là dòng tiền).`);
    }

    return {
        view: LEDGER_VIEW,
        landscape: true,
        locals: {
            ...baseLocals(mau, store, range),
            notes,
            columns: [
                { label: 'STT', width: '4%' },
                { label: 'Ngày', width: '8%' },
                { label: 'Chứng từ', width: '11%' },
                { label: 'Diễn giải', width: '25%' },
                { label: 'Doanh thu', width: '12%' },
                { label: 'Chi phí mua hàng', width: '12%' },
                { label: 'Chi phí bán hàng, quản lý', width: '12%' },
                { label: 'Chi phí khác', width: '10%' },
                { label: 'Ghi chú', width: '6%' }
            ],
            rows
        }
    };
}

// ===========================================================================
// S2c-DNSN — Sổ chi tiết vật liệu, hàng hóa (view riêng, theo lô/quy cách)
// ===========================================================================

function aggregateTongMovements(records) {
    const map = new Map();
    records.forEach(record => {
        const dayKey = record.ngay ? new Date(record.ngay).toISOString().slice(0, 10) : '';
        const key = `${safeText(record.ma_phieu)}|${dayKey}|${safeText(record.loai_phieu)}`;
        if (!map.has(key)) {
            map.set(key, {
                ma_phieu: safeText(record.ma_phieu),
                ngay: record.ngay,
                loai_phieu: safeText(record.loai_phieu),
                so_luong: 0,
                gia_tri: 0,
                ghi_chu: safeText(record.ghi_chu)
            });
        }
        const row = map.get(key);
        row.so_luong += Number(record.so_luong_thay_doi || 0);
        row.gia_tri += Number(record.gia_tri_thay_doi || 0);
        if (!row.ghi_chu && record.ghi_chu) row.ghi_chu = safeText(record.ghi_chu);
    });
    return Array.from(map.values()).sort((a, b) => {
        const diff = new Date(a.ngay).getTime() - new Date(b.ngay).getTime();
        if (diff !== 0) return diff;
        return a.ma_phieu.localeCompare(b.ma_phieu, 'vi');
    });
}

function buildLotAnnotationMap(lotRecords) {
    const map = new Map();
    lotRecords.forEach(record => {
        const key = safeText(record.ma_phieu);
        if (!key) return;
        const lotName = formatLotName(record.lo_hang_id) || 'Lô không tên';
        const qc = safeText(record.ten_quy_cach);
        const qty = Math.abs(Number(record.so_luong_thay_doi || 0));
        const part = qc
            ? `${lotName} / ${qc}: ${fmtQty(qty)}`
            : `${lotName}: ${fmtQty(qty)}`;
        if (!map.has(key)) map.set(key, []);
        const list = map.get(key);
        if (!list.includes(part)) list.push(part);
    });
    return map;
}

async function buildS2cPdfData(query, store, range) {
    const mau = 'S2c-DNSN';
    const hangHoaId = safeText(query.hang_hoa_id);
    const khoId = safeText(query.kho_id);

    const viewBase = {
        store,
        range,
        donViTinh: 'Đồng',
        storeName: safeText(store?.ten_cua_hang),
        storeAddress: buildStoreInfo(store).dia_chi,
        storeTaxCode: safeText(store?.ma_so_thue),
        storePhone: safeText(store?.sdt),
        standalone: true,
        embedded: false,
        notes: []
    };

    if (!hangHoaId || !khoId || !isObjectId(hangHoaId) || !isObjectId(khoId)) {
        return {
            view: 's2c-dnsn.ejs',
            landscape: true,
            locals: {
                ...baseLocals(mau, store, range),
                ...viewBase,
                missingFilters: true,
                tenHang: '',
                tenKho: '',
                donViTinhLabel: '',
                detailRows: [],
                opening: { qty: 0, value: 0 },
                periodIn: { qty: 0, value: 0 },
                periodOut: { qty: 0, value: 0 },
                closing: { qty: 0, value: 0 }
            }
        };
    }

    const [product, warehouse] = await Promise.all([
        HangHoa.findById(hangHoaId).populate('don_vi_tinh_id', 'ten_don_vi ma_don_vi').lean(),
        Kho.findById(khoId).select('ten_kho').lean()
    ]);
    if (!product || !warehouse) {
        return noticeResult(mau, store, range, 'Không tìm thấy hàng hóa hoặc kho đã chọn.');
    }

    const { start, end } = periodBounds(range);
    const historyFilter = {
        hang_hoa_id: hangHoaId,
        kho_id: khoId,
        ...storeFilter(store)
    };

    const [beforeRecords, periodRecords, periodLotRecords] = await Promise.all([
        LichSuKho.find({ ...historyFilter, ...TONG_LEVEL_FILTER, ngay: { $lt: start } })
            .sort({ ngay: 1, created_at: 1 })
            .lean(),
        LichSuKho.find({ ...historyFilter, ...TONG_LEVEL_FILTER, ngay: { $gte: start, $lt: end } })
            .sort({ ngay: 1, created_at: 1 })
            .lean(),
        LichSuKho.find({
            ...historyFilter,
            cap_ton: { $in: ['lo', 'quy_cach'] },
            ngay: { $gte: start, $lt: end }
        })
            .populate('lo_hang_id', 'ten_lo ma_lo')
            .sort({ ngay: 1, created_at: 1 })
            .lean()
    ]);

    const fallbackUnitCost = Number(product.gia_von || product.gia_nhap_cuoi || 0);
    const lotAnnotations = buildLotAnnotationMap(periodLotRecords);

    // Bình quân gia quyền liên hoàn từ lịch sử kho cấp tổng.
    const state = { qty: 0, value: 0 };
    const applyMovement = movement => {
        const qtyChange = Number(movement.so_luong || 0);
        const result = { don_gia: '', nhap_sl: '', nhap_tien: '', xuat_sl: '', xuat_tien: '' };
        if (qtyChange > 0) {
            let importValue = Math.abs(Number(movement.gia_tri || 0));
            if (!importValue && fallbackUnitCost) importValue = roundMoney(qtyChange * fallbackUnitCost);
            result.don_gia = qtyChange > 0 ? importValue / qtyChange : 0;
            result.nhap_sl = qtyChange;
            result.nhap_tien = importValue;
            state.qty += qtyChange;
            state.value += importValue;
        } else if (qtyChange < 0) {
            const outQty = Math.abs(qtyChange);
            const unitPrice = state.qty > 0 ? state.value / state.qty : fallbackUnitCost;
            const outValue = roundMoney(outQty * unitPrice);
            result.don_gia = unitPrice;
            result.xuat_sl = outQty;
            result.xuat_tien = outValue;
            state.qty = Math.max(0, state.qty - outQty);
            state.value = Math.max(0, state.value - outValue);
        }
        return result;
    };

    aggregateTongMovements(beforeRecords).forEach(applyMovement);
    const opening = { qty: state.qty, value: roundMoney(state.value) };

    const periodIn = { qty: 0, value: 0 };
    const periodOut = { qty: 0, value: 0 };
    const detailRows = aggregateTongMovements(periodRecords).map(movement => {
        const result = applyMovement(movement);
        periodIn.qty += Number(result.nhap_sl || 0);
        periodIn.value += Number(result.nhap_tien || 0);
        periodOut.qty += Number(result.xuat_sl || 0);
        periodOut.value += Number(result.xuat_tien || 0);

        const label = LOAI_PHIEU_KHO_LABELS[movement.loai_phieu] || movement.loai_phieu || 'Phát sinh kho';
        const lotParts = lotAnnotations.get(movement.ma_phieu) || [];
        const dienGiai = lotParts.length
            ? `${label} — ${lotParts.join('; ')}`
            : (movement.ghi_chu ? `${label} — ${movement.ghi_chu}` : label);

        return {
            so_hieu: movement.ma_phieu,
            ngay_thang: fmtDate(movement.ngay),
            dien_giai: dienGiai,
            don_gia: result.don_gia,
            nhap_sl: result.nhap_sl,
            nhap_tien: result.nhap_tien,
            xuat_sl: result.xuat_sl,
            xuat_tien: result.xuat_tien,
            ton_sl: state.qty,
            ton_tien: roundMoney(state.value),
            ghi_chu: movement.ghi_chu || ''
        };
    });

    const notes = [
        'Giá xuất kho tính theo bình quân gia quyền liên hoàn từ lịch sử kho (cấp tổng kho, không tính trùng bản ghi cấp lô/quy cách).'
    ];
    if (lotAnnotations.size) {
        notes.push('Chi tiết lô/quy cách của từng chứng từ được ghi kèm trong cột Diễn giải.');
    }
    if (fallbackUnitCost > 0) {
        notes.push('Chứng từ thiếu giá trị nhập được tạm tính theo giá vốn hiện tại của hàng hóa.');
    }

    return {
        view: 's2c-dnsn.ejs',
        landscape: true,
        locals: {
            ...baseLocals(mau, store, range),
            ...viewBase,
            notes,
            missingFilters: false,
            tenHang: `${safeText(product.ten_hang)}${product.ma_hang ? ` (${product.ma_hang})` : ''}`,
            tenKho: safeText(warehouse.ten_kho),
            donViTinhLabel: safeText(product.don_vi_tinh_id?.ten_don_vi) || safeText(product.don_vi_tinh_id?.ma_don_vi),
            detailRows,
            opening,
            periodIn: { qty: periodIn.qty, value: roundMoney(periodIn.value) },
            periodOut: { qty: periodOut.qty, value: roundMoney(periodOut.value) },
            closing: { qty: state.qty, value: roundMoney(state.value) }
        }
    };
}

// ===========================================================================
// S2d-DNSN — Sổ chi tiết tiền
// ===========================================================================

function paymentDetailNote(receipt) {
    const detail = receipt.chi_tiet_thanh_toan || {};
    const parts = [];
    if (Number(detail.tien_mat || 0) > 0) parts.push(`TM ${fmtMoney(detail.tien_mat)}`);
    if (Number(detail.chuyen_khoan || 0) > 0) parts.push(`CK ${fmtMoney(detail.chuyen_khoan)}`);
    if (Number(detail.tien_tra_khach || 0) > 0) parts.push(`Trả khách ${fmtMoney(detail.tien_tra_khach)}`);
    return parts.join('; ');
}

async function buildS2dPdfData(query, store, range) {
    const mau = 'S2d-DNSN';
    const { start, end } = periodBounds(range);
    const baseFilter = {
        ...storeFilter(store),
        trang_thai: { $ne: 'cancelled' }
    };
    const cashBookId = safeText(query.so_quy_id);
    if (cashBookId && isObjectId(cashBookId)) {
        baseFilter.so_quy_id = cashBookId;
    }

    const [beforeRows, periodRows] = await Promise.all([
        PhieuThuChi.find({ ...baseFilter, ngay_lap: { $lt: start } })
            .select('loai_phieu gia_tri')
            .lean(),
        PhieuThuChi.find({ ...baseFilter, ngay_lap: { $gte: start, $lt: end } })
            .populate('so_quy_id', 'ten_so_quy')
            .sort({ ngay_lap: 1, ma_phieu: 1 })
            .lean()
    ]);

    const openingBalance = beforeRows.reduce((sum, row) => {
        const amount = Math.abs(roundMoney(row.gia_tri));
        return sum + (row.loai_phieu === 'thu' ? amount : -amount);
    }, 0);

    let balance = openingBalance;
    let totalThu = 0;
    let totalChi = 0;

    const rows = [{
        kind: 'opening',
        cells: [
            { text: '' },
            { text: '' },
            { text: '' },
            { text: 'Số dư đầu kỳ', bold: true },
            { text: '', align: 'right' },
            { text: '', align: 'right' },
            { text: fmtMoney(openingBalance), align: 'right', bold: true },
            { text: '' },
            { text: '' }
        ]
    }];

    periodRows.forEach((receipt, index) => {
        const amount = Math.abs(roundMoney(receipt.gia_tri));
        const thu = receipt.loai_phieu === 'thu' ? amount : 0;
        const chi = receipt.loai_phieu === 'chi' ? amount : 0;
        totalThu += thu;
        totalChi += chi;
        balance += thu - chi;

        const detailNote = paymentDetailNote(receipt);
        const ghiChu = [detailNote, safeText(receipt.ghi_chu)].filter(Boolean).join(' — ');
        rows.push({
            kind: 'data',
            cells: [
                { text: String(index + 1), align: 'center' },
                { text: fmtDate(receipt.ngay_lap), align: 'center' },
                { text: safeText(receipt.ma_phieu) },
                { text: safeText(receipt.loai_thu_chi) || safeText(receipt.doi_tuong) || (receipt.loai_phieu === 'thu' ? 'Thu tiền' : 'Chi tiền') },
                { text: thu ? fmtMoney(thu) : '', align: 'right' },
                { text: chi ? fmtMoney(chi) : '', align: 'right' },
                { text: fmtMoney(balance), align: 'right' },
                { text: safeText(receipt.so_quy_id?.ten_so_quy) || PAYMENT_METHOD_LABELS[receipt.phuong_thuc_thanh_toan] || '' },
                { text: ghiChu }
            ]
        });
    });

    rows.push({
        kind: 'total',
        cells: [
            { text: 'Cộng phát sinh trong kỳ', colSpan: 4, align: 'center', bold: true },
            { text: fmtMoney(totalThu), align: 'right', bold: true },
            { text: fmtMoney(totalChi), align: 'right', bold: true },
            { text: '', align: 'right' },
            { text: '' },
            { text: '' }
        ]
    });
    rows.push({
        kind: 'closing',
        cells: [
            { text: 'Số dư cuối kỳ', colSpan: 4, align: 'center', bold: true },
            { text: '', align: 'right' },
            { text: '', align: 'right' },
            { text: fmtMoney(balance), align: 'right', bold: true },
            { text: '' },
            { text: '' }
        ]
    });

    const notes = [];
    if (cashBookId && isObjectId(cashBookId)) {
        notes.push('Số dư đầu kỳ và phát sinh trong kỳ đều được lọc theo sổ quỹ đã chọn.');
    } else {
        notes.push('Sổ gộp tất cả sổ quỹ của cửa hàng (chưa chọn sổ quỹ cụ thể).');
    }

    return {
        view: LEDGER_VIEW,
        landscape: true,
        locals: {
            ...baseLocals(mau, store, range),
            notes,
            columns: [
                { label: 'STT', width: '4%' },
                { label: 'Ngày', width: '8%' },
                { label: 'Chứng từ', width: '11%' },
                { label: 'Diễn giải', width: '24%' },
                { label: 'Thu', width: '11%' },
                { label: 'Chi', width: '11%' },
                { label: 'Tồn quỹ', width: '11%' },
                { label: 'Sổ quỹ / Phương thức', width: '10%' },
                { label: 'Ghi chú', width: '10%' }
            ],
            rows
        }
    };
}

// ===========================================================================
// S3b-DNSN — Sổ theo dõi nghĩa vụ thuế GTGT
// ===========================================================================

async function buildS3bPdfData(query, store, range) {
    const mau = 'S3b-DNSN';
    const vatRate = getConfiguredVatRate();
    const periodLabel = range?.from && range?.to ? `${fmtDate(`${range.from}T00:00:00`)} – ${fmtDate(`${range.to}T00:00:00`)}` : '';

    const invoices = await HoaDonBanHang.find({
        ...storeFilter(store),
        ...rangeFilter(range, 'ngay_ban'),
        trang_thai: { $ne: 'cancelled' }
    })
        .select('ma_hoa_don ngay_ban tong_tien giam_gia thanh_toan')
        .sort({ ngay_ban: 1 })
        .lean();

    const { start, end } = periodBounds(range);
    const paidReceipts = await PhieuThuChi.find({
        ...storeFilter(store),
        loai_phieu: 'chi',
        trang_thai: { $ne: 'cancelled' },
        ngay_lap: { $gte: start, $lt: end }
    }).select('ma_phieu ngay_lap loai_thu_chi ghi_chu gia_tri').lean();
    const vatPayments = paidReceipts.filter(isVatPaymentReceipt);
    const totalPaid = vatPayments.reduce((sum, receipt) => sum + Math.abs(roundMoney(receipt.gia_tri)), 0);

    let totalRevenue = 0;
    const rows = invoices.map((invoice, index) => {
        const revenue = invoiceRevenue(invoice);
        totalRevenue += revenue;
        return {
            kind: 'data',
            cells: [
                { text: String(index + 1), align: 'center' },
                { text: periodLabel, align: 'center' },
                { text: safeText(invoice.ma_hoa_don) },
                { text: 'Doanh thu bán hàng' },
                { text: fmtMoney(revenue), align: 'right' },
                { text: vatRate == null ? '—' : `${Math.round(vatRate * 100)}%`, align: 'center' },
                { text: vatRate == null ? '—' : fmtMoney(roundMoney(revenue * vatRate)), align: 'right' },
                { text: '—', align: 'right' },
                { text: vatRate == null ? '—' : fmtMoney(roundMoney(revenue * vatRate)), align: 'right' },
                { text: '' }
            ]
        };
    });

    rows.push({
        kind: 'total',
        cells: [
            { text: 'Tổng cộng', colSpan: 4, align: 'center', bold: true },
            { text: fmtMoney(totalRevenue), align: 'right', bold: true },
            { text: vatRate == null ? '—' : `${Math.round(vatRate * 100)}%`, align: 'center', bold: true },
            { text: vatRate == null ? '—' : fmtMoney(roundMoney(totalRevenue * vatRate)), align: 'right', bold: true },
            { text: '—', align: 'right', bold: true },
            { text: vatRate == null ? '—' : fmtMoney(roundMoney(totalRevenue * vatRate)), align: 'right', bold: true },
            { text: '' }
        ]
    });

    const notes = [
        VAT_MISSING_NOTE,
        'Hệ thống chưa lưu thuế GTGT đầu vào theo chứng từ mua hàng — cột "Thuế GTGT đầu vào" hiển thị "—".',
        totalPaid > 0
            ? `Trong kỳ có ${vatPayments.length} phiếu chi nộp thuế GTGT, tổng ${fmtMoney(totalPaid)} đồng (${vatPayments.map(r => safeText(r.ma_phieu)).filter(Boolean).join(', ')}).`
            : 'Không tìm thấy phiếu chi nộp thuế GTGT trong kỳ.'
    ];

    return {
        view: LEDGER_VIEW,
        landscape: true,
        locals: {
            ...baseLocals(mau, store, range),
            notes,
            columns: [
                { label: 'STT', width: '4%' },
                { label: 'Kỳ thuế', width: '12%' },
                { label: 'Chứng từ', width: '11%' },
                { label: 'Diễn giải', width: '17%' },
                { label: 'Doanh thu chịu thuế', width: '12%' },
                { label: 'Thuế suất', width: '8%' },
                { label: 'Thuế GTGT đầu ra', width: '11%' },
                { label: 'Thuế GTGT đầu vào', width: '11%' },
                { label: 'Thuế GTGT phải nộp', width: '11%' },
                { label: 'Ghi chú', width: '3%' }
            ],
            rows
        }
    };
}

// ===========================================================================
// S4a-DNSN — Sổ chi tiết thanh toán công nợ (tách KH / NCC, có đầu kỳ)
// ===========================================================================

const LOAI_GIAO_DICH_LABELS = {
    nhap_hang: 'Nhập hàng',
    tra_hang_nhap: 'Trả hàng nhập',
    thanh_toan: 'Thanh toán',
    chiet_khau_thanh_toan: 'Chiết khấu thanh toán',
    dieu_chinh_tang: 'Điều chỉnh tăng',
    dieu_chinh_giam: 'Điều chỉnh giảm',
    mua_hang: 'Mua hàng',
    tra_hang: 'Trả hàng',
    hoan_tien: 'Hoàn tiền'
};

function buildDebtSectionRows(sectionLabel, groups) {
    const rows = [];
    if (!groups.length) return rows;
    rows.push({
        kind: 'section',
        cells: [{ text: sectionLabel, colSpan: 8, bold: true }]
    });

    groups.forEach(group => {
        rows.push({
            kind: 'section',
            cells: [{ text: group.name, colSpan: 8, bold: true, align: 'left', indent: true }]
        });
        rows.push({
            kind: 'opening',
            cells: [
                { text: '' },
                { text: '' },
                { text: '' },
                { text: 'Số dư đầu kỳ', bold: true },
                { text: '', align: 'right' },
                { text: '', align: 'right' },
                { text: fmtMoney(group.opening), align: 'right', bold: true },
                { text: '' }
            ]
        });
        group.transactions.forEach((tx, index) => {
            rows.push({
                kind: 'data',
                cells: [
                    { text: String(index + 1), align: 'center' },
                    { text: fmtDate(tx.ngay_giao_dich), align: 'center' },
                    { text: safeText(tx.ma_giao_dich) },
                    { text: LOAI_GIAO_DICH_LABELS[tx.loai_giao_dich] || safeText(tx.loai_giao_dich) },
                    { text: tx.huong_cong_no === 'tang_no' ? fmtMoney(tx.gia_tri) : '', align: 'right' },
                    { text: tx.huong_cong_no === 'giam_no' ? fmtMoney(tx.gia_tri) : '', align: 'right' },
                    { text: fmtMoney(tx.no_sau), align: 'right' },
                    { text: safeText(tx.ghi_chu) }
                ]
            });
        });
        rows.push({
            kind: 'closing',
            cells: [
                { text: '' },
                { text: '' },
                { text: '' },
                { text: 'Số dư cuối kỳ', bold: true },
                { text: fmtMoney(group.totalUp), align: 'right', bold: true },
                { text: fmtMoney(group.totalDown), align: 'right', bold: true },
                { text: fmtMoney(group.closing), align: 'right', bold: true },
                { text: '' }
            ]
        });
    });
    return rows;
}

async function buildDebtGroups(Model, objectField, nameResolver, store, range, objectIdFilter) {
    const sf = storeFilter(store);
    const { start, end } = periodBounds(range);
    const objectFilter = objectIdFilter && isObjectId(objectIdFilter)
        ? { [objectField]: objectIdFilter }
        : {};

    const [beforeRows, periodRows] = await Promise.all([
        Model.find({ ...sf, ...objectFilter, ngay_giao_dich: { $lt: start } })
            .select(`${objectField} no_sau ngay_giao_dich`)
            .sort({ ngay_giao_dich: 1, created_at: 1 })
            .lean(),
        Model.find({ ...sf, ...objectFilter, ngay_giao_dich: { $gte: start, $lt: end } })
            .populate(objectField, 'ten_khach_hang ten_ncc ma_khach_hang ma_ncc')
            .sort({ ngay_giao_dich: 1, created_at: 1 })
            .lean()
    ]);

    // Số dư đầu kỳ = no_sau của giao dịch cuối cùng trước dateFrom (per đối tượng).
    const openingMap = new Map();
    beforeRows.forEach(row => {
        const key = String(row[objectField] || '');
        if (key) openingMap.set(key, roundMoney(row.no_sau));
    });

    const groupMap = new Map();
    periodRows.forEach(row => {
        const obj = row[objectField];
        const key = String(obj?._id || obj || '');
        if (!key) return;
        if (!groupMap.has(key)) {
            groupMap.set(key, {
                key,
                name: nameResolver(obj),
                opening: openingMap.get(key) ?? 0,
                transactions: [],
                totalUp: 0,
                totalDown: 0,
                closing: openingMap.get(key) ?? 0
            });
        }
        const group = groupMap.get(key);
        group.transactions.push(row);
        const amount = roundMoney(row.gia_tri);
        if (row.huong_cong_no === 'tang_no') group.totalUp += amount;
        else group.totalDown += amount;
        group.closing = roundMoney(row.no_sau);
    });

    // Đối tượng có dư đầu kỳ nhưng không phát sinh trong kỳ.
    for (const [key, opening] of openingMap.entries()) {
        if (!groupMap.has(key) && opening !== 0) {
            groupMap.set(key, {
                key,
                name: '',
                opening,
                transactions: [],
                totalUp: 0,
                totalDown: 0,
                closing: opening
            });
        }
    }

    const groups = Array.from(groupMap.values());

    // Bổ sung tên cho nhóm chỉ có số dư đầu kỳ.
    const missingNameIds = groups.filter(g => !g.name).map(g => g.key).filter(isObjectId);
    if (missingNameIds.length) {
        const NameModel = objectField === 'khach_hang_id' ? KhachHang : NhaCungCap;
        const docs = await NameModel.find({ _id: { $in: missingNameIds } })
            .select('ten_khach_hang ten_ncc')
            .lean();
        const nameMap = new Map(docs.map(doc => [String(doc._id), safeText(doc.ten_khach_hang) || safeText(doc.ten_ncc)]));
        groups.forEach(group => {
            if (!group.name) group.name = nameMap.get(group.key) || '(Không rõ tên)';
        });
    }

    groups.sort((a, b) => a.name.localeCompare(b.name, 'vi'));
    return groups;
}

async function buildS4aPdfData(query, store, range) {
    const mau = 'S4a-DNSN';

    const [khGroups, nccGroups] = await Promise.all([
        buildDebtGroups(
            GiaoDichCongNoKhachHang,
            'khach_hang_id',
            obj => safeText(obj?.ten_khach_hang) || safeText(obj?.ma_khach_hang),
            store, range, safeText(query.khach_hang_id)
        ),
        buildDebtGroups(
            GiaoDichCongNoNhaCungCap,
            'nha_cung_cap_id',
            obj => safeText(obj?.ten_ncc) || safeText(obj?.ma_ncc),
            store, range, safeText(query.nha_cung_cap_id)
        )
    ]);

    const rows = [
        ...buildDebtSectionRows('I. CÔNG NỢ PHẢI THU KHÁCH HÀNG', khGroups),
        ...buildDebtSectionRows('II. CÔNG NỢ PHẢI TRẢ NHÀ CUNG CẤP', nccGroups)
    ];

    if (!rows.length) {
        rows.push({
            kind: 'data',
            cells: [{ text: 'Không có phát sinh công nợ trong kỳ.', colSpan: 8, align: 'center' }]
        });
    }

    const notes = [
        'Sổ tách riêng công nợ khách hàng (phải thu) và nhà cung cấp (phải trả); số dư đầu kỳ lấy theo giao dịch cuối cùng trước ngày bắt đầu kỳ.',
        'Hệ thống không có cờ hủy trên giao dịch công nợ — các điều chỉnh được ghi nhận bằng giao dịch điều chỉnh tăng/giảm.'
    ];

    return {
        view: LEDGER_VIEW,
        landscape: true,
        locals: {
            ...baseLocals(mau, store, range),
            notes,
            columns: [
                { label: 'STT', width: '4%' },
                { label: 'Ngày', width: '9%' },
                { label: 'Chứng từ', width: '13%' },
                { label: 'Diễn giải', width: '24%' },
                { label: 'Phát sinh tăng', width: '12%' },
                { label: 'Phát sinh giảm', width: '12%' },
                { label: 'Số dư', width: '12%' },
                { label: 'Ghi chú', width: '14%' }
            ],
            rows
        }
    };
}

// ===========================================================================
// B01-DNSN — Báo cáo tình hình tài chính (tính đến cuối kỳ)
// ===========================================================================

async function sumDebtClosingAtDate(Model, objectField, store, endDate) {
    const rows = await Model.find({
        ...storeFilter(store),
        ngay_giao_dich: { $lt: endDate }
    })
        .select(`${objectField} no_sau ngay_giao_dich`)
        .sort({ ngay_giao_dich: 1, created_at: 1 })
        .lean();
    const lastMap = new Map();
    rows.forEach(row => {
        const key = String(row[objectField] || '');
        if (key) lastMap.set(key, roundMoney(row.no_sau));
    });
    let total = 0;
    for (const balance of lastMap.values()) total += balance;
    return total;
}

async function buildB01PdfData(query, store, range) {
    const mau = 'B01-DNSN';
    const { end } = periodBounds(range);
    const sf = storeFilter(store);

    const [cashRows, inventoryRows, receivables, payables] = await Promise.all([
        PhieuThuChi.aggregate([
            { $match: { ...sf, trang_thai: { $ne: 'cancelled' }, ngay_lap: { $lt: end } } },
            { $group: { _id: '$loai_phieu', total: { $sum: { $abs: { $ifNull: ['$gia_tri', 0] } } } } }
        ]),
        LichSuKho.aggregate([
            {
                $match: {
                    ...sf,
                    ngay: { $lt: end },
                    $or: [
                        { cap_ton: 'tong' },
                        { cap_ton: null },
                        { cap_ton: { $exists: false } }
                    ]
                }
            },
            { $group: { _id: null, total: { $sum: { $ifNull: ['$gia_tri_thay_doi', 0] } } } }
        ]),
        sumDebtClosingAtDate(GiaoDichCongNoKhachHang, 'khach_hang_id', store, end),
        sumDebtClosingAtDate(GiaoDichCongNoNhaCungCap, 'nha_cung_cap_id', store, end)
    ]);

    const thu = cashRows.find(row => row._id === 'thu');
    const chi = cashRows.find(row => row._id === 'chi');
    const cash = roundMoney((thu?.total || 0) - (chi?.total || 0));
    const inventory = Math.max(0, roundMoney(inventoryRows[0]?.total || 0));
    const receivablesTotal = Math.max(0, roundMoney(receivables));
    const payablesTotal = Math.max(0, roundMoney(payables));

    const shortAssets = cash + inventory + receivablesTotal;
    const liabilities = payablesTotal;
    const equity = shortAssets - liabilities;

    const lineRows = [
        { ma: '100', chi_tieu: 'TÀI SẢN NGẮN HẠN', value: shortAssets, bold: true },
        { ma: '110', chi_tieu: 'Tiền và các khoản tương đương tiền', value: cash, ghi_chu: 'Tổng thu − chi sổ quỹ đến cuối kỳ' },
        { ma: '130', chi_tieu: 'Hàng tồn kho', value: inventory, ghi_chu: 'Tính từ lịch sử kho đến cuối kỳ (tạm tính)' },
        { ma: '140', chi_tieu: 'Phải thu khách hàng', value: receivablesTotal, ghi_chu: 'Số dư công nợ KH tại cuối kỳ' },
        { ma: '200', chi_tieu: 'TÀI SẢN DÀI HẠN', value: null, bold: true, ghi_chu: 'Chưa có module tài sản cố định' },
        { ma: '300', chi_tieu: 'NỢ PHẢI TRẢ', value: liabilities, bold: true },
        { ma: '310', chi_tieu: 'Phải trả người bán', value: payablesTotal, ghi_chu: 'Số dư công nợ NCC tại cuối kỳ' },
        { ma: '400', chi_tieu: 'VỐN CHỦ SỞ HỮU', value: equity, bold: true, ghi_chu: 'Tính cân đối: tài sản − nợ phải trả' }
    ];

    const rows = lineRows.map(line => ({
        kind: line.bold ? 'total' : 'data',
        cells: [
            { text: line.ma, align: 'center', bold: line.bold },
            { text: line.chi_tieu, bold: line.bold },
            { text: line.value == null ? '—' : fmtMoney(line.value), align: 'right', bold: line.bold },
            { text: '—', align: 'right' },
            { text: line.ghi_chu || '' }
        ]
    }));

    const notes = [
        `Số cuối kỳ tính đến hết ngày ${range?.to ? fmtDate(`${range.to}T00:00:00`) : fmtDate(new Date(end.getTime() - 1))}.`,
        'Số đầu năm chưa có nguồn dữ liệu trong hệ thống (chưa có số dư khóa sổ đầu năm) — hiển thị "—".',
        'Giá trị hàng tồn kho tạm tính từ tổng giá trị thay đổi trong lịch sử kho; cần đối chiếu với kiểm kê thực tế trước khi dùng làm BCTC chính thức.',
        'Hệ thống chưa có module tài sản cố định và vốn góp — chỉ tiêu vốn chủ sở hữu được tính cân đối.'
    ];

    return {
        view: LEDGER_VIEW,
        landscape: false,
        locals: {
            ...baseLocals(mau, store, range),
            notes,
            columns: [
                { label: 'Mã số', width: '8%' },
                { label: 'Chỉ tiêu', width: '40%' },
                { label: 'Số cuối kỳ', width: '16%' },
                { label: 'Số đầu năm', width: '14%' },
                { label: 'Ghi chú', width: '22%' }
            ],
            rows
        }
    };
}

// ===========================================================================
// B02-DNSN — Báo cáo kết quả hoạt động kinh doanh
// ===========================================================================

async function computeCogsForInvoices(invoiceIds) {
    if (!invoiceIds.length) return { cogs: 0, missingCostLines: 0, totalLines: 0 };

    const lines = await CTHoaDonBanHang.find({ hoa_don_id: { $in: invoiceIds } })
        .populate('hang_hoa_id', 'gia_von')
        .populate('lo_hang_id', 'gia_von don_gia_nhap')
        .lean();

    // Giá vốn lô cho lot_allocations.
    const allocationLotIds = new Set();
    lines.forEach(line => {
        (line.lot_allocations || []).forEach(alloc => {
            if (alloc?.lo_hang_id) allocationLotIds.add(String(alloc.lo_hang_id));
        });
    });
    const lotDocs = allocationLotIds.size
        ? await LoHang.find({ _id: { $in: Array.from(allocationLotIds) } }).select('gia_von don_gia_nhap').lean()
        : [];
    const lotCostMap = new Map(lotDocs.map(doc => [
        String(doc._id),
        Number(doc.gia_von || doc.don_gia_nhap || 0)
    ]));

    let cogs = 0;
    let missingCostLines = 0;
    let totalLines = 0;

    lines.forEach(line => {
        const productCost = Number(line.hang_hoa_id?.gia_von || 0);
        const allocations = Array.isArray(line.lot_allocations)
            ? line.lot_allocations.filter(a => a && Number(a.so_luong || 0) > 0)
            : [];

        if (allocations.length) {
            allocations.forEach(alloc => {
                totalLines += 1;
                const qty = Number(alloc.so_luong || 0);
                const lotCost = lotCostMap.get(String(alloc.lo_hang_id || '')) || 0;
                const cost = lotCost || productCost;
                if (!cost) missingCostLines += 1;
                cogs += roundMoney(qty * cost);
            });
            return;
        }

        totalLines += 1;
        const qty = Number(line.so_luong || 0);
        const lineCost = Number(line.lo_hang_id?.gia_von || line.lo_hang_id?.don_gia_nhap || 0) || productCost;
        if (!lineCost) missingCostLines += 1;
        cogs += roundMoney(qty * lineCost);
    });

    return { cogs, missingCostLines, totalLines };
}

async function buildB02PdfData(query, store, range) {
    const mau = 'B02-DNSN';
    const sf = storeFilter(store);

    const [invoices, returns, chiReceipts] = await Promise.all([
        HoaDonBanHang.find({ ...sf, ...rangeFilter(range, 'ngay_ban'), trang_thai: { $ne: 'cancelled' } })
            .select('_id tong_tien giam_gia thanh_toan')
            .lean(),
        PhieuTraHang.find({ ...sf, ...rangeFilter(range, 'ngay_tra'), trang_thai: { $nin: ['cancelled', 'draft'] } })
            .select('tong_tien_tra tong_tien_hang_tra')
            .lean(),
        PhieuThuChi.find({ ...sf, ...rangeFilter(range, 'ngay_lap'), loai_phieu: 'chi', trang_thai: { $ne: 'cancelled' } })
            .select('gia_tri loai_thu_chi doi_tuong phieu_nhap_id nha_cung_cap_id allocations phieu_tra_hang_id hoa_don_id don_hang_id')
            .lean()
    ]);

    const doanhThu = invoices.reduce((sum, invoice) => sum + invoiceRevenue(invoice), 0);
    const giamTru = returns.reduce((sum, slip) => sum + returnDeduction(slip), 0);
    const doanhThuThuan = doanhThu - giamTru;

    // Giá vốn lấy theo hàng đã xuất bán (CT hóa đơn × giá vốn lô/hàng hóa) — KHÔNG lấy tổng phiếu nhập.
    const { cogs, missingCostLines, totalLines } = await computeCogsForInvoices(invoices.map(i => i._id));

    let chiQuanLy = 0;
    let chiKhac = 0;
    chiReceipts.forEach(receipt => {
        if (isSupplierPaymentReceipt(receipt)) return; // thanh toán công nợ, không phải chi phí
        if (isCashflowOnlyReceipt(receipt)) return;    // hoàn tiền hóa đơn/trả hàng
        const amount = Math.abs(roundMoney(receipt.gia_tri));
        if (isSalesAdminExpense(receipt)) chiQuanLy += amount;
        else chiKhac += amount;
    });

    const cogsAvailable = totalLines > 0 && missingCostLines < totalLines;
    const loiNhuanGop = cogsAvailable ? doanhThuThuan - cogs : null;
    const loiNhuanKd = loiNhuanGop == null ? null : loiNhuanGop - chiQuanLy - chiKhac;

    const lineRows = [
        { ma: '01', chi_tieu: 'Doanh thu bán hàng và cung cấp dịch vụ', value: doanhThu },
        { ma: '02', chi_tieu: 'Các khoản giảm trừ doanh thu', value: giamTru },
        { ma: '10', chi_tieu: 'Doanh thu thuần về bán hàng và cung cấp dịch vụ', value: doanhThuThuan, bold: true },
        { ma: '11', chi_tieu: 'Giá vốn hàng bán', value: cogsAvailable ? cogs : null, ghi_chu: 'Tạm tính theo giá vốn lô/hàng hóa của hàng đã xuất bán' },
        { ma: '20', chi_tieu: 'Lợi nhuận gộp về bán hàng và cung cấp dịch vụ', value: loiNhuanGop, bold: true },
        { ma: '25', chi_tieu: 'Chi phí quản lý doanh nghiệp, bán hàng', value: chiQuanLy },
        { ma: '26', chi_tieu: 'Chi phí khác', value: chiKhac },
        { ma: '30', chi_tieu: 'Lợi nhuận thuần từ hoạt động kinh doanh', value: loiNhuanKd, bold: true },
        { ma: '50', chi_tieu: 'Lợi nhuận kế toán trước thuế', value: loiNhuanKd, bold: true },
        { ma: '51', chi_tieu: 'Chi phí thuế TNDN', value: null, ghi_chu: 'Chưa có cấu hình phương pháp thuế TNDN' },
        { ma: '60', chi_tieu: 'Lợi nhuận sau thuế TNDN', value: loiNhuanKd, bold: true, ghi_chu: 'Bằng lợi nhuận trước thuế do chưa tính thuế TNDN' }
    ];

    const rows = lineRows.map(line => ({
        kind: line.bold ? 'total' : 'data',
        cells: [
            { text: line.ma, align: 'center', bold: line.bold },
            { text: line.chi_tieu, bold: line.bold },
            { text: line.value == null ? '—' : fmtMoney(line.value), align: 'right', bold: line.bold },
            { text: '—', align: 'right' },
            { text: line.ghi_chu || '' }
        ]
    }));

    const warnings = [];
    if (!cogsAvailable && doanhThu > 0) {
        warnings.push('Chưa đủ dữ liệu giá vốn xuất bán — các chỉ tiêu lợi nhuận hiển thị "—".');
    } else if (missingCostLines > 0) {
        warnings.push(`${missingCostLines}/${totalLines} dòng hàng bán không có giá vốn (giá vốn = 0) — lợi nhuận gộp có thể cao hơn thực tế.`);
    }

    const notes = [
        'Giá vốn hàng bán tính theo từng dòng hàng đã xuất trên hóa đơn (giá vốn lô nếu có, nếu không dùng giá vốn hiện tại của hàng hóa) — không lấy tổng giá trị phiếu nhập trong kỳ.',
        'Phiếu chi thanh toán nhà cung cấp và hoàn tiền khách không tính vào chi phí (chỉ là dòng tiền).',
        'Cột "Năm trước" chưa có nguồn dữ liệu — hiển thị "—".',
        'Thuế TNDN chưa được tính do hệ thống chưa có cấu hình phương pháp thuế.'
    ];

    return {
        view: LEDGER_VIEW,
        landscape: false,
        locals: {
            ...baseLocals(mau, store, range),
            warnings,
            notes,
            columns: [
                { label: 'Mã số', width: '8%' },
                { label: 'Chỉ tiêu', width: '40%' },
                { label: 'Kỳ này', width: '16%' },
                { label: 'Năm trước', width: '13%' },
                { label: 'Ghi chú', width: '23%' }
            ],
            rows
        }
    };
}

// ===========================================================================
// S4b / S4c / S4d — chưa có nguồn dữ liệu trong hệ thống
// ===========================================================================

const NO_MODULE_INFO = {
    'S4b-DNSN': 'Hệ thống chưa có module tài sản cố định.',
    'S4c-DNSN': 'Hệ thống chưa theo dõi các loại thuế khác ngoài GTGT.',
    'S4d-DNSN': 'Hệ thống chưa có module theo dõi vốn chủ sở hữu.'
};

function buildNoModulePdfData(mau, store, range) {
    return noticeResult(
        mau, store, range,
        'Mẫu này chưa có nguồn dữ liệu trong hệ thống. Cần bổ sung module hoặc nhập tay.',
        [
            NO_MODULE_INFO[mau] || '',
            'Không hiển thị số 0 để tránh hiểu nhầm là đã hạch toán.'
        ].filter(Boolean)
    );
}

// ===========================================================================
// Entry point
// ===========================================================================

async function buildReport58PdfData({ mau, query = {}, store = null, range = null }) {
    switch (mau) {
        case '01-TT':
        case '02-TT':
            return buildVoucherTtPdfData(mau, query, store, range);
        case '01-VT':
            return build01VtPdfData(query, store, range);
        case '02-VT':
            return build02VtPdfData(query, store, range);
        case 'S1-DNSN':
        case 'S3a-DNSN':
            return buildSalesLedgerPdfData(mau, query, store, range);
        case 'S2a-DNSN':
            return buildS2aPdfData(query, store, range);
        case 'S2b-DNSN':
            return buildS2bPdfData(query, store, range);
        case 'S2c-DNSN':
            return buildS2cPdfData(query, store, range);
        case 'S2d-DNSN':
            return buildS2dPdfData(query, store, range);
        case 'S3b-DNSN':
            return buildS3bPdfData(query, store, range);
        case 'S4a-DNSN':
            return buildS4aPdfData(query, store, range);
        case 'B01-DNSN':
            return buildB01PdfData(query, store, range);
        case 'B02-DNSN':
            return buildB02PdfData(query, store, range);
        case 'S4b-DNSN':
        case 'S4c-DNSN':
        case 'S4d-DNSN':
            return buildNoModulePdfData(mau, store, range);
        default:
            return noticeResult(mau, store, range, `Mẫu ${mau} chưa được hỗ trợ in PDF.`);
    }
}

/** Danh sách phiếu nhập cho bộ lọc 01-VT trên màn hình báo cáo. */
async function loadPurchaseVoucherOptions(store = null) {
    return PhieuNhap.find({
        ...storeFilter(store),
        trang_thai: { $ne: 'cancelled' }
    })
        .select('ma_phieu_nhap ngay_nhap tong_tien trang_thai')
        .populate('nha_cung_cap_id', 'ten_ncc')
        .sort({ ngay_nhap: -1 })
        .limit(200)
        .lean();
}

/** Danh sách chứng từ xuất kho cho bộ lọc 02-VT trên màn hình báo cáo. */
async function loadExportVoucherOptions(store = null) {
    const sf = storeFilter(store);
    const [invoices, destroys, internals, checks] = await Promise.all([
        HoaDonBanHang.find({ ...sf, trang_thai: { $ne: 'cancelled' } })
            .select('ma_hoa_don ngay_ban thanh_toan tong_tien')
            .sort({ ngay_ban: -1 }).limit(100).lean(),
        PhieuXuatHuy.find({ ...sf, trang_thai: { $nin: ['cancelled', 'draft'] } })
            .select('ma_xuat_huy ngay_xuat tong_gia_tri')
            .sort({ ngay_xuat: -1 }).limit(50).lean(),
        PhieuXuatNoiBo.find({ ...sf, trang_thai: { $nin: ['cancelled', 'draft'] } })
            .select('ma_xuat_noi_bo ngay_xuat tong_gia_tri')
            .sort({ ngay_xuat: -1 }).limit(50).lean(),
        PhieuKiemKho.find({
            ...sf,
            trang_thai: 'completed',
            tong_so_luong_lech: { $lt: 0 },
            $or: [{ deleted_at: null }, { deleted_at: { $exists: false } }]
        })
            .select('ma_kiem_kho ngay_kiem tong_gia_tri_lech')
            .sort({ ngay_kiem: -1 }).limit(50).lean()
    ]);

    const options = [];
    invoices.forEach(doc => options.push({
        value: `hoa_don:${doc._id}`,
        label: `[Bán hàng] ${safeText(doc.ma_hoa_don)} — ${fmtDate(doc.ngay_ban)}`
    }));
    destroys.forEach(doc => options.push({
        value: `xuat_huy:${doc._id}`,
        label: `[Xuất hủy] ${safeText(doc.ma_xuat_huy)} — ${fmtDate(doc.ngay_xuat)}`
    }));
    internals.forEach(doc => options.push({
        value: `xuat_noi_bo:${doc._id}`,
        label: `[Nội bộ] ${safeText(doc.ma_xuat_noi_bo)} — ${fmtDate(doc.ngay_xuat)}`
    }));
    checks.forEach(doc => options.push({
        value: `kiem_kho:${doc._id}`,
        label: `[Kiểm kho giảm] ${safeText(doc.ma_kiem_kho)} — ${fmtDate(doc.ngay_kiem)}`
    }));
    return options;
}

module.exports = {
    buildReport58PdfData,
    loadPurchaseVoucherOptions,
    loadExportVoucherOptions,
    getConfiguredVatRate
};
