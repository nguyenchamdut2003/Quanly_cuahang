const path = require('path');
const {
    PhieuThuChi,
    CuaHang,
    HoaDonBanHang,
    PhieuNhap,
    DonHang
} = require('../models/kiot.model');
const { numberToVietnameseWords } = require('../utils/numberToVietnameseWords');

const RECEIPT_PRINT_POPULATES = [
    { path: 'nguoi_tao_id', select: 'ho_ten email username' },
    { path: 'nha_cung_cap_id', select: 'ten_ncc ma_ncc sdt' },
    { path: 'khach_hang_id', select: 'ten_khach_hang ma_khach_hang sdt' },
    { path: 'nhan_vien_id', select: 'ma_nhan_vien ten_nhan_vien sdt' },
    { path: 'doi_tac_giao_hang_id', select: 'ma_doi_tac ten_doi_tac sdt' },
    { path: 'so_quy_id', select: 'ten_so_quy ma_so_quy' },
    { path: 'cua_hang_id', select: 'ten_cua_hang dia_chi dia_chi_day_du sdt ma_cua_hang' },
    { path: 'chi_nhanh_id', select: 'ten_chi_nhanh dia_chi sdt' },
    {
        path: 'hoa_don_id',
        select: 'ma_hoa_don ngay_ban tong_tien thanh_toan trang_thai khach_hang_id',
        populate: { path: 'khach_hang_id', select: 'ten_khach_hang ma_khach_hang' }
    },
    {
        path: 'don_hang_id',
        select: 'ma_don_hang ngay_dat tong_tien tong_thanh_toan khach_can_tra khach_thanh_toan trang_thai khach_hang_id',
        populate: { path: 'khach_hang_id', select: 'ten_khach_hang ma_khach_hang' }
    },
    {
        path: 'phieu_nhap_id',
        select: 'ma_phieu_nhap ngay_nhap tong_tien can_tra_ncc da_tra_ncc con_no_ncc trang_thai nha_cung_cap_id',
        populate: { path: 'nha_cung_cap_id', select: 'ten_ncc ma_ncc' }
    },
    {
        path: 'phieu_tra_hang_id',
        select: 'ma_phieu_tra ngay_tra tong_tien_tra can_tra_khach khach_can_tra_them trang_thai khach_hang_id',
        populate: { path: 'khach_hang_id', select: 'ten_khach_hang ma_khach_hang' }
    },
    {
        path: 'phieu_tra_hang_nhap_id',
        select: 'ma_phieu_tra_nhap ngay_tra tong_tien_tra ncc_can_tra ncc_da_tra trang_thai nha_cung_cap_id',
        populate: { path: 'nha_cung_cap_id', select: 'ten_ncc ma_ncc' }
    },
    {
        path: 'van_don_id',
        select: 'ma_van_don cod_amount trang_thai_cod trang_thai doi_tac_giao_hang_id khach_hang_id created_at',
        populate: [
            { path: 'doi_tac_giao_hang_id', select: 'ten_doi_tac ma_doi_tac' },
            { path: 'khach_hang_id', select: 'ten_khach_hang ma_khach_hang' }
        ]
    },
    {
        path: 'bang_luong_id',
        select: 'ma_bang_luong ten_bang_luong tu_ngay den_ngay tong_luong da_tra_nhan_vien con_can_tra trang_thai created_at'
    },
    {
        path: 'ct_bang_luong_id',
        select: 'ma_nhan_vien ten_nhan_vien tu_ngay den_ngay tong_luong da_tra con_can_tra trang_thai bang_luong_id nhan_vien_id',
        populate: [
            { path: 'nhan_vien_id', select: 'ma_nhan_vien ten_nhan_vien' },
            { path: 'bang_luong_id', select: 'ma_bang_luong ten_bang_luong tu_ngay den_ngay trang_thai' }
        ]
    },
    {
        path: 'allocations.phieu_nhap_id',
        select: 'ma_phieu_nhap ngay_nhap tong_tien can_tra_ncc da_tra_ncc con_no_ncc trang_thai nha_cung_cap_id',
        populate: { path: 'nha_cung_cap_id', select: 'ten_ncc ma_ncc' }
    }
];

function isObjectId(value) {
    return /^[0-9a-fA-F]{24}$/.test(String(value || ''));
}

