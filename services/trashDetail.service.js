const mongoose = require('mongoose');
const { ThungRacItem } = require('../models/trash.model');
const {
  PhieuNhap,
  DonHang,
  HoaDonBanHang,
  CTPhieuNhap,
  CTDonHang,
  CTHoaDonBanHang,
  PhieuTraHangNhap,
  CTPhieuTraHangNhap,
  PhieuTraHang,
  CTPhieuTraHang,
  PhieuThuChi,
  CongNoNhaCungCap,
  CongNoKhachHang,
  GiaoDichCongNoNhaCungCap,
  GiaoDichCongNoKhachHang,
  HoaDonDauVao,
  LoHang,
  VanDon,
  GopPhieuNhap,
  GopDonHang,
  GopHoaDon,
  PhanBoHang,
  CTPhanBoHang,
  NhapVatChua,
  XuatVatChua
} = require('../models/kiot.model');
const { entityLabel } = require('./trashLabels.service');

const ROOT_SOURCE_TYPE = {
  PhieuNhap: 'phieu_nhap',
  DonHang: 'don_hang',
  HoaDonBanHang: 'hoa_don'
};

function createHttpError(statusCode, message) {
  const error = new Error(message || 'Yêu cầu không hợp lệ');
  error.statusCode = statusCode || 400;
  return error;
}

function fmtNum(value) {
  return Number(value || 0).toLocaleString('vi-VN');
}

function fmtMoney(value) {
  return fmtNum(value) + ' VNĐ';
}

