const mongoose = require('mongoose');
const {
  VatChua,
  NhapVatChua,
  XuatVatChua,
  PhieuThuChi
} = require('../models/kiot.model');
const { loadAverageCostByVatChuaIds } = require('./vatChuaImport.service');
const { buildNhapVatChuaReceiptFilter, getNhapVatChuaReceiptAmount, loadNhapVatChuaReturnTotals } = require('./vatChuaPaymentTotals.service');

function cleanId(value) {
  const id = String(value || '').trim();
  return mongoose.Types.ObjectId.isValid(id) ? id : '';
}

const LOAI_DOI_TRA_HANG_LABEL = 'Đổi - Trả hàng';

const LOAI_NHAP_LABEL = {
  mua_moi: 'Mua mới',
  kem_phieu_nhap_hang: 'Kèm phiếu nhập hàng',
  khach_tra_lai: LOAI_DOI_TRA_HANG_LABEL,
  doi_tra_hang: LOAI_DOI_TRA_HANG_LABEL,
  dieu_chinh_tang: 'Điều chỉnh tăng',
  khac: 'Khác'
};

const LOAI_XUAT_LABEL = {
  ban_hang: 'Bán hàng',
  hoa_don: 'Hóa đơn',
  tra_hang_nhap: 'Trả hàng nhập',
  doi_tra_hang: LOAI_DOI_TRA_HANG_LABEL,
  su_dung_noi_bo: 'Sử dụng nội bộ',
  hong_mat: 'Hỏng/mất',
  dieu_chinh_giam: 'Điều chỉnh giảm',
  khac: 'Khác'
};

const SOURCE_TYPE_LABEL = {
  phieu_nhap: 'Phiếu nhập hàng',
  don_hang: 'Đơn hàng',
  hoa_don: 'Hóa đơn',
  tra_hang_ban: 'Trả hàng bán',
  phieu_tra_hang_nhap: 'Trả hàng nhập',
  xuat_noi_bo: 'Xuất dùng nội bộ',
  manual: 'Thủ công',
  khac: 'Khác'
};

function buildSourceHref(sourceType, sourceId, loaiXuat, sourceCode) {
  const id = cleanId(sourceId);
  if (!id) return '';
  if (sourceType === 'phieu_nhap') return '/nhap-hang?purchase=' + encodeURIComponent(id);
  if (sourceType === 'don_hang') return '/don-hang/' + id;
  if (sourceType === 'hoa_don') return '/don-hang/hoa-don/' + id;
  if (sourceType === 'phieu_tra_hang_nhap') {
    const qs = new URLSearchParams();
    const code = String(sourceCode || '').trim();
    if (code) qs.set('q', code);
    qs.set('openReturn', id);
    return '/tra-hang-nhap?' + qs.toString();
  }
  if (sourceType === 'tra_hang_ban') return '/don-hang/tra-hang?return=' + encodeURIComponent(id);
  if (sourceType === 'xuat_noi_bo' || loaiXuat === 'su_dung_noi_bo') {
    return '/xuat-dung-noi-bo?open=' + encodeURIComponent(id);
  }
  return '';
}

function resolveNhapLoaiLabel(row) {
  if (!row) return '---';
  if (row.source_type === 'tra_hang_ban' || row.loai_nhap === 'doi_tra_hang' || row.loai_nhap === 'khach_tra_lai') {
    return LOAI_DOI_TRA_HANG_LABEL;
  }
  return LOAI_NHAP_LABEL[row.loai_nhap] || row.loai_nhap || '---';
}

function resolveXuatLoaiLabel(row) {
  if (!row) return '---';
  if (row.source_type === 'tra_hang_ban' || row.loai_xuat === 'doi_tra_hang') {
    return LOAI_DOI_TRA_HANG_LABEL;
  }
  return LOAI_XUAT_LABEL[row.loai_xuat] || row.loai_xuat || '---';
}