function relDocObject(doc) {
    return doc && typeof doc === 'object' ? doc : null;
}

function toNumber(value) {
    return Math.max(0, Number(value) || 0);
}

function receiptPayAmount(receipt, override) {
    const v = override != null ? override : receipt.gia_tri;
    return Math.abs(Number(v) || 0);
}

function formatMoney(value) {
    return Number(value || 0).toLocaleString('vi-VN') + ' VNĐ';
}

function formatDate(value) {
    if (!value) return '';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('vi-VN');
}

function formatDocStatusLabel(value) {
    const key = String(value || '').trim();
    if (!key) return '—';
    const map = {
        partial: 'Thanh toán một phần',
        paid: 'Đã thanh toán',
        unpaid: 'Chưa thanh toán',
        draft: 'Phiếu tạm',
        completed: 'Hoàn thành',
        cancelled: 'Đã hủy',
        processing: 'Đang xử lý',
        shipping: 'Đang giao hàng',
        failed: 'Không giao được',
        done: 'Hoàn thành',
        merged: 'Đã gộp',
        calculated: 'Đã tính lương',
        locked: 'Đã khóa',
        khong_cod: 'Không COD',
        chua_thu: 'Chưa thu COD',
        da_thu: 'Đã thu COD',
        da_doi_soat: 'Đã đối soát COD'
    };
    return map[key] || key;
}

function getRelatedDocumentStatus(type, doc, remainAfter, docTotal) {
    const remain = remainAfter != null && !Number.isNaN(Number(remainAfter)) ? Number(remainAfter) : null;
    if (remain != null) {
        if (remain <= 0) return 'Đã thanh toán';
        const total = Number(docTotal || 0);
        if (total > 0 && remain > 0 && remain < total) return 'Thanh toán một phần';
        if (remain > 0) return 'Còn nợ';
    }
    const d = relDocObject(doc);
    if (!d) return '—';
    if (type === 'shipment' && d.trang_thai_cod) return formatDocStatusLabel(d.trang_thai_cod);
    if (d.trang_thai) return formatDocStatusLabel(d.trang_thai);
    return '—';
}

function paidBeforeFromTotal(docTotal, paidTotal, receiptAmount) {
    const total = Number(docTotal || 0);
    const paid = Number(paidTotal || 0);
    const pay = receiptPayAmount({ gia_tri: receiptAmount }, receiptAmount);
    if (total <= 0 && paid <= 0) return null;
    if (paid > pay) return paid - pay;
    if (paid > 0 && pay >= paid) return 0;
    return paid > 0 ? paid : null;
}

function partnerLabel(entity) {
    if (!entity) return '';
    const name = String(entity.ten_khach_hang || entity.ten_ncc || entity.ten_doi_tac || entity.ten_nhan_vien || '').trim();
    const code = String(entity.ma_khach_hang || entity.ma_ncc || entity.ma_doi_tac || entity.ma_nhan_vien || '').trim();
    if (name && code) return `${name} (${code})`;
    return name || code;
}

function formatReceiptType(loaiPhieu) {
    return loaiPhieu === 'chi' ? 'Phiếu chi' : 'Phiếu thu';
}

function formatReceiptTitle(loaiPhieu) {
    return loaiPhieu === 'chi' ? 'PHIẾU CHI' : 'PHIẾU THU';
}

const GROUP_LABELS = {
    khach_hang: 'Khách hàng',
    nha_cung_cap: 'Nhà cung cấp',
    doi_tac_giao_hang: 'Đối tác giao hàng',
    nhan_vien: 'Nhân viên',
    khac: 'Khác'
};

const PAY_LABELS = {
    tien_mat: 'Tiền mặt',
    chuyen_khoan: 'Chuyển khoản',
    vi_dien_tu: 'Ví điện tử',
    khac: 'Khác'
};

function formatPaymentMethod(receipt, payment) {
    const tienMat = toNumber(payment?.tienMat);
    const chuyenKhoan = toNumber(payment?.chuyenKhoan);
    if (tienMat > 0 && chuyenKhoan > 0) return 'Kết hợp';
    return PAY_LABELS[receipt.phuong_thuc_thanh_toan] || PAY_LABELS.khac;
}

