const { mongoose, ExcelJS, NhaCungCap, PhieuNhap, PhieuTraHangNhap, CongNoNhaCungCap, DiaChiNhaCungCap, LoaiDiaChiKhachHang, Counter, nhaCungCapImportService, normalizeAddress, formatDate, getUserName, normalizeAddressTypeCode } = require('./common.helper');
const { getDateRange } = require('./filter.helper');
const { isVisibleSupplierDebtRow, getDebtDocumentInfo, getSupplierDebtAmountInfo, getLegacySupplierDebtDelta, getDebtDisplayDate, sortDebtLedgerAsc, resolveSupplierDaThanhToan } = require('./debt.helper');
const { mapTraHangStatus, mapSupplierPurchaseHistoryType } = require('./detail.helper');

var SUPPLIER_EXPORT_COLUMNS = [
    { header: 'Mã NCC', key: 'ma_ncc' },
    { header: 'Tên nhà cung cấp', key: 'ten_ncc' },
    { header: 'Người liên hệ', key: 'nguoi_lien_he' },
    { header: 'Điện thoại', key: 'dien_thoai' },
    { header: 'Email', key: 'email' },
    { header: 'Địa chỉ', key: 'dia_chi' },
    { header: 'Tỉnh/TP', key: 'tinh_tp' },
    { header: 'Phường/Xã', key: 'phuong_xa' },
    { header: 'Mã số thuế', key: 'ma_so_thue' },
    { header: 'Nhóm nhà cung cấp', key: 'nhom_nha_cung_cap' },
    { header: 'Tổng mua', key: 'tong_mua', style: { numFmt: '#,##0' } },
    { header: 'Đã trả NCC', key: 'da_tra_ncc', style: { numFmt: '#,##0' } },
    { header: 'Nợ NCC', key: 'no_ncc', style: { numFmt: '#,##0' } },
    { header: 'Trạng thái', key: 'trang_thai' },
    { header: 'Ngày tạo', key: 'ngay_tao' },
    { header: 'Người tạo', key: 'nguoi_tao' },
    { header: 'Ghi chú', key: 'ghi_chu' }
];

function buildSupplierExportRow(supplier, address) {
    var debt = Number(supplier.tong_no || 0);
    var totalBuy = Number(supplier.tong_mua || 0);
    var paid = resolveSupplierDaThanhToan(supplier);
    return {
        ma_ncc: supplier.ma_ncc || '',
        ten_ncc: supplier.ten_ncc || '',
        nguoi_lien_he: address ? (address.ten_nguoi_nhan || '') : '',
        dien_thoai: supplier.sdt || (address ? address.sdt_nguoi_nhan || '' : ''),
        email: supplier.email || '',
        dia_chi: address ? (address.dia_chi_day_du || address.dia_chi_chi_tiet || '') : '',
        tinh_tp: address ? (address.tinh_thanh || '') : '',
        phuong_xa: address ? (address.phuong_xa || '') : '',
        ma_so_thue: supplier.ma_so_thue || '',
        nhom_nha_cung_cap: supplier.nhom_nha_cung_cap_id ? (supplier.nhom_nha_cung_cap_id.ten_nhom_ncc || '') : '',
        tong_mua: totalBuy,
        da_tra_ncc: paid,
        no_ncc: debt,
        trang_thai: getSupplierStatusLabel(supplier.trang_thai),
        ngay_tao: formatExportDate(supplier.created_at),
        nguoi_tao: getUserName(supplier.nguoi_tao_id),
        ghi_chu: supplier.ghi_chu || ''
    };
}

function applySupplierWorksheetFormat(worksheet) {
    var headerRow = worksheet.getRow(1);
    headerRow.eachCell(function(cell) {
        cell.font = { bold: true, color: { argb: 'FF111827' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAF3FF' } };
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        cell.border = {
            top: { style: 'thin', color: { argb: 'FFD8E8FB' } },
            bottom: { style: 'thin', color: { argb: 'FFD8E8FB' } },
            left: { style: 'thin', color: { argb: 'FFD8E8FB' } },
            right: { style: 'thin', color: { argb: 'FFD8E8FB' } }
        };
    });
    worksheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: worksheet.columns.length }
    };
    worksheet.views = [{ state: 'frozen', ySplit: 1 }];
    worksheet.eachRow(function(row, rowNumber) {
        if (rowNumber === 1) return;
        row.eachCell(function(cell) {
            cell.border = {
                top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
                bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
                left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
                right: { style: 'thin', color: { argb: 'FFE5E7EB' } }
            };
            cell.alignment = { vertical: 'middle' };
        });
    });
    worksheet.columns.forEach(function(column) {
        var maxLength = String(column.header || '').length;
        column.eachCell({ includeEmpty: true }, function(cell) {
            var value = cell.value == null ? '' : String(cell.value);
            maxLength = Math.max(maxLength, value.length);
        });
        column.width = Math.min(Math.max(maxLength + 2, 12), 36);
    });
}