function mapNhapRows(rows, vatChuaId, paidMap, returnedMap) {
  const targetId = String(vatChuaId);
  return (Array.isArray(rows) ? rows : []).map(function(row) {
    const line = (Array.isArray(row.items) ? row.items : []).find(function(item) {
      return String(item.vat_chua_id || '') === targetId;
    }) || (row.items && row.items[0]) || {};
    const rowId = String(row._id || '');
    const paidAmount = Number((paidMap && paidMap[rowId]) || 0);
    const returnedAmount = Number((returnedMap && returnedMap.get(rowId)) || 0);
    const thanhTien = Number(line.thanh_tien || row.tong_tien || 0);
    return {
      _id: row._id,
      doc_kind: 'nhap',
      doc_kind_label: 'Nhập',
      ma_chung_tu: row.ma_nhap_vat_chua || '---',
      loai: row.loai_nhap || '',
      loai_label: resolveNhapLoaiLabel(row),
      doi_tuong_ten: row.doi_tuong_ten || '---',
      doi_tuong_type: row.doi_tuong_type || '',
      doi_tuong_id: row.doi_tuong_id ? String(row.doi_tuong_id) : '',
      supplier_href: row.doi_tuong_type === 'nha_cung_cap' && row.doi_tuong_id
        ? '/nha-cung-cap?supplier=' + encodeURIComponent(String(row.doi_tuong_id))
        : '',
      source_type: row.source_type || '',
      source_type_label: SOURCE_TYPE_LABEL[row.source_type] || row.source_type || '---',
      source_code: row.source_code || '',
      source_href: buildSourceHref(row.source_type, row.source_id),
      so_luong: Number(line.so_luong || row.tong_so_luong || 0),
      gia_von: Number(line.gia_von || 0),
      thanh_tien: thanhTien,
      da_tra_ncc: paidAmount,
      returned_amount: returnedAmount,
      can_tra_ncc: Math.max(0, thanhTien - paidAmount - returnedAmount),
      trang_thai: row.trang_thai || 'active',
      trang_thai_label: row.trang_thai === 'cancelled' ? 'Đã hủy' : 'Hợp lệ',
      created_at: row.created_at,
      ghi_chu: row.ghi_chu || ''
    };
  });
}

function mapXuatRows(rows, vatChuaId) {
  const targetId = String(vatChuaId);
  return (Array.isArray(rows) ? rows : []).map(function(row) {
    const line = (Array.isArray(row.items) ? row.items : []).find(function(item) {
      return String(item.vat_chua_id || '') === targetId;
    }) || (row.items && row.items[0]) || {};
    return {
      _id: row._id,
      doc_kind: 'xuat',
      doc_kind_label: 'Xuất',
      ma_chung_tu: row.ma_xuat_vat_chua || '---',
      loai: row.loai_xuat || '',
      loai_label: resolveXuatLoaiLabel(row),
      doi_tuong_ten: row.doi_tuong_ten || '---',
      doi_tuong_id: row.doi_tuong_id ? String(row.doi_tuong_id) : '',
      supplier_href: row.doi_tuong_type === 'nha_cung_cap' && row.doi_tuong_id
        ? '/nha-cung-cap?supplier=' + encodeURIComponent(String(row.doi_tuong_id))
        : '',
      source_type: row.source_type || '',
      source_type_label: SOURCE_TYPE_LABEL[row.source_type] || row.source_type || '---',
      source_code: row.source_code || '',
      source_href: buildSourceHref(row.source_type, row.source_id, row.loai_xuat),
      so_luong: Number(line.so_luong || row.tong_so_luong || 0),
      gia_von: Number(line.gia_von || 0),
      thanh_tien: Number(line.thanh_tien || row.tong_tien || 0),
      da_tra_ncc: 0,
      can_tra_ncc: null,
      trang_thai: row.trang_thai || 'active',
      trang_thai_label: row.trang_thai === 'cancelled' ? 'Đã hủy' : 'Hợp lệ',
      created_at: row.created_at,
      ghi_chu: row.ghi_chu || ''
    };
  });
}

function mapReceiptRows(rows) {
  return (Array.isArray(rows) ? rows : []).map(function(row) {
    return {
      _id: row._id,
      doc_kind: 'phieu_thu_chi',
      doc_kind_label: row.loai_phieu === 'thu' ? 'Phiếu thu' : 'Phiếu chi',
      ma_chung_tu: row.ma_phieu || '---',
      loai: row.loai_thu_chi || '',
      loai_label: row.loai_thu_chi || '---',
      doi_tuong_ten: row.doi_tuong || '---',
      source_type: 'nhap_vat_chua',
      source_type_label: 'Nhập vật chứa',
      source_code: row.ma_chung_tu_goc || '',
      source_href: '',
      so_luong: 0,
      gia_von: 0,
      thanh_tien: Number(row.gia_tri || 0),
      trang_thai: row.trang_thai || 'paid',
      trang_thai_label: row.trang_thai === 'cancelled' ? 'Đã hủy' : 'Đã thanh toán',
      created_at: row.created_at || row.ngay_lap,
      ghi_chu: row.ghi_chu || ''
    };
  });
}