function formatSubject(receipt) {
    if (receipt.doi_tuong) return String(receipt.doi_tuong).trim();
    if (receipt.khach_hang_id) {
        const kh = relDocObject(receipt.khach_hang_id);
        return partnerLabel(kh) || kh?.ten_khach_hang || '';
    }
    if (receipt.nha_cung_cap_id) {
        const ncc = relDocObject(receipt.nha_cung_cap_id);
        return partnerLabel(ncc) || ncc?.ten_ncc || '';
    }
    if (receipt.nhan_vien_id) {
        const nv = relDocObject(receipt.nhan_vien_id);
        return partnerLabel(nv) || nv?.ten_nhan_vien || '';
    }
    if (receipt.doi_tac_giao_hang_id) {
        const dt = relDocObject(receipt.doi_tac_giao_hang_id);
        return partnerLabel(dt) || dt?.ten_doi_tac || '';
    }
    return '';
}

function resolvePaymentDetail(receipt) {
    const detail = receipt.chi_tiet_thanh_toan || {};
    let tienMat = toNumber(detail.tien_mat);
    let chuyenKhoan = toNumber(detail.chuyen_khoan);
    let tienTraKhach = toNumber(detail.tien_tra_khach);
    const giaTri = toNumber(receipt.gia_tri);
    const phuongThuc = receipt.phuong_thuc_thanh_toan || '';
    if (tienMat + chuyenKhoan <= 0 && giaTri > 0) {
        if (phuongThuc === 'chuyen_khoan') chuyenKhoan = giaTri;
        else if (phuongThuc === 'tien_mat') tienMat = giaTri;
    }
    const tongChiTiet = tienMat + chuyenKhoan;
    const giaTriRong = tongChiTiet - tienTraKhach;
    return {
        tienMat,
        chuyenKhoan,
        tienTraKhach,
        giaTri,
        tongChiTiet,
        giaTriRong,
        hasDetail: tongChiTiet > 0 || tienTraKhach > 0
    };
}

function hasReceiptDocRef(receipt) {
    if (!receipt) return false;
    if (receipt.hoa_don_id || receipt.don_hang_id || receipt.phieu_nhap_id) return true;
    if (receipt.phieu_tra_hang_id || receipt.phieu_tra_hang_nhap_id || receipt.van_don_id) return true;
    if (receipt.bang_luong_id || receipt.ct_bang_luong_id) return true;
    return Array.isArray(receipt.allocations) && receipt.allocations.length > 0;
}

async function attachMissingDocRefs(receipt) {
    if (!receipt || hasReceiptDocRef(receipt)) return receipt;
    const code = String(receipt.ma_chung_tu_goc || '').trim();
    if (!code) return receipt;
    if (/^HD/i.test(code) && !receipt.hoa_don_id) {
        const row = await HoaDonBanHang.findOne({ ma_hoa_don: code })
            .select('ma_hoa_don ngay_ban tong_tien thanh_toan trang_thai khach_hang_id')
            .populate({ path: 'khach_hang_id', select: 'ten_khach_hang ma_khach_hang' })
            .lean();
        if (row) receipt.hoa_don_id = row;
    } else if (/^PN/i.test(code) && !receipt.phieu_nhap_id) {
        const row = await PhieuNhap.findOne({ ma_phieu_nhap: code })
            .select('ma_phieu_nhap ngay_nhap tong_tien can_tra_ncc da_tra_ncc con_no_ncc trang_thai nha_cung_cap_id')
            .populate({ path: 'nha_cung_cap_id', select: 'ten_ncc ma_ncc' })
            .lean();
        if (row) receipt.phieu_nhap_id = row;
    } else if (/^DH/i.test(code) && !receipt.don_hang_id) {
        const row = await DonHang.findOne({ ma_don_hang: code })
            .select('ma_don_hang ngay_dat tong_tien tong_thanh_toan khach_can_tra khach_thanh_toan trang_thai khach_hang_id')
            .populate({ path: 'khach_hang_id', select: 'ten_khach_hang ma_khach_hang' })
            .lean();
        if (row) receipt.don_hang_id = row;
    }
    return receipt;
}

