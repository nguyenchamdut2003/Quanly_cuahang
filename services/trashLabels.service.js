/** Nhãn tiếng Việt cho người dùng — không dùng tên bảng/model kỹ thuật */
const ENTITY_LABELS = {
  PhieuNhap: 'Phiếu nhập hàng',
  DonHang: 'Đơn đặt hàng',
  HoaDonBanHang: 'Hóa đơn bán hàng',
  PhieuTraHang: 'Phiếu trả hàng bán',
  PhieuTraHangNhap: 'Phiếu trả hàng nhập',
  KhachHang: 'Khách hàng',
  NhaCungCap: 'Nhà cung cấp',
  HangHoa: 'Hàng hóa',
  CuaHang: 'Cửa hàng',
  Kho: 'Kho',
  SoQuy: 'Sổ quỹ',
  PhieuThuChi: 'Phiếu thu / chi tiền',
  VanDon: 'Vận đơn giao hàng',
  PhieuKiemKho: 'Phiếu kiểm kho',
  PhieuXuatNoiBo: 'Phiếu xuất nội bộ',
  PhieuXuatHuy: 'Phiếu xuất hủy',
  VatChua: 'Vật chứa',
  GopHoaDon: 'Gộp hóa đơn',
  GopDonHang: 'Gộp đơn hàng',
  GopPhieuNhap: 'Gộp phiếu nhập',
  CTPhieuNhap: 'Dòng hàng trên phiếu nhập',
  CTDonHang: 'Dòng hàng trên đơn đặt',
  CTHoaDonBanHang: 'Dòng hàng trên hóa đơn',
  CTPhieuTraHang: 'Dòng trả hàng bán',
  CTPhieuTraHangNhap: 'Dòng trả hàng nhập',
  CTPhanBoHang: 'Dòng phân bổ hàng',
  CongNoKhachHang: 'Công nợ khách hàng',
  CongNoNhaCungCap: 'Công nợ nhà cung cấp',
  GiaoDichCongNoKhachHang: 'Giao dịch công nợ khách',
  GiaoDichCongNoNhaCungCap: 'Giao dịch công nợ NCC',
  HoaDonDauVao: 'Hóa đơn đầu vào',
  LoHang: 'Lô hàng',
  NhapVatChua: 'Nhập vật chứa (thùng, bao…)',
  XuatVatChua: 'Xuất vật chứa (thùng, bao…)',
  PhanBoHang: 'Phiếu phân bổ hàng',
  PhieuNhap_merged: 'Phiếu nhập đã gộp vào phiếu khác',
  DonHang_merged: 'Đơn đặt hàng đã gộp vào đơn khác',
  HoaDonBanHang_merged: 'Hóa đơn đã gộp vào hóa đơn khác'
};

function entityLabel(entityType) {
  const key = String(entityType || '').trim();
  if (ENTITY_LABELS[key]) return ENTITY_LABELS[key];
  return 'Dữ liệu liên quan';
}

function buildTrashChildFields(group) {
  const count = Number(group && group.count || 0);
  const label = (group && group.label) || entityLabel(group && group.entity_type);
  const samples = Array.isArray(group && group.samples)
    ? group.samples.filter(Boolean)
    : [];
  const countText = count.toLocaleString('vi-VN') + ' mục';
  let moTa = countText;
  if (samples.length) {
    moTa += ' · Mã tham chiếu: ' + samples.slice(0, 3).join(', ');
  }
  return {
    ma_chung_tu: samples[0] ? String(samples[0]) : '',
    ten_hien_thi: label,
    mo_ta_phu: moTa
  };
}

/** Chuẩn hóa hiển thị mục con đã lưu theo format cũ ("2 bản ghi") */
function formatTrashChildName(item) {
  if (!item) return '---';
  const legacy = String(item.ten_hien_thi || '').match(/^(\d[\d.,]*)\s*bản ghi$/i);
  if (legacy) {
    return legacy[1].replace(/\./g, '') + ' mục liên quan';
  }
  const moTa = String(item.mo_ta_phu || '');
  const countMatch = moTa.match(/^([\d.,]+)\s*mục\b/i);
  if (countMatch) {
    return countMatch[1].replace(/\./g, '') + ' mục';
  }
  if (item.ma_chung_tu) return item.ma_chung_tu;
  return item.ten_hien_thi || '---';
}

function formatTrashChildDesc(item) {
  if (!item) return '---';
  const legacy = String(item.ten_hien_thi || '').match(/^\d[\d.,]*\s*bản ghi$/i);
  if (legacy) {
    const label = entityLabel(item.entity_type);
    let desc = label;
    if (item.mo_ta_phu) {
      const extra = String(item.mo_ta_phu).replace(/^Ví dụ:\s*/i, 'Mã tham chiếu: ');
      if (extra) desc += ' · ' + extra;
    }
    return desc;
  }
  const moTa = String(item.mo_ta_phu || '').trim();
  if (!moTa) return '---';
  const parts = moTa.split('·').map(function(part) { return part.trim(); }).filter(Boolean);
  if (parts.length > 1) return parts.slice(1).join(' · ');
  return moTa;
}

module.exports = {
  ENTITY_LABELS,
  entityLabel,
  buildTrashChildFields,
  formatTrashChildName,
  formatTrashChildDesc
};