const LOAI_THU_CHI_LABEL = {
  'Chi Nhập vật chứa': 'Chi nhập vật chứa',
  'Chi tra nha cung cap': 'Chi trả nhà cung cấp'
};

function mapChiReceiptRows(rows) {
  return (Array.isArray(rows) ? rows : []).map(function(row) {
    const nhapLinkId = cleanId(row.nhap_vat_chua_id);
    const linkedCode = String(row.ma_chung_tu_goc || '').trim();
    const loaiThuChi = String(row.loai_thu_chi || '').trim();
    return {
      _id: row._id,
      ma_phieu: row.ma_phieu || '---',
      loai_thu_chi: loaiThuChi,
      loai_thu_chi_label: LOAI_THU_CHI_LABEL[loaiThuChi] || loaiThuChi || '---',
      doi_tuong_ten: row.doi_tuong || '---',
      linked_code: linkedCode,
      linked_href: nhapLinkId ? '/vat-chua?nhap_vat_chua=' + encodeURIComponent(nhapLinkId) : '',
      gia_tri: Number(row.gia_tri || 0),
      trang_thai: row.trang_thai || 'paid',
      trang_thai_label: row.trang_thai === 'cancelled' ? 'Đã hủy' : 'Đã thanh toán',
      created_at: row.created_at || row.ngay_lap,
      ghi_chu: row.ghi_chu || ''
    };
  });
}

async function loadVatChuaDetailContext(vatChuaId, storeId) {
  const id = cleanId(vatChuaId);
  const store = cleanId(storeId);
  if (!id || !store) return null;

  const item = await VatChua.findOne({ _id: id, cua_hang_id: store }).lean();
  if (!item) return null;

  const avgMap = await loadAverageCostByVatChuaIds(store, [item._id]);
  item.gia_von_trung_binh = avgMap[String(item._id)] || 0;

  const itemMatch = { cua_hang_id: store, 'items.vat_chua_id': new mongoose.Types.ObjectId(id), deleted_at: null };
  const activeXuatMatch = Object.assign({}, itemMatch, { trang_thai: 'active' });
  const [nhapRows, xuatRows] = await Promise.all([
    NhapVatChua.find(itemMatch).sort({ created_at: -1 }).lean(),
    XuatVatChua.find(activeXuatMatch).sort({ created_at: -1 }).lean()
  ]);

  let chiDocuments = [];
  const paidMap = {};
  if (nhapRows.length) {
    const chiRows = await PhieuThuChi.find(buildNhapVatChuaReceiptFilter(nhapRows, store, { includeCancelled: true }))
      .setOptions({ strictQuery: false })
      .sort({ ngay_lap: -1, created_at: -1 }).lean();
    nhapRows.forEach(function(doc) {
      paidMap[String(doc._id)] = chiRows.reduce(function(total, receipt) {
        return total + getNhapVatChuaReceiptAmount(receipt, doc);
      }, 0);
    });
    chiDocuments = mapChiReceiptRows(chiRows);
  }

  const returnedMap = await loadNhapVatChuaReturnTotals(nhapRows, { storeId: store });
  const documents = mapNhapRows(nhapRows, id, paidMap, returnedMap)
    .concat(mapXuatRows(xuatRows, id))
    .sort(function(a, b) {
      const ta = new Date(a.created_at || 0).getTime();
      const tb = new Date(b.created_at || 0).getTime();
      return tb - ta;
    });

  return {
    item: item,
    documents: documents,
    chiDocuments: chiDocuments,
    nhapCount: nhapRows.length,
    xuatCount: xuatRows.length,
    chiCount: chiDocuments.length
  };
}