function buildRelatedVoucherRows(receipt) {
    const rows = [];
    const defaultReceiptValue = receiptPayAmount(receipt);
    const allocations = Array.isArray(receipt.allocations) ? receipt.allocations : [];
    const pushRow = row => rows.push(row);

    if (allocations.length) {
        allocations.forEach(alloc => {
            const pn = relDocObject(alloc.phieu_nhap_id) || {};
            const docVal = Number(pn.can_tra_ncc || pn.tong_tien || 0)
                || (Number(alloc.con_no_truoc || 0) + Number(alloc.so_tien || 0)) || null;
            let paidBefore = null;
            if (alloc.con_no_truoc != null && docVal > 0) {
                paidBefore = Math.max(0, docVal - Number(alloc.con_no_truoc || 0));
            } else if (pn.da_tra_ncc != null) {
                paidBefore = paidBeforeFromTotal(docVal, pn.da_tra_ncc, Number(alloc.so_tien || 0));
            }
            pushRow({
                typeLabel: 'Phiếu nhập',
                code: String(alloc.ma_phieu_nhap || pn.ma_phieu_nhap || '').trim(),
                docDate: pn.ngay_nhap || pn.created_at,
                partner: partnerLabel(pn.nha_cung_cap_id),
                docValue: docVal,
                paidBefore,
                receiptValue: Number(alloc.so_tien || 0),
                remainAfter: alloc.con_no_sau != null ? Number(alloc.con_no_sau) : null,
                status: getRelatedDocumentStatus('purchase', pn, alloc.con_no_sau, docVal),
                note: ''
            });
        });
        return rows;
    }

    const hd = relDocObject(receipt.hoa_don_id);
    if (hd) {
        const docVal = Number(hd.thanh_toan || hd.tong_tien || 0) || null;
        pushRow({
            typeLabel: 'Hóa đơn',
            code: hd.ma_hoa_don,
            docDate: hd.ngay_ban,
            partner: partnerLabel(hd.khach_hang_id),
            docValue: docVal,
            paidBefore: null,
            receiptValue: defaultReceiptValue,
            remainAfter: null,
            status: getRelatedDocumentStatus('invoice', hd),
            note: ''
        });
    }

    const dh = relDocObject(receipt.don_hang_id);
    if (dh) {
        const docVal = Number(dh.tong_thanh_toan || dh.tong_tien || dh.khach_can_tra || 0) || null;
        const paid = Number(dh.khach_thanh_toan || 0);
        pushRow({
            typeLabel: 'Đơn hàng',
            code: dh.ma_don_hang,
            docDate: dh.ngay_dat,
            partner: partnerLabel(dh.khach_hang_id),
            docValue: docVal,
            paidBefore: paid > 0 ? paid : null,
            receiptValue: defaultReceiptValue,
            remainAfter: dh.khach_can_tra != null
                ? Math.max(0, Number(dh.khach_can_tra || 0) - defaultReceiptValue)
                : null,
            status: getRelatedDocumentStatus('order', dh),
            note: ''
        });
    }

    const pn = relDocObject(receipt.phieu_nhap_id);
    if (pn) {
        const docVal = Number(pn.can_tra_ncc || pn.tong_tien || 0) || null;
        pushRow({
            typeLabel: 'Phiếu nhập',
            code: pn.ma_phieu_nhap,
            docDate: pn.ngay_nhap,
            partner: partnerLabel(pn.nha_cung_cap_id),
            docValue: docVal,
            paidBefore: paidBeforeFromTotal(docVal, pn.da_tra_ncc, defaultReceiptValue),
            receiptValue: defaultReceiptValue,
            remainAfter: pn.con_no_ncc != null ? Number(pn.con_no_ncc) : null,
            status: getRelatedDocumentStatus('purchase', pn, pn.con_no_ncc, docVal),
            note: ''
        });
    }

    const pth = relDocObject(receipt.phieu_tra_hang_id);
    if (pth) {
        const docVal = Number(pth.tong_tien_tra || 0) || null;
        pushRow({
            typeLabel: 'Phiếu trả hàng',
            code: pth.ma_phieu_tra,
            docDate: pth.ngay_tra,
            partner: partnerLabel(pth.khach_hang_id),
            docValue: docVal,
            paidBefore: null,
            receiptValue: defaultReceiptValue,
            remainAfter: pth.can_tra_khach != null ? Number(pth.can_tra_khach) : null,
            status: getRelatedDocumentStatus('customer_return', pth),
            note: ''
        });
    }

    const ptn = relDocObject(receipt.phieu_tra_hang_nhap_id);
    if (ptn) {
        const docVal = Number(ptn.tong_tien_tra || ptn.ncc_can_tra || 0) || null;
        pushRow({
            typeLabel: 'Phiếu trả hàng nhập',
            code: ptn.ma_phieu_tra_nhap,
            docDate: ptn.ngay_tra,
            partner: partnerLabel(ptn.nha_cung_cap_id),
            docValue: docVal,
            paidBefore: Number(ptn.ncc_da_tra || 0) > 0 ? Number(ptn.ncc_da_tra) : null,
            receiptValue: defaultReceiptValue,
            remainAfter: null,
            status: getRelatedDocumentStatus('supplier_return', ptn),
            note: ''
        });
    }

    const vd = relDocObject(receipt.van_don_id);
    if (vd) {
        pushRow({
            typeLabel: 'Vận đơn/COD',
            code: vd.ma_van_don,
            docDate: vd.created_at,
            partner: vd.doi_tac_giao_hang_id
                ? partnerLabel(vd.doi_tac_giao_hang_id)
                : partnerLabel(vd.khach_hang_id),
            docValue: Number(vd.cod_amount || 0) || null,
            paidBefore: null,
            receiptValue: defaultReceiptValue,
            remainAfter: null,
            status: getRelatedDocumentStatus('shipment', vd),
            note: ''
        });
    }

    const bl = relDocObject(receipt.bang_luong_id);
    if (bl) {
        pushRow({
            typeLabel: 'Bảng lương',
            code: bl.ma_bang_luong || bl.ten_bang_luong,
            docDate: bl.tu_ngay || bl.created_at,
            partner: '',
            docValue: Number(bl.tong_luong || 0) || null,
            paidBefore: Number(bl.da_tra_nhan_vien || 0) > 0 ? Number(bl.da_tra_nhan_vien) : null,
            receiptValue: defaultReceiptValue,
            remainAfter: bl.con_can_tra != null ? Number(bl.con_can_tra) : null,
            status: getRelatedDocumentStatus('payroll', bl),
            note: ''
        });
    }

    const ct = relDocObject(receipt.ct_bang_luong_id);
    if (ct) {
        const blParent = relDocObject(ct.bang_luong_id);
        const nv = relDocObject(ct.nhan_vien_id);
        pushRow({
            typeLabel: 'Chi tiết bảng lương',
            code: ct.ma_nhan_vien || (blParent && blParent.ma_bang_luong),
            docDate: ct.tu_ngay || ct.den_ngay,
            partner: nv ? partnerLabel(nv) : String(ct.ten_nhan_vien || ''),
            docValue: Number(ct.tong_luong || 0) || null,
            paidBefore: Number(ct.da_tra || 0) > 0 ? Number(ct.da_tra) : null,
            receiptValue: defaultReceiptValue,
            remainAfter: ct.con_can_tra != null ? Number(ct.con_can_tra) : null,
            status: getRelatedDocumentStatus('payroll', ct),
            note: ''
        });
    }

    if (!rows.length && String(receipt.ma_chung_tu_goc || '').trim()) {
        pushRow({
            typeLabel: 'Chứng từ khác',
            code: receipt.ma_chung_tu_goc,
            docDate: receipt.ngay_lap,
            partner: formatSubject(receipt),
            docValue: null,
            paidBefore: null,
            receiptValue: defaultReceiptValue,
            remainAfter: null,
            status: 'Chứng từ nhập tay',
            note: ''
        });
    }

    return rows;
}