function fmtDateTime(value) {
  if (!value) return '---';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '---';
  return d.toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function parseCodesFromMoTa(moTa) {
  const text = String(moTa || '');
  const match = text.match(/Mã tham chiếu:\s*(.+)$/i) || text.match(/Ví dụ:\s*(.+)$/i);
  if (!match) return [];
  return match[1].split(',').map(function(part) { return part.trim(); }).filter(Boolean);
}

function pickRowCode(row, entityType) {
  if (!row) return '';
  switch (entityType) {
    case 'CTPhieuNhap':
    case 'CTDonHang':
    case 'CTHoaDonBanHang':
    case 'CTPhieuTraHang':
    case 'CTPhieuTraHangNhap':
    case 'CTPhanBoHang':
      return row.ma_hang_snapshot
        || row.hang_hoa_id?.ma_hang
        || row.hang_hoa_id?.ma_hang_hoa
        || '';
    case 'PhieuThuChi':
      return row.ma_phieu || '';
    case 'VanDon':
      return row.ma_van_don || '';
    case 'PhieuTraHang':
      return row.ma_phieu_tra || '';
    case 'PhieuTraHangNhap':
      return row.ma_phieu_tra_nhap || '';
    case 'HoaDonBanHang':
      return row.ma_hoa_don || '';
    case 'NhapVatChua':
      return row.ma_nhap_vat_chua || '';
    case 'XuatVatChua':
      return row.ma_xuat_vat_chua || '';
    case 'GopHoaDon':
      return row.ma_gop_hoa_don || '';
    case 'GopDonHang':
      return row.ma_gop_don || '';
    case 'GopPhieuNhap':
      return row.ma_gop_phieu_nhap || '';
    case 'PhanBoHang':
      return row.ma_phan_bo || '';
    case 'LoHang':
      return row.ma_lo || '';
    case 'HoaDonDauVao':
      return row.ma_hoa_don || row.ma_phieu || '';
    case 'GiaoDichCongNoKhachHang':
    case 'GiaoDichCongNoNhaCungCap':
      return row.ma_giao_dich || '';
    default:
      return row.ma_chung_tu || row.ma_phieu || row.ma || '';
  }
}

async function loadReturnSlipIdsForInvoice(invoiceId) {
  const slips = await PhieuTraHang.find({
    hoa_don_id: invoiceId,
    trang_thai: { $ne: 'cancelled' }
  }).select('_id').lean();
  return slips.map(function(row) { return row._id; });
}

async function loadReturnSlipIdsForOrder(orderId) {
  const invoices = await HoaDonBanHang.find({ don_hang_id: orderId }).select('_id').lean();
  const invoiceIds = invoices.map(function(row) { return row._id; });
  if (!invoiceIds.length) return [];
  const slips = await PhieuTraHang.find({
    hoa_don_id: { $in: invoiceIds },
    trang_thai: { $ne: 'cancelled' }
  }).select('_id').lean();
  return slips.map(function(row) { return row._id; });
}

async function loadPhanBoIdsForOrder(orderId) {
  const rows = await PhanBoHang.find({
    don_hang_id: orderId,
    trang_thai: { $ne: 'cancelled' }
  }).select('_id').lean();
  return rows.map(function(row) { return row._id; });
}

async function loadRelatedRawRows(entityType, parentId, rootEntityType) {
  const parentOid = new mongoose.Types.ObjectId(parentId);
  const sourceType = ROOT_SOURCE_TYPE[rootEntityType] || '';

  switch (entityType) {
    case 'CTPhieuNhap':
      return CTPhieuNhap.find({ phieu_nhap_id: parentOid })
        .populate('hang_hoa_id', 'ma_hang ten_hang')
        .sort({ _id: 1 })
        .lean();
    case 'CTDonHang':
      return CTDonHang.find({ don_hang_id: parentOid })
        .populate('hang_hoa_id', 'ma_hang ten_hang')
        .sort({ _id: 1 })
        .lean();
    case 'CTHoaDonBanHang':
      return CTHoaDonBanHang.find({ hoa_don_id: parentOid })
        .populate('hang_hoa_id', 'ma_hang ten_hang')
        .sort({ _id: 1 })
        .lean();
    case 'PhieuTraHangNhap':
      return PhieuTraHangNhap.find({ phieu_nhap_id: parentOid, trang_thai: { $ne: 'cancelled' } })
        .sort({ created_at: -1 })
        .lean();
    case 'CTPhieuTraHangNhap':
      return CTPhieuTraHangNhap.find({ phieu_nhap_id: parentOid })
        .populate('hang_hoa_id', 'ma_hang ten_hang')
        .sort({ _id: 1 })
        .lean();
    case 'PhieuTraHang':
      if (rootEntityType === 'HoaDonBanHang') {
        return PhieuTraHang.find({ hoa_don_id: parentOid, trang_thai: { $ne: 'cancelled' } }).lean();
      }
      if (rootEntityType === 'DonHang') {
        const invoiceIds = (await HoaDonBanHang.find({ don_hang_id: parentOid }).select('_id').lean())
          .map(function(row) { return row._id; });
        if (!invoiceIds.length) return [];
        return PhieuTraHang.find({ hoa_don_id: { $in: invoiceIds }, trang_thai: { $ne: 'cancelled' } }).lean();
      }
      return [];
    case 'CTPhieuTraHang': {
      let slipIds = [];
      if (rootEntityType === 'HoaDonBanHang') {
        slipIds = await loadReturnSlipIdsForInvoice(parentOid);
      } else if (rootEntityType === 'DonHang') {
        slipIds = await loadReturnSlipIdsForOrder(parentOid);
      }
      if (!slipIds.length) return [];
      return CTPhieuTraHang.find({ phieu_tra_hang_id: { $in: slipIds } })
        .populate('hang_hoa_id', 'ma_hang ten_hang')
        .lean();
    }
    case 'PhieuThuChi': {
      const filter = { trang_thai: { $ne: 'cancelled' } };
      if (rootEntityType === 'PhieuNhap') filter.phieu_nhap_id = parentOid;
      else if (rootEntityType === 'DonHang') filter.don_hang_id = parentOid;
      else if (rootEntityType === 'HoaDonBanHang') filter.hoa_don_id = parentOid;
      else return [];
      return PhieuThuChi.find(filter).sort({ ngay_lap: -1 }).lean();
    }
    case 'CongNoNhaCungCap':
      return CongNoNhaCungCap.find({ phieu_nhap_id: parentOid }).sort({ ngay: -1 }).lean();
    case 'CongNoKhachHang':
      if (rootEntityType === 'HoaDonBanHang') {
        return CongNoKhachHang.find({ hoa_don_id: parentOid }).sort({ ngay: -1 }).lean();
      }
      if (rootEntityType === 'DonHang') {
        return CongNoKhachHang.find({ don_hang_id: parentOid }).sort({ ngay: -1 }).lean();
      }
      return [];
    case 'GiaoDichCongNoNhaCungCap':
      return GiaoDichCongNoNhaCungCap.find({
        phieu_nhap_id: parentOid,
        trang_thai: { $ne: 'cancelled' }
      }).sort({ ngay_giao_dich: -1 }).lean();
    case 'GiaoDichCongNoKhachHang': {
      const filter = { trang_thai: { $ne: 'cancelled' } };
      if (rootEntityType === 'HoaDonBanHang') filter.hoa_don_id = parentOid;
      else if (rootEntityType === 'DonHang') filter.don_hang_id = parentOid;
      else return [];
      return GiaoDichCongNoKhachHang.find(filter).sort({ ngay_giao_dich: -1 }).lean();
    }
    case 'HoaDonDauVao':
      return HoaDonDauVao.find({ phieu_nhap_id: parentOid, trang_thai: { $ne: 'cancelled' } }).lean();
    case 'LoHang':
      return LoHang.find({ phieu_nhap_id: parentOid }).sort({ created_at: -1 }).lean();
    case 'VanDon':
      if (rootEntityType === 'HoaDonBanHang') {
        return VanDon.find({ hoa_don_id: parentOid, trang_thai: { $ne: 'cancelled' } }).lean();
      }
      if (rootEntityType === 'DonHang') {
        return VanDon.find({ don_hang_id: parentOid, trang_thai: { $ne: 'cancelled' } }).lean();
      }
      return [];
    case 'HoaDonBanHang':
      return HoaDonBanHang.find({ don_hang_id: parentOid, trang_thai: { $ne: 'cancelled' } })
        .sort({ created_at: -1 })
        .lean();
    case 'GopPhieuNhap':
      return GopPhieuNhap.find({
        $or: [{ phieu_nhan_id: parentOid }, { phieu_nguon_ids: parentOid }],
        trang_thai: { $ne: 'cancelled' }
      }).lean();
    case 'GopDonHang':
      return GopDonHang.find({
        $or: [{ don_nhan_id: parentOid }, { don_nguon_ids: parentOid }],
        trang_thai: { $ne: 'cancelled' }
      }).lean();
    case 'GopHoaDon':
      return GopHoaDon.find({
        $or: [{ hoa_don_nhan_id: parentOid }, { hoa_don_nguon_ids: parentOid }],
        trang_thai: { $ne: 'cancelled' }
      }).lean();
    case 'PhanBoHang':
      return PhanBoHang.find({ don_hang_id: parentOid, trang_thai: { $ne: 'cancelled' } }).lean();
    case 'CTPhanBoHang': {
      const phanBoIds = await loadPhanBoIdsForOrder(parentOid);
      if (!phanBoIds.length) return [];
      return CTPhanBoHang.find({ phan_bo_hang_id: { $in: phanBoIds } })
        .populate('hang_hoa_id', 'ma_hang ten_hang')
        .lean();
    }
    case 'NhapVatChua':
      if (!sourceType) return [];
      return NhapVatChua.find({
        source_type: sourceType,
        source_id: parentOid,
        trang_thai: { $ne: 'cancelled' }
      }).lean();
    case 'XuatVatChua':
      if (!sourceType) return [];
      return XuatVatChua.find({
        source_type: sourceType,
        source_id: parentOid,
        trang_thai: { $ne: 'cancelled' }
      }).lean();
    case 'PhieuNhap_merged': {
      const doc = await PhieuNhap.findById(parentOid).select('merged_from_ma_phieu_nhaps').lean();
      return (doc?.merged_from_ma_phieu_nhaps || []).map(function(ma, index) {
        return { _id: index, ma_phieu: ma };
      });
    }
    case 'DonHang_merged': {
      const doc = await DonHang.findById(parentOid).select('merged_from_ma_don_hangs').lean();
      return (doc?.merged_from_ma_don_hangs || []).map(function(ma, index) {
        return { _id: index, ma_don_hang: ma };
      });
    }
    case 'HoaDonBanHang_merged': {
      const doc = await HoaDonBanHang.findById(parentOid).select('merged_from_ma_hoa_dons').lean();
      return (doc?.merged_from_ma_hoa_dons || []).map(function(ma, index) {
        return { _id: index, ma_hoa_don: ma };
      });
    }
    default:
      return [];
  }
}

function makeSection(title, columns, rows) {
  return {
    title: title,
    columns: columns,
    rows: Array.isArray(rows) ? rows : []
  };
}

function countSectionRows(sections) {
  return (sections || []).reduce(function(sum, section) {
    return sum + (Array.isArray(section.rows) ? section.rows.length : 0);
  }, 0);
}

function buildDetailPayload(title, subtitle, sections) {
  const safeSections = (sections || []).filter(function(section) {
    return section && Array.isArray(section.rows) && section.rows.length > 0;
  });
  const total = countSectionRows(safeSections);
  const first = safeSections[0];
  return {
    title: title,
    subtitle: subtitle,
    sections: safeSections,
    total: total,
    columns: first ? first.columns : [],
    rows: first ? first.rows : []
  };
}

function buildVatChuaItemsTable(docs, kind) {
  const rows = [];
  (docs || []).forEach(function(doc) {
    const maPhieu = kind === 'nhap' ? (doc.ma_nhap_vat_chua || '---') : (doc.ma_xuat_vat_chua || '---');
    const items = Array.isArray(doc.items) ? doc.items : [];
    if (!items.length) {
      rows.push({
        ma_phieu: maPhieu,
        ma_vat_chua: '---',
        ten_vat_chua: '---',
        so_luong: fmtNum(doc.tong_so_luong),
        thanh_tien: fmtMoney(doc.tong_tien)
      });
      return;
    }
    items.forEach(function(item) {
      rows.push({
        ma_phieu: maPhieu,
        ma_vat_chua: item.ma_vat_chua || '---',
        ten_vat_chua: item.ten_vat_chua || item.ma_vat_chua || '---',
        so_luong: fmtNum(item.so_luong),
        thanh_tien: fmtMoney(item.thanh_tien)
      });
    });
  });
  return {
    columns: [
      { key: 'ma_phieu', header: 'Mã phiếu' },
      { key: 'ma_vat_chua', header: 'Mã vật chứa' },
      { key: 'ten_vat_chua', header: 'Tên vật chứa' },
      { key: 'so_luong', header: 'Số lượng', align: 'right' },
      { key: 'thanh_tien', header: 'Thành tiền', align: 'right' }
    ],
    rows: rows.map(function(row, index) {
      return Object.assign({ stt: index + 1 }, row);
    })
  };
}

function appendSectionFromTable(sections, title, table) {
  if (!table || !table.rows || !table.rows.length) return;
  sections.push(makeSection(title, table.columns, table.rows));
}

async function loadVatChuaDocs(sourceType, sourceId) {
  const sourceOid = new mongoose.Types.ObjectId(sourceId);
  const [nhapDocs, xuatDocs] = await Promise.all([
    NhapVatChua.find({
      source_type: sourceType,
      source_id: sourceOid,
      trang_thai: { $ne: 'cancelled' }
    }).sort({ created_at: -1 }).lean(),
    XuatVatChua.find({
      source_type: sourceType,
      source_id: sourceOid,
      trang_thai: { $ne: 'cancelled' }
    }).sort({ created_at: -1 }).lean()
  ]);
  return { nhapDocs: nhapDocs, xuatDocs: xuatDocs };
}

function buildDetailTable(entityType, rawRows) {
  if (entityType === 'CTPhieuNhap' || entityType === 'CTDonHang' || entityType === 'CTHoaDonBanHang') {
    return {
      columns: [
        { key: 'ma_hang', header: 'Mã hàng' },
        { key: 'ten_hang', header: 'Tên hàng' },
        { key: 'quy_cach', header: 'Quy cách' },
        { key: 'so_luong', header: 'Số lượng', align: 'right' },
        { key: 'don_gia', header: 'Đơn giá', align: 'right' },
        { key: 'thanh_tien', header: 'Thành tiền', align: 'right' }
      ],
      rows: rawRows.map(function(row, index) {
        return {
          stt: index + 1,
          ma_hang: row.ma_hang_snapshot || row.hang_hoa_id?.ma_hang || '---',
          ten_hang: row.ten_hang_snapshot || row.hang_hoa_id?.ten_hang || '---',
          quy_cach: row.ten_quy_cach || row.ten_thuoc_tinh || '---',
          so_luong: fmtNum(row.so_luong),
          don_gia: fmtMoney(row.don_gia || row.don_gia_ban),
          thanh_tien: fmtMoney(row.thanh_tien)
        };
      })
    };
  }

  if (entityType === 'CTPhieuTraHang' || entityType === 'CTPhieuTraHangNhap' || entityType === 'CTPhanBoHang') {
    return {
      columns: [
        { key: 'ma_hang', header: 'Mã hàng' },
        { key: 'ten_hang', header: 'Tên hàng' },
        { key: 'so_luong', header: 'Số lượng', align: 'right' },
        { key: 'thanh_tien', header: 'Thành tiền', align: 'right' }
      ],
      rows: rawRows.map(function(row, index) {
        return {
          stt: index + 1,
          ma_hang: row.ma_hang_snapshot || row.hang_hoa_id?.ma_hang || '---',
          ten_hang: row.ten_hang_snapshot || row.hang_hoa_id?.ten_hang || row.ten_quy_cach || '---',
          so_luong: fmtNum(row.so_luong),
          thanh_tien: fmtMoney(row.thanh_tien)
        };
      })
    };
  }

  if (entityType === 'PhieuThuChi') {
    return {
      columns: [
        { key: 'ma_phieu', header: 'Mã phiếu' },
        { key: 'loai_phieu', header: 'Loại' },
        { key: 'gia_tri', header: 'Giá trị', align: 'right' },
        { key: 'ngay_lap', header: 'Ngày lập' }
      ],
      rows: rawRows.map(function(row, index) {
        return {
          stt: index + 1,
          ma_phieu: row.ma_phieu || '---',
          loai_phieu: row.loai_phieu === 'thu' ? 'Thu' : (row.loai_phieu === 'chi' ? 'Chi' : (row.loai_phieu || '---')),
          gia_tri: fmtMoney(row.gia_tri),
          ngay_lap: fmtDateTime(row.ngay_lap)
        };
      })
    };
  }

  if (entityType === 'VanDon') {
    return {
      columns: [
        { key: 'ma_van_don', header: 'Mã vận đơn' },
        { key: 'phi_giao_hang', header: 'Phí giao', align: 'right' },
        { key: 'cod_amount', header: 'COD', align: 'right' },
        { key: 'created_at', header: 'Ngày tạo' }
      ],
      rows: rawRows.map(function(row, index) {
        return {
          stt: index + 1,
          ma_van_don: row.ma_van_don || '---',
          phi_giao_hang: fmtMoney(row.phi_giao_hang),
          cod_amount: fmtMoney(row.cod_amount),
          created_at: fmtDateTime(row.created_at)
        };
      })
    };
  }

  if (entityType === 'NhapVatChua' || entityType === 'XuatVatChua') {
    return buildVatChuaItemsTable(rawRows, entityType === 'NhapVatChua' ? 'nhap' : 'xuat');
  }

  if (entityType === 'PhieuTraHang' || entityType === 'PhieuTraHangNhap') {
    const maKey = entityType === 'PhieuTraHang' ? 'ma_phieu_tra' : 'ma_phieu_tra_nhap';
    return {
      columns: [
        { key: 'ma_phieu', header: 'Mã phiếu' },
        { key: 'tong_tien', header: 'Tổng tiền', align: 'right' },
        { key: 'ngay', header: 'Ngày' }
      ],
      rows: rawRows.map(function(row, index) {
        return {
          stt: index + 1,
          ma_phieu: row[maKey] || '---',
          tong_tien: fmtMoney(row.tong_tien_tra || row.tong_tien),
          ngay: fmtDateTime(row.ngay_tra)
        };
      })
    };
  }

  if (entityType === 'GopHoaDon' || entityType === 'GopDonHang' || entityType === 'GopPhieuNhap') {
    const maKey = entityType === 'GopHoaDon'
      ? 'ma_gop_hoa_don'
      : (entityType === 'GopDonHang' ? 'ma_gop_don' : 'ma_gop_phieu_nhap');
    return {
      columns: [
        { key: 'ma_gop', header: 'Mã gộp' },
        { key: 'so_luong', header: 'Số chứng từ gộp', align: 'right' },
        { key: 'ngay_gop', header: 'Ngày gộp' }
      ],
      rows: rawRows.map(function(row, index) {
        const countKey = entityType === 'GopHoaDon'
          ? 'so_luong_hoa_don_gop'
          : (entityType === 'GopDonHang' ? 'so_luong_don_gop' : 'so_luong_phieu_gop');
        return {
          stt: index + 1,
          ma_gop: row[maKey] || '---',
          so_luong: fmtNum(row[countKey]),
          ngay_gop: fmtDateTime(row.ngay_gop)
        };
      })
    };
  }

  if (entityType === 'PhanBoHang') {
    return {
      columns: [
        { key: 'ma_phan_bo', header: 'Mã phân bổ' },
        { key: 'tong_so_luong', header: 'Tổng SL', align: 'right' },
        { key: 'tong_thanh_tien', header: 'Tổng tiền', align: 'right' }
      ],
      rows: rawRows.map(function(row, index) {
        return {
          stt: index + 1,
          ma_phan_bo: row.ma_phan_bo || '---',
          tong_so_luong: fmtNum(row.tong_so_luong),
          tong_thanh_tien: fmtMoney(row.tong_thanh_tien)
        };
      })
    };
  }

  if (entityType === 'LoHang') {
    return {
      columns: [
        { key: 'ma_lo', header: 'Mã lô' },
        { key: 'ten_lo', header: 'Tên lô' },
        { key: 'so_luong_ton', header: 'SL tồn', align: 'right' },
        { key: 'han_su_dung', header: 'Hạn dùng' }
      ],
      rows: rawRows.map(function(row, index) {
        return {
          stt: index + 1,
          ma_lo: row.ma_lo || '---',
          ten_lo: row.ten_lo || '---',
          so_luong_ton: fmtNum(row.so_luong_ton),
          han_su_dung: row.han_su_dung ? fmtDateTime(row.han_su_dung) : '---'
        };
      })
    };
  }

  if (entityType === 'HoaDonBanHang') {
    return {
      columns: [
        { key: 'ma_hoa_don', header: 'Mã hóa đơn' },
        { key: 'tong_tien', header: 'Tổng tiền', align: 'right' },
        { key: 'thanh_toan', header: 'Khách trả', align: 'right' },
        { key: 'ngay_ban', header: 'Ngày bán' }
      ],
      rows: rawRows.map(function(row, index) {
        return {
          stt: index + 1,
          ma_hoa_don: row.ma_hoa_don || '---',
          tong_tien: fmtMoney(row.tong_tien),
          thanh_toan: fmtMoney(row.thanh_toan),
          ngay_ban: fmtDateTime(row.ngay_ban)
        };
      })
    };
  }

  if (entityType === 'CongNoKhachHang' || entityType === 'CongNoNhaCungCap') {
    return {
      columns: [
        { key: 'loai', header: 'Loại' },
        { key: 'so_tien', header: 'Số tiền', align: 'right' },
        { key: 'ngay', header: 'Ngày' },
        { key: 'ghi_chu', header: 'Ghi chú' }
      ],
      rows: rawRows.map(function(row, index) {
        return {
          stt: index + 1,
          loai: row.loai || '---',
          so_tien: fmtMoney(row.so_tien),
          ngay: fmtDateTime(row.ngay),
          ghi_chu: row.ghi_chu || '---'
        };
      })
    };
  }

  if (entityType === 'GiaoDichCongNoKhachHang' || entityType === 'GiaoDichCongNoNhaCungCap') {
    return {
      columns: [
        { key: 'ma_giao_dich', header: 'Mã giao dịch' },
        { key: 'loai_giao_dich', header: 'Loại' },
        { key: 'gia_tri', header: 'Giá trị', align: 'right' },
        { key: 'ngay_giao_dich', header: 'Ngày' }
      ],
      rows: rawRows.map(function(row, index) {
        return {
          stt: index + 1,
          ma_giao_dich: row.ma_giao_dich || '---',
          loai_giao_dich: row.loai_giao_dich || '---',
          gia_tri: fmtMoney(row.gia_tri),
          ngay_giao_dich: fmtDateTime(row.ngay_giao_dich)
        };
      })
    };
  }

  if (entityType === 'PhieuNhap_merged' || entityType === 'DonHang_merged' || entityType === 'HoaDonBanHang_merged') {
    const maKey = entityType === 'PhieuNhap_merged'
      ? 'ma_phieu'
      : (entityType === 'DonHang_merged' ? 'ma_don_hang' : 'ma_hoa_don');
    return {
      columns: [{ key: 'ma', header: 'Mã chứng từ gộp nguồn' }],
      rows: rawRows.map(function(row, index) {
        return {
          stt: index + 1,
          ma: row[maKey] || '---'
        };
      })
    };
  }

  return {
    columns: [
      { key: 'ma', header: 'Mã / nội dung' },
      { key: 'ghi_chu', header: 'Ghi chú' }
    ],
    rows: rawRows.map(function(row, index) {
      return {
        stt: index + 1,
        ma: pickRowCode(row, entityType) || JSON.stringify(row).slice(0, 80),
        ghi_chu: '---'
      };
    })
  };
}

async function getTrashChildCodeSummary(child, root) {
  if (!child || !root) {
    return { codes: [], count: 0, trash_item_id: child?._id };
  }

  let rawRows = [];
  try {
    rawRows = await loadRelatedRawRows(child.entity_type, child.entity_id, root.entity_type);
  } catch (err) {
    rawRows = [];
  }

  let codes = rawRows
    .map(function(row) { return pickRowCode(row, child.entity_type); })
    .filter(Boolean);

  if (!codes.length) {
    codes = parseCodesFromMoTa(child.mo_ta_phu);
  }
  if (!codes.length && child.ma_chung_tu) {
    codes = [child.ma_chung_tu];
  }

  const uniqueCodes = [];
  codes.forEach(function(code) {
    if (uniqueCodes.indexOf(code) < 0) uniqueCodes.push(code);
  });

  return {
    trash_item_id: child._id,
    count: rawRows.length || uniqueCodes.length || 0,
    codes: uniqueCodes.slice(0, 5),
    has_more: uniqueCodes.length > 5 || (rawRows.length > uniqueCodes.length)
  };
}

async function enrichTrashGroupsWithCodes(groups) {
  if (!Array.isArray(groups) || !groups.length) return groups;

  await Promise.all(groups.map(async function(group) {
    const root = group.root;
    const children = Array.isArray(group.children) ? group.children : [];
    group.children = await Promise.all(children.map(async function(child) {
      child.code_summary = await getTrashChildCodeSummary(child, root);
      return child;
    }));
  }));

  return groups;
}

async function loadRootDocumentDetail(root) {
  const parentOid = root.entity_id;
  const entityType = root.entity_type;
  const sourceType = ROOT_SOURCE_TYPE[entityType] || '';

  if (!parentOid) {
    return buildDetailPayload(entityLabel(entityType), root.ma_chung_tu || '', []);
  }

  if (entityType === 'HoaDonBanHang') {
    const inv = await HoaDonBanHang.findById(parentOid)
      .populate('khach_hang_id', 'ten_khach_hang ma_khach_hang')
      .lean();
    if (!inv) {
      return buildDetailPayload('Hóa đơn bán hàng', root.ma_chung_tu || '', []);
    }

    const [lineRows, vatChuaDocs, phieuThuChi, vanDon] = await Promise.all([
      loadRelatedRawRows('CTHoaDonBanHang', parentOid, entityType),
      loadVatChuaDocs(sourceType, parentOid),
      loadRelatedRawRows('PhieuThuChi', parentOid, entityType),
      loadRelatedRawRows('VanDon', parentOid, entityType)
    ]);

    const hasVatChua = vatChuaDocs.nhapDocs.length > 0 || vatChuaDocs.xuatDocs.length > 0;
    const sections = [
      makeSection('Thông tin chung', [
        { key: 'ma_hoa_don', header: 'Mã hóa đơn' },
        { key: 'khach_hang', header: 'Khách hàng' },
        { key: 'tong_tien', header: 'Tổng tiền', align: 'right' },
        { key: 'thanh_toan', header: 'Khách trả', align: 'right' },
        { key: 'co_vat_chua', header: 'Vật chứa' },
        { key: 'ngay_ban', header: 'Ngày bán' }
      ], [{
        stt: 1,
        ma_hoa_don: inv.ma_hoa_don || '---',
        khach_hang: inv.khach_hang_id?.ten_khach_hang || '---',
        tong_tien: fmtMoney(inv.tong_tien),
        thanh_toan: fmtMoney(inv.thanh_toan),
        co_vat_chua: hasVatChua ? 'Có' : 'Không',
        ngay_ban: fmtDateTime(inv.ngay_ban)
      }])
    ];

    appendSectionFromTable(sections, 'Dòng hàng trên hóa đơn', buildDetailTable('CTHoaDonBanHang', lineRows));
    appendSectionFromTable(sections, 'Xuất vật chứa (thùng, bao...)', buildVatChuaItemsTable(vatChuaDocs.xuatDocs, 'xuat'));
    appendSectionFromTable(sections, 'Nhập vật chứa', buildVatChuaItemsTable(vatChuaDocs.nhapDocs, 'nhap'));
    appendSectionFromTable(sections, 'Phiếu thu / chi', buildDetailTable('PhieuThuChi', phieuThuChi));
    appendSectionFromTable(sections, 'Vận đơn', buildDetailTable('VanDon', vanDon));

    const payload = buildDetailPayload(
      'Hóa đơn bán hàng',
      root.ma_chung_tu || inv.ma_hoa_don || '',
      sections
    );
    payload.entity_type = entityType;
    return payload;
  }

  if (entityType === 'DonHang') {
    const order = await DonHang.findById(parentOid)
      .populate('khach_hang_id', 'ten_khach_hang ma_khach_hang')
      .lean();
    if (!order) {
      return buildDetailPayload('Đơn đặt hàng', root.ma_chung_tu || '', []);
    }

    const [lineRows, vatChuaDocs, phieuThuChi, vanDon, phanBo] = await Promise.all([
      loadRelatedRawRows('CTDonHang', parentOid, entityType),
      loadVatChuaDocs(sourceType, parentOid),
      loadRelatedRawRows('PhieuThuChi', parentOid, entityType),
      loadRelatedRawRows('VanDon', parentOid, entityType),
      loadRelatedRawRows('PhanBoHang', parentOid, entityType)
    ]);

    const hasVatChua = vatChuaDocs.nhapDocs.length > 0 || vatChuaDocs.xuatDocs.length > 0;
    const sections = [
      makeSection('Thông tin chung', [
        { key: 'ma_don_hang', header: 'Mã đơn' },
        { key: 'khach_hang', header: 'Khách hàng' },
        { key: 'tong_tien', header: 'Tổng tiền', align: 'right' },
        { key: 'co_vat_chua', header: 'Vật chứa' },
        { key: 'ngay_dat', header: 'Ngày đặt' }
      ], [{
        stt: 1,
        ma_don_hang: order.ma_don_hang || '---',
        khach_hang: order.khach_hang_id?.ten_khach_hang || '---',
        tong_tien: fmtMoney(order.tong_thanh_toan || order.tong_tien),
        co_vat_chua: hasVatChua ? 'Có' : 'Không',
        ngay_dat: fmtDateTime(order.ngay_dat)
      }])
    ];

    appendSectionFromTable(sections, 'Dòng hàng trên đơn', buildDetailTable('CTDonHang', lineRows));
    appendSectionFromTable(sections, 'Xuất vật chứa (thùng, bao...)', buildVatChuaItemsTable(vatChuaDocs.xuatDocs, 'xuat'));
    appendSectionFromTable(sections, 'Nhập vật chứa', buildVatChuaItemsTable(vatChuaDocs.nhapDocs, 'nhap'));
    appendSectionFromTable(sections, 'Phân bổ hàng', buildDetailTable('PhanBoHang', phanBo));
    appendSectionFromTable(sections, 'Phiếu thu / chi', buildDetailTable('PhieuThuChi', phieuThuChi));
    appendSectionFromTable(sections, 'Vận đơn', buildDetailTable('VanDon', vanDon));

    const payload = buildDetailPayload(
      'Đơn đặt hàng',
      root.ma_chung_tu || order.ma_don_hang || '',
      sections
    );
    payload.entity_type = entityType;
    return payload;
  }

  if (entityType === 'PhieuNhap') {
    const slip = await PhieuNhap.findById(parentOid)
      .populate('nha_cung_cap_id', 'ten_ncc ma_ncc')
      .lean();
    if (!slip) {
      return buildDetailPayload('Phiếu nhập hàng', root.ma_chung_tu || '', []);
    }

    const [lineRows, vatChuaDocs, phieuThuChi, loHang] = await Promise.all([
      loadRelatedRawRows('CTPhieuNhap', parentOid, entityType),
      loadVatChuaDocs(sourceType, parentOid),
      loadRelatedRawRows('PhieuThuChi', parentOid, entityType),
      loadRelatedRawRows('LoHang', parentOid, entityType)
    ]);

    const hasVatChua = vatChuaDocs.nhapDocs.length > 0 || vatChuaDocs.xuatDocs.length > 0;
    const sections = [
      makeSection('Thông tin chung', [
        { key: 'ma_phieu_nhap', header: 'Mã phiếu nhập' },
        { key: 'nha_cung_cap', header: 'Nhà cung cấp' },
        { key: 'tong_tien', header: 'Tổng tiền', align: 'right' },
        { key: 'co_vat_chua', header: 'Vật chứa' },
        { key: 'ngay_nhap', header: 'Ngày nhập' }
      ], [{
        stt: 1,
        ma_phieu_nhap: slip.ma_phieu_nhap || '---',
        nha_cung_cap: slip.nha_cung_cap_id?.ten_ncc || '---',
        tong_tien: fmtMoney(slip.tong_tien),
        co_vat_chua: hasVatChua ? 'Có' : 'Không',
        ngay_nhap: fmtDateTime(slip.ngay_nhap || slip.created_at)
      }])
    ];

    appendSectionFromTable(sections, 'Dòng hàng nhập', buildDetailTable('CTPhieuNhap', lineRows));
    appendSectionFromTable(sections, 'Nhập vật chứa (thùng, bao...)', buildVatChuaItemsTable(vatChuaDocs.nhapDocs, 'nhap'));
    appendSectionFromTable(sections, 'Xuất vật chứa', buildVatChuaItemsTable(vatChuaDocs.xuatDocs, 'xuat'));
    appendSectionFromTable(sections, 'Lô hàng', buildDetailTable('LoHang', loHang));
    appendSectionFromTable(sections, 'Phiếu thu / chi', buildDetailTable('PhieuThuChi', phieuThuChi));

    const payload = buildDetailPayload(
      'Phiếu nhập hàng',
      root.ma_chung_tu || slip.ma_phieu_nhap || '',
      sections
    );
    payload.entity_type = entityType;
    return payload;
  }

  const payload = buildDetailPayload(entityLabel(entityType), root.ma_chung_tu || '', []);
  payload.entity_type = entityType;
  return payload;
}

async function loadTrashItemDetail(trashItemId, storeId) {
  if (!mongoose.Types.ObjectId.isValid(trashItemId)) {
    throw createHttpError(400, 'ID thùng rác không hợp lệ.');
  }

  const item = await ThungRacItem.findOne({
    _id: trashItemId,
    cua_hang_id: storeId,
    restored_at: null
  }).lean();

  if (!item) throw createHttpError(404, 'Không tìm thấy mục trong thùng rác.');

  let root = item;
  if (!item.is_trash_root && item.trash_group_id) {
    root = await ThungRacItem.findOne({
      _id: item.trash_group_id,
      cua_hang_id: storeId,
      restored_at: null
    }).lean();
  }
  if (!root) throw createHttpError(404, 'Không tìm thấy chứng từ gốc.');

  if (item.is_trash_root) {
    return loadRootDocumentDetail(root);
  }

  const entityType = item.entity_type;
  const parentId = root.entity_id;
  const rootType = root.entity_type;

  const rawRows = await loadRelatedRawRows(entityType, parentId, rootType);
  const table = buildDetailTable(entityType, rawRows);
  const subtitle = root.ma_chung_tu
    ? ('Thuộc ' + entityLabel(rootType) + ' ' + root.ma_chung_tu)
    : '';

  const payload = buildDetailPayload(
    entityLabel(entityType),
    subtitle,
    [makeSection(entityLabel(entityType), table.columns, table.rows)]
  );
  payload.entity_type = entityType;
  return payload;
}

module.exports = {
  getTrashChildCodeSummary,
  enrichTrashGroupsWithCodes,
  loadTrashItemDetail
};