async function loadVatChuaDocumentDetail(kind, docId, storeId) {
  const id = cleanId(docId);
  const store = cleanId(storeId);
  if (!id || !store) return null;

  if (kind === 'nhap') {
    const doc = await NhapVatChua.findOne({ _id: id, cua_hang_id: store, deleted_at: null }).lean();
    if (!doc) return null;
    return {
      kind: 'nhap',
      kind_label: 'Phiếu nhập vật chứa',
      ma_chung_tu: doc.ma_nhap_vat_chua || '---',
      loai_label: resolveNhapLoaiLabel(doc),
      doi_tuong_ten: doc.doi_tuong_ten || '---',
      source_type: doc.source_type || '',
      source_type_label: SOURCE_TYPE_LABEL[doc.source_type] || doc.source_type || '---',
      source_code: doc.source_code || '',
      source_href: buildSourceHref(doc.source_type, doc.source_id, doc.loai_nhap),
      tong_so_luong: Number(doc.tong_so_luong || 0),
      tong_tien: Number(doc.tong_tien || 0),
      trang_thai: doc.trang_thai || 'active',
      trang_thai_label: doc.trang_thai === 'cancelled' ? 'Đã hủy' : 'Hợp lệ',
      created_at: doc.created_at,
      ghi_chu: doc.ghi_chu || '',
      items: Array.isArray(doc.items) ? doc.items : []
    };
  }

  if (kind === 'xuat') {
    const doc = await XuatVatChua.findOne({ _id: id, cua_hang_id: store, deleted_at: null }).lean();
    if (!doc) return null;
    return {
      kind: 'xuat',
      kind_label: 'Phiếu xuất vật chứa',
      ma_chung_tu: doc.ma_xuat_vat_chua || '---',
      loai_label: resolveXuatLoaiLabel(doc),
      doi_tuong_ten: doc.doi_tuong_ten || '---',
      source_type: doc.source_type || '',
      source_type_label: SOURCE_TYPE_LABEL[doc.source_type] || doc.source_type || '---',
      source_code: doc.source_code || '',
      source_href: buildSourceHref(doc.source_type, doc.source_id, doc.loai_xuat),
      tong_so_luong: Number(doc.tong_so_luong || 0),
      tong_tien: Number(doc.tong_tien || 0),
      trang_thai: doc.trang_thai || 'active',
      trang_thai_label: doc.trang_thai === 'cancelled' ? 'Đã hủy' : 'Hợp lệ',
      created_at: doc.created_at,
      ghi_chu: doc.ghi_chu || '',
      items: Array.isArray(doc.items) ? doc.items : []
    };
  }

  return null;
}

function flattenVatChuaDocLines(doc, kind) {
  if (!doc || !doc._id) return [];
  const items = Array.isArray(doc.items) ? doc.items : [];
  const maChungTu = kind === 'xuat' ? (doc.ma_xuat_vat_chua || '') : (doc.ma_nhap_vat_chua || '');
  const docHref = kind === 'xuat'
    ? ''
    : '/vat-chua?nhap_vat_chua=' + encodeURIComponent(String(doc._id));
  const loaiLabel = kind === 'xuat'
    ? resolveXuatLoaiLabel(doc)
    : resolveNhapLoaiLabel(doc);
  const sourceHref = buildSourceHref(
    doc.source_type,
    doc.source_id,
    kind === 'xuat' ? doc.loai_xuat : doc.loai_nhap,
    doc.source_code
  );
  const createdAt = doc.created_at || null;

  return items.map(function(line) {
    return {
      doc_id: doc._id,
      doc_kind: kind,
      doc_kind_label: kind === 'xuat' ? 'Xuất' : 'Nhập',
      ma_chung_tu: maChungTu || '---',
      doc_href: docHref,
      loai_label: loaiLabel,
      ma_vat_chua: line.ma_vat_chua || '',
      ten_vat_chua: line.ten_vat_chua || line.ma_vat_chua || '---',
      so_luong: Number(line.so_luong || 0),
      source_type: doc.source_type || '',
      source_code: doc.source_code || '',
      source_href: sourceHref,
      created_at: createdAt,
      trang_thai: doc.trang_thai || 'active'
    };
  });
}