function summarizeRelatedRows(rows) {
    let totalReceiptValue = 0;
    let totalRemainAfter = 0;
    let hasRemain = false;
    let canSumRemain = rows.length > 0;
    rows.forEach(row => {
        totalReceiptValue += Number(row.receiptValue || 0);
        if (row.remainAfter != null && !Number.isNaN(Number(row.remainAfter))) {
            hasRemain = true;
            totalRemainAfter += Number(row.remainAfter);
        } else if (canSumRemain) {
            canSumRemain = false;
        }
    });
    return {
        totalReceiptValue,
        totalRemainAfter: canSumRemain && hasRemain ? totalRemainAfter : null
    };
}

async function loadReceiptForPrint(id) {
    if (!isObjectId(id)) return null;
    let query = PhieuThuChi.findById(id);
    RECEIPT_PRINT_POPULATES.forEach(spec => {
        query = query.populate(spec);
    });
    const receipt = await query.lean();
    if (!receipt) return null;
    await attachMissingDocRefs(receipt);
    let store = relDocObject(receipt.cua_hang_id);
    if (!store && receipt.cua_hang_id) {
        store = await CuaHang.findById(receipt.cua_hang_id)
            .select('ten_cua_hang dia_chi dia_chi_day_du sdt ma_cua_hang')
            .lean();
    }
    return { receipt, store };
}