function formatExportDate(value) {
    if (!value) return '';
    return new Date(value).toLocaleString('vi-VN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });
}

function getSupplierStatusLabel(value) {
    return value === 'inactive' ? 'Ngừng hoạt động' : 'Đang hoạt động';
}

function slugifyFilePart(value) {
    var s = String(value || 'ncc').trim().replace(/[/\\?%*:|"<>]/g, '-');
    s = s.replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    return s || 'ncc';
}

async function exportSupplierDetailWorkbook(section, supplier, storeId) {
    var workbook = new ExcelJS.Workbook();
    var safeMa = slugifyFilePart(supplier.ma_ncc);
    if (section === 'info') {
        var ws = workbook.addWorksheet('Thông tin');
        ws.columns = [
            { header: 'Mã NCC', key: 'ma_ncc', width: 14 },
            { header: 'Tên NCC', key: 'ten_ncc', width: 28 },
            { header: 'Tên công ty', key: 'ten_cong_ty', width: 28 },
            { header: 'Mã số thuế', key: 'ma_so_thue', width: 16 },
            { header: 'Điện thoại', key: 'sdt', width: 14 },
            { header: 'Email', key: 'email', width: 24 },
            { header: 'Tổng nợ', key: 'tong_no', style: { numFmt: '#,##0' } },
            { header: 'Đã thanh toán', key: 'da_thanh_toan', style: { numFmt: '#,##0' } },
            { header: 'Tổng mua', key: 'tong_mua', style: { numFmt: '#,##0' } },
            { header: 'Trạng thái', key: 'trang_thai', width: 18 },
            { header: 'Ghi chú', key: 'ghi_chu', width: 36 }
        ];
        var totalsMap = await aggregateSupplierPurchaseTotals(storeId);
        applySupplierTotalsFromMap(supplier, totalsMap);
        ws.addRow({
            ma_ncc: supplier.ma_ncc || '',
            ten_ncc: supplier.ten_ncc || '',
            ten_cong_ty: supplier.ten_cong_ty || '',
            ma_so_thue: supplier.ma_so_thue || '',
            sdt: supplier.sdt || '',
            email: supplier.email || '',
            tong_no: Number(supplier.tong_no || 0),
            da_thanh_toan: resolveSupplierDaThanhToan(supplier),
            tong_mua: Number(supplier.tong_mua || 0),
            trang_thai: getSupplierStatusLabel(supplier.trang_thai),
            ghi_chu: supplier.ghi_chu || ''
        });
        applySupplierWorksheetFormat(ws);
        return { workbook: workbook, filename: 'ncc-' + safeMa + '-thong-tin.xlsx' };
    }
    if (section === 'address') {
        var wsA = workbook.addWorksheet('Địa chỉ');
        wsA.columns = [
            { header: 'Mã địa chỉ', key: 'ma_dia_chi', width: 14 },
            { header: 'Tên người nhận', key: 'ten_nguoi_nhan', width: 22 },
            { header: 'SĐT', key: 'sdt', width: 14 },
            { header: 'Địa chỉ đầy đủ', key: 'dia_chi_day_du', width: 36 },
            { header: 'Địa chỉ chi tiết', key: 'dia_chi_chi_tiet', width: 20 },
            { header: 'Phường/Xã', key: 'phuong_xa', width: 16 },
            { header: 'Tỉnh/Thành', key: 'tinh_thanh', width: 16 },
            { header: 'Loại địa chỉ', key: 'loai_dia_chi', width: 14 },
            { header: 'Mặc định', key: 'mac_dinh', width: 10 },
            { header: 'Ghi chú', key: 'ghi_chu', width: 28 },
            { header: 'Tạo lúc', key: 'tao_luc', width: 20 }
        ];
        var addrList = await DiaChiNhaCungCap.find({ nha_cung_cap_id: supplier._id }).sort({ created_at: -1 }).lean();
        addrList.forEach(function(a) {
            wsA.addRow({
                ma_dia_chi: a.ma_dia_chi || '',
                ten_nguoi_nhan: a.ten_nguoi_nhan || '',
                sdt: a.sdt_nguoi_nhan || '',
                dia_chi_day_du: a.dia_chi_day_du || '',
                dia_chi_chi_tiet: a.dia_chi_chi_tiet || '',
                phuong_xa: a.phuong_xa || '',
                tinh_thanh: a.tinh_thanh || '',
                loai_dia_chi: a.loai_dia_chi || '',
                mac_dinh: a.mac_dinh ? 'Có' : 'Không',
                ghi_chu: a.ghi_chu || '',
                tao_luc: formatExportDate(a.created_at)
            });
        });
        applySupplierWorksheetFormat(wsA);
        return { workbook: workbook, filename: 'ncc-' + safeMa + '-dia-chi.xlsx' };
    }
    if (section === 'history') {
        var wsH = workbook.addWorksheet('Lịch sử');
        wsH.columns = [
            { header: 'Loại phiếu', key: 'loai_phieu', width: 22 },
            { header: 'Mã phiếu', key: 'ma_phieu', width: 18 },
            { header: 'Ngày', key: 'ngay', width: 20 },
            { header: 'Tổng tiền', key: 'tong_tien', style: { numFmt: '#,##0' } },
            { header: 'Đã trả', key: 'da_tra', style: { numFmt: '#,##0' } },
            { header: 'Còn nợ', key: 'con_no', style: { numFmt: '#,##0' } },
            { header: 'Trạng thái', key: 'trang_thai', width: 16 }
        ];
        var pnMatch = { nha_cung_cap_id: supplier._id, trang_thai: { $in: ['completed', 'draft', 'cancelled'] } };
        if (storeId && mongoose.Types.ObjectId.isValid(storeId)) pnMatch.cua_hang_id = storeId;
        var nhapRows = await PhieuNhap.find(pnMatch).sort({ ngay_nhap: -1, created_at: -1 }).lean();
        nhapRows.forEach(function(row) {
            wsH.addRow({
                loai_phieu: 'Phiếu nhập',
                ma_phieu: row.ma_phieu_nhap || '',
                ngay: formatExportDate(row.ngay_nhap || row.created_at),
                tong_tien: Number(row.can_tra_ncc || row.tong_tien || 0),
                da_tra: Number(row.da_tra_ncc || 0),
                con_no: Number(row.con_no_ncc || 0),
                trang_thai: mapNhapHangStatus(row.trang_thai)
            });
        });
        if (PhieuTraHangNhap) {
            var ptMatch = { nha_cung_cap_id: supplier._id, trang_thai: { $ne: 'cancelled' } };
            if (storeId && mongoose.Types.ObjectId.isValid(storeId)) ptMatch.cua_hang_id = storeId;
            var traRows = await PhieuTraHangNhap.find(ptMatch).sort({ ngay_tra: -1, created_at: -1 }).lean();
            traRows.forEach(function(row) {
                var can = Number(row.ncc_can_tra || row.tong_tien_tra || 0);
                var da = Number(row.ncc_da_tra || 0);
                wsH.addRow({
                    loai_phieu: 'Phiếu trả hàng nhập',
                    ma_phieu: row.ma_phieu_tra_nhap || '',
                    ngay: formatExportDate(row.ngay_tra || row.created_at),
                    tong_tien: Number(row.tong_tien_tra || 0),
                    da_tra: da,
                    con_no: Math.max(0, can - da),
                    trang_thai: mapTraHangStatus(row.trang_thai)
                });
            });
        }
        applySupplierWorksheetFormat(wsH);
        return { workbook: workbook, filename: 'ncc-' + safeMa + '-lich-su.xlsx' };
    }
    if (section === 'xnb') {
        var wsX = workbook.addWorksheet('Xuat dung noi bo');
        wsX.columns = [
            { header: 'Mã xuất nội bộ', key: 'ma_xuat_noi_bo', width: 18 },
            { header: 'Loại xuất', key: 'loai_xuat', width: 22 },
            { header: 'Kho', key: 'kho', width: 18 },
            { header: 'Tổng SL', key: 'tong_so_luong', style: { numFmt: '#,##0' } },
            { header: 'Tổng giá trị', key: 'tong_gia_tri', style: { numFmt: '#,##0' } },
            { header: 'Ngày xuất', key: 'ngay_xuat', width: 20 },
            { header: 'Người tạo', key: 'nguoi_tao', width: 20 },
            { header: 'Người nhận', key: 'nguoi_nhan', width: 22 },
            { header: 'Trạng thái', key: 'trang_thai', width: 14 },
            { header: 'Ghi chú', key: 'ghi_chu', width: 32 }
        ];
        var xnbRows = await loadSupplierInternalExportHistory(supplier, storeId);
        xnbRows.forEach(function(row) {
            wsX.addRow({
                ma_xuat_noi_bo: row.ma_xuat_noi_bo || '',
                loai_xuat: row.loai_xuat || '',
                kho: row.kho || '',
                tong_so_luong: Number(row.tong_so_luong || 0),
                tong_gia_tri: Number(row.tong_gia_tri || 0),
                ngay_xuat: formatExportDate(row.thoi_gian),
                nguoi_tao: row.nguoi_tao || '',
                nguoi_nhan: row.nguoi_nhan || '',
                trang_thai: mapXuatNoiBoStatus(row.trang_thai),
                ghi_chu: row.ghi_chu || ''
            });
        });
        applySupplierWorksheetFormat(wsX);
        return { workbook: workbook, filename: 'ncc-' + safeMa + '-xuat-dung-noi-bo.xlsx' };
    }
    if (section === 'hang-hoa' || section === 'hang_hoa') {
        return buildSupplierHangHoaExportPack(supplier, storeId);
    }
    if (section === 'hoa-don-gop' || section === 'hoa_don_gop' || section === 'chi-tiet-nhap') {
        return buildSupplierPurchaseInvoiceExportPack(supplier, storeId);
    }
    return null;
}

function isValidSupplierImportCode(value) {
    return /^NCC\d+$/.test(String(value || '').trim());
}

function isValidSupplierAddressImportCode(value) {
    return /^DCNCC\d+$/.test(String(value || '').trim());
}

async function makeSupplierAddressCode() {
    var addresses = await DiaChiNhaCungCap.find({ ma_dia_chi: /^DCNCC\d+$/ }).select('ma_dia_chi').lean();
    var maxNumber = 0;

    for (var address of addresses) {
        if (address.ma_dia_chi) {
            var num = Number(address.ma_dia_chi.replace(/\D/g, ''));
            if (num > maxNumber) maxNumber = num;
        }
    }

    return 'DCNCC' + String(maxNumber + 1).padStart(4, '0');
}

function normalizeImportLookupText(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

async function buildSupplierImportAddressTypeState() {
    var types = await LoaiDiaChiKhachHang.find().lean();
    var state = {
        lookup: {},
        codes: {}
    };

    types.forEach(function(type) {
        if (!type || !type.ma_loai) return;
        state.codes[type.ma_loai] = true;
        state.lookup[normalizeImportLookupText(type.ma_loai)] = type;
        if (type.ten_loai) state.lookup[normalizeImportLookupText(type.ten_loai)] = type;
    });

    if (!state.lookup[normalizeImportLookupText('khac')] && !state.lookup[normalizeImportLookupText('Khác')]) {
        var created = await LoaiDiaChiKhachHang.create({ ma_loai: 'khac', ten_loai: 'Khác', trang_thai: 'active' });
        var type = created.toObject ? created.toObject() : created;
        state.codes.khac = true;
        state.lookup[normalizeImportLookupText('khac')] = type;
        state.lookup[normalizeImportLookupText('Khác')] = type;
    }

    return state;
}

async function resolveSupplierImportAddressType(text, state) {
    state = state || { lookup: {}, codes: {} };
    var raw = String(text || '').trim();
    var key = normalizeImportLookupText(raw || 'Khác');
    if (state.lookup[key]) return state.lookup[key].ma_loai;

    var tenLoai = raw || 'Khác';
    var baseCode = normalizeAddressTypeCode(tenLoai);
    var code = baseCode;
    var index = 2;
    while (state.codes[code] || await LoaiDiaChiKhachHang.exists({ ma_loai: code })) {
        code = baseCode + '_' + index;
        index += 1;
    }

    var created = await LoaiDiaChiKhachHang.create({
        ma_loai: code,
        ten_loai: tenLoai,
        trang_thai: 'active'
    });
    var type = created.toObject ? created.toObject() : created;
    state.codes[code] = true;
    state.lookup[normalizeImportLookupText(code)] = type;
    state.lookup[normalizeImportLookupText(tenLoai)] = type;
    return code;
}

module.exports = {
  SUPPLIER_EXPORT_COLUMNS,
  buildSupplierExportRow,
  applySupplierWorksheetFormat,
  formatExportDate,
  getSupplierStatusLabel,
  slugifyFilePart,
  exportSupplierDetailWorkbook,
  isValidSupplierImportCode,
  isValidSupplierAddressImportCode,
  makeSupplierAddressCode,
  normalizeImportLookupText,
  buildSupplierImportAddressTypeState,
  resolveSupplierImportAddressType
};