async function loadOrderLinkedVatChuaLines(orderId, invoiceIds, storeId) {
  const orderOid = cleanId(orderId);
  const store = cleanId(storeId);
  if (!orderOid || !store) return [];

  const sourceOr = [{ source_type: 'don_hang', source_id: new mongoose.Types.ObjectId(orderOid) }];
  const invoiceObjectIds = (Array.isArray(invoiceIds) ? invoiceIds : [])
    .map(function(id) { return cleanId(id); })
    .filter(Boolean)
    .map(function(id) { return new mongoose.Types.ObjectId(id); });
  if (invoiceObjectIds.length) {
    sourceOr.push({ source_type: 'hoa_don', source_id: { $in: invoiceObjectIds } });
  }

  const baseMatch = {
    cua_hang_id: new mongoose.Types.ObjectId(store),
    trang_thai: 'active',
    deleted_at: null,
    $or: sourceOr
  };

  const [xuatRows, nhapRows] = await Promise.all([
    XuatVatChua.find(baseMatch).sort({ created_at: -1 }).lean(),
    NhapVatChua.find(baseMatch).sort({ created_at: -1 }).lean()
  ]);

  const lines = []
    .concat((xuatRows || []).flatMap(function(row) { return flattenVatChuaDocLines(row, 'xuat'); }))
    .concat((nhapRows || []).flatMap(function(row) { return flattenVatChuaDocLines(row, 'nhap'); }));

  lines.sort(function(a, b) {
    const ta = new Date(a.created_at || 0).getTime();
    const tb = new Date(b.created_at || 0).getTime();
    return tb - ta;
  });

  return lines;
}

async function loadPurchaseLinkedVatChuaLines(purchaseId, storeId) {
  const map = await loadPurchasesLinkedVatChuaMap([purchaseId], storeId);
  const key = cleanId(purchaseId);
  return key ? (map[key] || []) : [];
}

async function loadPurchasesLinkedVatChuaMap(purchaseIds, storeId) {
  const store = cleanId(storeId);
  const ids = (Array.isArray(purchaseIds) ? purchaseIds : [])
    .map(function(id) { return cleanId(id); })
    .filter(Boolean)
    .map(function(id) { return new mongoose.Types.ObjectId(id); });
  if (!store || !ids.length) return {};

  const nhapRows = await NhapVatChua.find({
    cua_hang_id: new mongoose.Types.ObjectId(store),
    trang_thai: 'active',
    deleted_at: null,
    source_type: 'phieu_nhap',
    source_id: { $in: ids }
  }).sort({ created_at: -1 }).lean();

  const map = {};
  nhapRows.forEach(function(row) {
    const key = String(row.source_id || '');
    if (!key) return;
    if (!map[key]) map[key] = [];
    const flat = flattenVatChuaDocLines(row, 'nhap');
    map[key] = map[key].concat(flat);
  });

  Object.keys(map).forEach(function(key) {
    map[key].sort(function(a, b) {
      const ta = new Date(a.created_at || 0).getTime();
      const tb = new Date(b.created_at || 0).getTime();
      return tb - ta;
    });
  });

  return map;
}

async function loadInvoiceLinkedVatChuaLines(invoiceId, orderId, storeId) {
  const invoiceOid = cleanId(invoiceId);
  const orderOid = cleanId(orderId);
  const store = cleanId(storeId);
  if (!store || !invoiceOid) return [];

  const sourceOr = [
    { source_type: 'hoa_don', source_id: new mongoose.Types.ObjectId(invoiceOid) }
  ];
  if (orderOid) {
    sourceOr.push({ source_type: 'don_hang', source_id: new mongoose.Types.ObjectId(orderOid) });
  }

  const xuatRows = await XuatVatChua.find({
    cua_hang_id: new mongoose.Types.ObjectId(store),
    trang_thai: 'active',
    deleted_at: null,
    $or: sourceOr
  }).sort({ created_at: -1 }).lean();

  const lines = (xuatRows || []).flatMap(function(row) { return flattenVatChuaDocLines(row, 'xuat'); });
  lines.sort(function(a, b) {
    const ta = new Date(a.created_at || 0).getTime();
    const tb = new Date(b.created_at || 0).getTime();
    return tb - ta;
  });
  return lines;
}

async function loadReturnLinkedVatChuaLines(returnId, storeId) {
  const map = await loadReturnsLinkedVatChuaMap([returnId], storeId);
  const key = cleanId(returnId);
  return key ? (map[key] || []) : [];
}