function buildReceiptPrintData(receipt, store, options = {}) {
    const payment = resolvePaymentDetail(receipt);
    const relatedRows = buildRelatedVoucherRows(receipt);
    const relatedSummary = summarizeRelatedRows(relatedRows);
    const isThu = receipt.loai_phieu === 'thu';
    const amount = receiptPayAmount(receipt);
    const loaiThuChiLabel = receipt.loai_thu_chi
        ? String(receipt.loai_thu_chi).replace(/_/g, ' ')
        : '';

    return {
        receipt,
        store,
        payment,
        relatedRows,
        relatedSummary,
        isThu,
        amount,
        amountWords: numberToVietnameseWords(amount),
        receiptTitle: formatReceiptTitle(receipt.loai_phieu),
        receiptTypeLabel: formatReceiptType(receipt.loai_phieu),
        subjectLabel: isThu ? 'Người nộp tiền' : 'Người nhận tiền',
        subjectName: formatSubject(receipt),
        groupLabel: GROUP_LABELS[receipt.nhom_doi_tuong] || 'Khác',
        paymentMethodLabel: formatPaymentMethod(receipt, payment),
        statusLabel: receipt.trang_thai === 'cancelled' ? 'Đã hủy' : 'Đã thanh toán',
        accountingLabel: receipt.hach_toan ? 'Có' : 'Không',
        cashBookName: receipt.so_quy_id?.ten_so_quy || 'Chưa phân sổ',
        creatorName: receipt.nguoi_tao_id
            ? (receipt.nguoi_tao_id.ho_ten || receipt.nguoi_tao_id.email || '')
            : '',
        tongPaymentLabel: isThu ? 'Tổng khách đưa' : 'Tổng thanh toán',
        netPaymentLabel: isThu ? 'Thực thu' : 'Giá trị ròng',
        relatedPanelTitle: isThu
            ? `BẢNG CHỨNG TỪ LIÊN QUAN\nKèm theo Phiếu thu/${receipt.ma_phieu || ''}`
            : `BẢNG ĐỐI CHIẾU THANH TOÁN\nKèm theo Phiếu chi/${receipt.ma_phieu || ''}`,
        loaiThuChiLabel,
        compactRelatedRows: relatedRows.map(row => ({
            typeLabel: row.typeLabel,
            code: row.code || '—',
            docDate: formatDate(row.docDate) || '—',
            receiptValue: row.receiptValue,
            status: row.status || '—'
        })),
        signPartyLabel: isThu ? 'Người nộp tiền' : 'Người nhận tiền',
        embeddedPrint: options.embeddedPrint === true,
        fmt: v => Number(v || 0).toLocaleString('vi-VN'),
        formatMoney,
        formatDate
    };
}

async function buildReceiptPrintViewData(req, title, options = {}) {
    const loaded = await loadReceiptForPrint(req.params.id);
    if (!loaded) return null;
    const embeddedPrint = String(req.query?.embed || '') === '1';
    const printData = buildReceiptPrintData(loaded.receipt, loaded.store, {
        embeddedPrint: options.embeddedPrint != null ? options.embeddedPrint : embeddedPrint
    });
    return {
        title: title || `In ${printData.receiptTypeLabel} ${loaded.receipt.ma_phieu || ''}`,
        ...printData,
        receiptId: String(loaded.receipt._id)
    };
}

function safePdfName(prefix, receipt) {
    const code = String(receipt?.ma_phieu || 'phieu-thu-chi').replace(/[^\w.-]+/g, '-');
    return `${prefix}-${code}.pdf`;
}

module.exports = {
    RECEIPT_PRINT_POPULATES,
    loadReceiptForPrint,
    attachMissingDocRefs,
    buildReceiptPrintData,
    buildRelatedVoucherRows,
    buildReceiptPrintViewData,
    formatReceiptType,
    formatMoney,
    formatDate,
    numberToVietnameseWords,
    safePdfName,
    viewPath: name => path.join(__dirname, '..', 'views', name + '.ejs')
};