async function loadSalesReturnLinkedNhapVatChuaLines(returnId, storeId) {
  const store = cleanId(storeId);
  const id = cleanId(returnId);
  if (!store || !id) return [];

  const nhapRows = await NhapVatChua.find({
    cua_hang_id: new mongoose.Types.ObjectId(store),
    trang_thai: 'active',
    deleted_at: null,
    source_type: 'tra_hang_ban',
    source_id: new mongoose.Types.ObjectId(id)
  }).sort({ created_at: -1 }).lean();

  const lines = [];
  (nhapRows || []).forEach(function(row) {
    (Array.isArray(row.items) ? row.items : []).forEach(function(item) {
      lines.push({
        doc_id: row._id,
        doc_href: row._id ? '/vat-chua?nhap_vat_chua=' + encodeURIComponent(String(row._id)) : '',
        doc_kind: 'nhap',
        doc_kind_label: 'Nhập',
        ma_chung_tu: row.ma_nhap_vat_chua || '---',
        loai: row.loai_nhap || '',
        loai_label: resolveNhapLoaiLabel(row),
        ten_vat_chua: item.ten_vat_chua || '---',
        ma_vat_chua: item.ma_vat_chua || '',
        so_luong: Number(item.so_luong || 0),
        gia_von: Number(item.gia_von || 0),
        thanh_tien: Number(item.thanh_tien || 0),
        source_type: row.source_type || '',
        source_type_label: SOURCE_TYPE_LABEL[row.source_type] || row.source_type || '---',
        source_code: row.source_code || '',
        source_href: buildSourceHref(row.source_type, row.source_id),
        created_at: row.created_at,
        ghi_chu: row.ghi_chu || ''
      });
    });
  });

  const xuatRows = await XuatVatChua.find({
    cua_hang_id: new mongoose.Types.ObjectId(store),
    trang_thai: 'active',
    deleted_at: null,
    source_type: 'tra_hang_ban',
    source_id: new mongoose.Types.ObjectId(id)
  }).sort({ created_at: -1 }).lean();

  (xuatRows || []).forEach(function(row) {
    (Array.isArray(row.items) ? row.items : []).forEach(function(item) {
      const qty = Math.abs(Number(item.so_luong || 0));
      lines.push({
        doc_id: row._id,
        doc_href: '',
        doc_kind: 'xuat',
        doc_kind_label: 'Xuất',
        ma_chung_tu: row.ma_xuat_vat_chua || '---',
        loai: row.loai_xuat || '',
        loai_label: resolveXuatLoaiLabel(row),
        ten_vat_chua: item.ten_vat_chua || '---',
        ma_vat_chua: item.ma_vat_chua || '',
        so_luong: qty > 0 ? -qty : 0,
        gia_von: Number(item.gia_von || 0),
        thanh_tien: Number(item.thanh_tien || 0),
        source_type: row.source_type || '',
        source_type_label: SOURCE_TYPE_LABEL[row.source_type] || row.source_type || '---',
        source_code: row.source_code || '',
        source_href: buildSourceHref(row.source_type, row.source_id, row.loai_xuat),
        created_at: row.created_at,
        ghi_chu: row.ghi_chu || ''
      });
    });
  });

  return lines;
}

async function loadReturnsLinkedVatChuaMap(returnIds, storeId) {
  const store = cleanId(storeId);
  const ids = (Array.isArray(returnIds) ? returnIds : [])
    .map(function(id) { return cleanId(id); })
    .filter(Boolean)
    .map(function(id) { return new mongoose.Types.ObjectId(id); });
  if (!store || !ids.length) return {};

  const xuatRows = await XuatVatChua.find({
    cua_hang_id: new mongoose.Types.ObjectId(store),
    trang_thai: 'active',
    deleted_at: null,
    source_type: 'phieu_tra_hang_nhap',
    source_id: { $in: ids }
  }).sort({ created_at: -1 }).lean();

  const map = {};
  xuatRows.forEach(function(row) {
    const key = String(row.source_id || '');
    if (!key) return;
    if (!map[key]) map[key] = [];
    map[key] = map[key].concat(flattenVatChuaDocLines(row, 'xuat'));
  });

  Object.keys(map).forEach(function(key) {
    map[key].sort(function(a, b) {
      const ta = new Date(a.created_at || 0).getTime();
      const tb = new Date(b.created_at || 0).getTime();
      return tb - ta;
    });
  });

  return map;
}

module.exports = {
  loadVatChuaDetailContext,
  loadVatChuaDocumentDetail,
  loadOrderLinkedVatChuaLines,
  loadPurchaseLinkedVatChuaLines,
  loadPurchasesLinkedVatChuaMap,
  loadInvoiceLinkedVatChuaLines,
  loadReturnLinkedVatChuaLines,
  loadSalesReturnLinkedNhapVatChuaLines,
  loadReturnsLinkedVatChuaMap,
  LOAI_NHAP_LABEL,
  LOAI_XUAT_LABEL,
  SOURCE_TYPE_LABEL
};
