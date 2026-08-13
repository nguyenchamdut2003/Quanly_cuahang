const mongoose = require('mongoose');
const {
  PhieuThuChi,
  DonHang,
  HoaDonBanHang,
  PhieuNhap,
  PhieuTraHangNhap,
  PhieuTraHang,
  VanDon
} = require('../models/kiot.model');
const {
  computeNetPaidFromReceiptRows,
  receiptRowsForNetPaidFilter
} = require('../utils/customerPayment');

const CANCELLED_EXCLUDE = { $nin: ['cancelled', 'Cancelled', 'CANCELLED'] };

function isObjectId(value) {
  return mongoose.Types.ObjectId.isValid(String(value || '').trim());
}

function toObjectId(value) {
  return isObjectId(value) ? new mongoose.Types.ObjectId(String(value)) : null;
}

function parseMoney(value) {
  return Number(String(value || '').replace(/\./g, '').replace(/,/g, '')) || 0;
}

async function sumReceiptAmount(loaiPhieu, match) {
  const rows = await PhieuThuChi.aggregate([
    {
      $match: {
        loai_phieu: loaiPhieu,
        trang_thai: { $ne: 'cancelled' },
        ...match
      }
    },
    { $group: { _id: null, total: { $sum: { $ifNull: ['$gia_tri', 0] } } } }
  ]);
  return Number(rows[0]?.total || 0);
}

async function sumCustomerNetPaid(match) {
  const rows = await PhieuThuChi.find(receiptRowsForNetPaidFilter(match))
    .select('loai_phieu loai_thu_chi gia_tri trang_thai')
    .lean();
  if (!rows.length) return null;
  return computeNetPaidFromReceiptRows(rows);
}

function mapRow(doc) {
  return {
    _id: String(doc._id),
    code: doc.code || '',
    total: Number(doc.total ?? doc.remaining ?? 0),
    amount: Number(doc.remaining || 0),
    nhom: doc.nhom || '',
    entity_id: doc.entity_id ? String(doc.entity_id) : '',
    partner: doc.partner || ''
  };
}

async function listDonHangThu(storeId, customerId) {
  const filter = {
    cua_hang_id: storeId,
    khach_hang_id: customerId,
    trang_thai: CANCELLED_EXCLUDE,
    deleted_at: null
  };
  const orders = await DonHang.find(filter)
    .select('ma_don_hang khach_hang_id khach_can_tra khach_thanh_toan tong_thanh_toan tong_tien')
    .populate('khach_hang_id', 'ten_khach_hang')
    .sort({ created_at: -1 })
    .limit(200)
    .lean();

  const rows = [];
  for (const order of orders) {
    const payable = Number(
      order.khach_can_tra ?? order.tong_thanh_toan ?? order.tong_tien ?? 0
    );
    const paidOnOrder = Number(order.khach_thanh_toan || 0);
    const paidReceipts = await sumCustomerNetPaid({ don_hang_id: order._id });
    const paid = paidReceipts == null ? paidOnOrder : paidReceipts;
    const remaining = Math.max(0, payable - paid);
    if (remaining <= 0) continue;
    rows.push(mapRow({
      _id: order._id,
      code: order.ma_don_hang,
      total: payable,
      remaining,
      nhom: 'khach_hang',
      entity_id: order.khach_hang_id?._id || order.khach_hang_id,
      partner: order.khach_hang_id?.ten_khach_hang || ''
    }));
  }
  return rows;
}

async function listHoaDonThu(storeId, customerId) {
  const filter = {
    cua_hang_id: storeId,
    khach_hang_id: customerId,
    trang_thai: CANCELLED_EXCLUDE
  };
  const invoices = await HoaDonBanHang.find(filter)
    .select('ma_hoa_don khach_hang_id don_hang_id thanh_toan')
    .populate('khach_hang_id', 'ten_khach_hang')
    .sort({ created_at: -1 })
    .limit(200)
    .lean();

  const rows = [];
  for (const invoice of invoices) {
    const payable = Number(invoice.thanh_toan || 0);
    const paidReceipts = await sumCustomerNetPaid({
      $or: [
        { hoa_don_id: invoice._id },
        ...(invoice.don_hang_id ? [{ don_hang_id: invoice.don_hang_id }] : [])
      ]
    });
    const remaining = Math.max(0, payable - Number(paidReceipts || 0));
    if (remaining <= 0) continue;
    rows.push(mapRow({
      _id: invoice._id,
      code: invoice.ma_hoa_don,
      total: payable,
      remaining,
      nhom: 'khach_hang',
      entity_id: invoice.khach_hang_id?._id || invoice.khach_hang_id,
      partner: invoice.khach_hang_id?.ten_khach_hang || ''
    }));
  }
  return rows;
}

async function listVanDonThu(storeId, customerId, carrierId) {
  const filter = {
    cua_hang_id: storeId,
    trang_thai: CANCELLED_EXCLUDE,
    cod_enabled: true,
    trang_thai_cod: 'chua_thu',
    cod_amount: { $gt: 0 }
  };
  if (customerId) filter.khach_hang_id = customerId;
  if (carrierId) filter.doi_tac_giao_hang_id = carrierId;

  const shipments = await VanDon.find(filter)
    .select('ma_van_don khach_hang_id doi_tac_giao_hang_id cod_amount')
    .populate('khach_hang_id', 'ten_khach_hang')
    .populate('doi_tac_giao_hang_id', 'ten_doi_tac')
    .sort({ created_at: -1 })
    .limit(200)
    .lean();

  return shipments.map(row => mapRow({
    _id: row._id,
    code: row.ma_van_don,
    total: Number(row.cod_amount || 0),
    remaining: Number(row.cod_amount || 0),
    nhom: row.khach_hang_id ? 'khach_hang' : 'doi_tac_giao_hang',
    entity_id: row.khach_hang_id?._id || row.khach_hang_id || row.doi_tac_giao_hang_id?._id || row.doi_tac_giao_hang_id,
    partner: row.khach_hang_id?.ten_khach_hang || row.doi_tac_giao_hang_id?.ten_doi_tac || ''
  }));
}

async function listPhieuTraHangNhapThu(storeId, supplierId) {
  const filter = {
    cua_hang_id: storeId,
    nha_cung_cap_id: supplierId,
    trang_thai: CANCELLED_EXCLUDE,
    deleted_at: null
  };
  const rows = await PhieuTraHangNhap.find(filter)
    .select('ma_phieu_tra_nhap nha_cung_cap_id ncc_can_tra ncc_da_tra')
    .populate('nha_cung_cap_id', 'ten_ncc')
    .sort({ created_at: -1 })
    .limit(200)
    .lean();

  return rows
    .map(row => {
      const remaining = Math.max(0, Number(row.ncc_can_tra || 0) - Number(row.ncc_da_tra || 0));
      if (remaining <= 0) return null;
      return mapRow({
        _id: row._id,
        code: row.ma_phieu_tra_nhap,
        total: Number(row.ncc_can_tra || 0),
        remaining,
        nhom: 'nha_cung_cap',
        entity_id: row.nha_cung_cap_id?._id || row.nha_cung_cap_id,
        partner: row.nha_cung_cap_id?.ten_ncc || ''
      });
    })
    .filter(Boolean);
}

async function listPhieuNhapChi(storeId, supplierId) {
  const filter = {
    cua_hang_id: storeId,
    nha_cung_cap_id: supplierId,
    trang_thai: CANCELLED_EXCLUDE,
    deleted_at: null,
    con_no_ncc: { $gt: 0 }
  };
  const rows = await PhieuNhap.find(filter)
    .select('ma_phieu_nhap nha_cung_cap_id con_no_ncc can_tra_ncc tong_tien')
    .populate('nha_cung_cap_id', 'ten_ncc')
    .sort({ created_at: -1 })
    .limit(200)
    .lean();

  return rows.map(row => mapRow({
    _id: row._id,
    code: row.ma_phieu_nhap,
    total: Number(row.can_tra_ncc ?? row.tong_tien ?? 0),
    remaining: Number(row.con_no_ncc || 0),
    nhom: 'nha_cung_cap',
    entity_id: row.nha_cung_cap_id?._id || row.nha_cung_cap_id,
    partner: row.nha_cung_cap_id?.ten_ncc || ''
  }));
}

async function listPhieuTraHangChi(storeId, customerId) {
  const filter = {
    cua_hang_id: storeId,
    khach_hang_id: customerId,
    trang_thai: CANCELLED_EXCLUDE
  };
  const rows = await PhieuTraHang.find(filter)
    .select('ma_phieu_tra can_tra_khach khach_hang_id')
    .populate('khach_hang_id', 'ten_khach_hang')
    .sort({ created_at: -1 })
    .limit(200)
    .lean();

  const result = [];
  for (const row of rows) {
    const target = Number(row.can_tra_khach || 0);
    const paid = await sumReceiptAmount('chi', { phieu_tra_hang_id: row._id });
    const remaining = Math.max(0, target - paid);
    if (remaining <= 0) continue;
    result.push(mapRow({
      _id: row._id,
      code: row.ma_phieu_tra,
      total: target,
      remaining,
      nhom: 'khach_hang',
      entity_id: row.khach_hang_id?._id || row.khach_hang_id,
      partner: row.khach_hang_id?.ten_khach_hang || ''
    }));
  }
  return result;
}

async function listVanDonChi(storeId, carrierId) {
  const filter = {
    cua_hang_id: storeId,
    trang_thai: CANCELLED_EXCLUDE,
    nguoi_tra_phi_giao_hang: 'cua_hang',
    $or: [
      { phi_giao_hang: { $gt: 0 } },
      { thanh_tien_van_chuyen: { $gt: 0 } }
    ]
  };
  if (carrierId) filter.doi_tac_giao_hang_id = carrierId;

  const rows = await VanDon.find(filter)
    .select('ma_van_don doi_tac_giao_hang_id phi_giao_hang thanh_tien_van_chuyen')
    .populate('doi_tac_giao_hang_id', 'ten_doi_tac')
    .sort({ created_at: -1 })
    .limit(200)
    .lean();

  const result = [];
  for (const row of rows) {
    const target = Math.max(Number(row.phi_giao_hang || 0), Number(row.thanh_tien_van_chuyen || 0));
    const paid = await sumReceiptAmount('chi', { van_don_id: row._id });
    const remaining = Math.max(0, target - paid);
    if (remaining <= 0) continue;
    result.push(mapRow({
      _id: row._id,
      code: row.ma_van_don,
      total: target,
      remaining,
      nhom: 'doi_tac_giao_hang',
      entity_id: row.doi_tac_giao_hang_id?._id || row.doi_tac_giao_hang_id,
      partner: row.doi_tac_giao_hang_id?.ten_doi_tac || ''
    }));
  }
  return result;
}

async function listDonHangChiRefund(storeId, customerId) {
  const filter = {
    cua_hang_id: storeId,
    khach_hang_id: customerId,
    trang_thai: CANCELLED_EXCLUDE,
    khach_thanh_toan: { $gt: 0 }
  };
  const orders = await DonHang.find(filter)
    .select('ma_don_hang khach_hang_id khach_thanh_toan')
    .populate('khach_hang_id', 'ten_khach_hang')
    .sort({ created_at: -1 })
    .limit(200)
    .lean();

  const result = [];
  for (const order of orders) {
    const paid = Number(order.khach_thanh_toan || 0);
    const refunded = await sumReceiptAmount('chi', { don_hang_id: order._id });
    const remaining = Math.max(0, paid - refunded);
    if (remaining <= 0) continue;
    result.push(mapRow({
      _id: order._id,
      code: order.ma_don_hang,
      total: paid,
      remaining,
      nhom: 'khach_hang',
      entity_id: order.khach_hang_id?._id || order.khach_hang_id,
      partner: order.khach_hang_id?.ten_khach_hang || ''
    }));
  }
  return result;
}

async function listHoaDonChiRefund(storeId, customerId) {
  const filter = {
    cua_hang_id: storeId,
    khach_hang_id: customerId,
    trang_thai: CANCELLED_EXCLUDE
  };
  const invoices = await HoaDonBanHang.find(filter)
    .select('ma_hoa_don khach_hang_id don_hang_id thanh_toan')
    .populate('khach_hang_id', 'ten_khach_hang')
    .sort({ created_at: -1 })
    .limit(200)
    .lean();

  const result = [];
  for (const invoice of invoices) {
    const paidReceipts = await sumReceiptAmount('thu', {
      $or: [
        { hoa_don_id: invoice._id },
        ...(invoice.don_hang_id ? [{ don_hang_id: invoice.don_hang_id }] : [])
      ]
    });
    const refunded = await sumReceiptAmount('chi', {
      $or: [
        { hoa_don_id: invoice._id },
        ...(invoice.don_hang_id ? [{ don_hang_id: invoice.don_hang_id }] : [])
      ]
    });
    const remaining = Math.max(0, paidReceipts - refunded);
    if (remaining <= 0) continue;
    result.push(mapRow({
      _id: invoice._id,
      code: invoice.ma_hoa_don,
      total: paidReceipts,
      remaining,
      nhom: 'khach_hang',
      entity_id: invoice.khach_hang_id?._id || invoice.khach_hang_id,
      partner: invoice.khach_hang_id?.ten_khach_hang || ''
    }));
  }
  return result;
}

async function listRelatedDocuments({
  cua_hang_id,
  loai_phieu,
  document_type,
  nhom_doi_tuong,
  doi_tuong_entity_id
}) {
  const storeId = toObjectId(cua_hang_id);
  if (!storeId) throw new Error('Thieu cua_hang_id');
  if (!['thu', 'chi'].includes(loai_phieu)) throw new Error('Loai phieu khong hop le');

  const docType = String(document_type || '').trim();
  if (!docType || docType === 'khac') {
    return { items: [], message: docType === 'khac' ? 'Loai Khac khong can chon chung tu' : '' };
  }

  const entityId = toObjectId(doi_tuong_entity_id);
  const group = String(nhom_doi_tuong || '').trim();

  if (group === 'khac') {
    return { items: [], message: 'Nhom Khac khong gan chung tu he thong' };
  }

  const needsEntity = ['khach_hang', 'nha_cung_cap', 'nhan_vien', 'doi_tac_giao_hang'].includes(group);
  if (needsEntity && !entityId) {
    return { items: [], message: 'Vui long chon nguoi nop/nhan tu danh sach' };
  }

  let items = [];

  if (loai_phieu === 'thu') {
    if (docType === 'don_hang') {
      if (group !== 'khach_hang') return { items: [], message: 'Don hang chi ap dung nhom Khach hang' };
      items = await listDonHangThu(storeId, entityId);
    } else if (docType === 'hoa_don') {
      if (group !== 'khach_hang') return { items: [], message: 'Hoa don chi ap dung nhom Khach hang' };
      items = await listHoaDonThu(storeId, entityId);
    } else if (docType === 'van_don') {
      items = await listVanDonThu(
        storeId,
        group === 'khach_hang' ? entityId : null,
        group === 'doi_tac_giao_hang' ? entityId : null
      );
    } else if (docType === 'phieu_tra_hang_nhap') {
      if (group !== 'nha_cung_cap') return { items: [], message: 'Phieu tra hang nhap chi ap dung nhom Nha cung cap' };
      items = await listPhieuTraHangNhapThu(storeId, entityId);
    }
  } else if (loai_phieu === 'chi') {
    if (docType === 'phieu_nhap') {
      if (group !== 'nha_cung_cap') return { items: [], message: 'Phieu nhap chi ap dung nhom Nha cung cap' };
      items = await listPhieuNhapChi(storeId, entityId);
    } else if (docType === 'phieu_tra_hang') {
      if (group !== 'khach_hang') return { items: [], message: 'Phieu tra hang ban chi ap dung nhom Khach hang' };
      items = await listPhieuTraHangChi(storeId, entityId);
    } else if (docType === 'van_don') {
      if (group !== 'doi_tac_giao_hang') {
        return { items: [], message: 'Phi giao hang chi ap dung nhom Doi tac giao hang' };
      }
      items = await listVanDonChi(storeId, entityId);
    } else if (docType === 'don_hang') {
      if (group !== 'khach_hang') return { items: [], message: 'Hoan tien don hang chi ap dung nhom Khach hang' };
      items = await listDonHangChiRefund(storeId, entityId);
    } else if (docType === 'hoa_don') {
      if (group !== 'khach_hang') return { items: [], message: 'Hoan tien hoa don chi ap dung nhom Khach hang' };
      items = await listHoaDonChiRefund(storeId, entityId);
    }
  }

  return { items, message: '' };
}

const DOC_REF_FIELD = {
  don_hang: 'don_hang_id',
  hoa_don: 'hoa_don_id',
  phieu_nhap: 'phieu_nhap_id',
  phieu_tra_hang_nhap: 'phieu_tra_hang_nhap_id',
  phieu_tra_hang: 'phieu_tra_hang_id',
  van_don: 'van_don_id',
};

async function getDocumentRemaining({ cua_hang_id, loai_phieu, document_type, document_id }) {
  const storeId = toObjectId(cua_hang_id);
  const docId = toObjectId(document_id);
  const docType = String(document_type || '').trim();
  if (!storeId || !docId || !DOC_REF_FIELD[docType]) {
    return { remaining: 0, found: false };
  }

  if (loai_phieu === 'thu') {
    if (docType === 'don_hang') {
      const order = await DonHang.findOne({ _id: docId, cua_hang_id: storeId }).lean();
      if (!order || ['cancelled'].includes(String(order.trang_thai || ''))) return { remaining: 0, found: false };
      const payable = Number(order.khach_can_tra ?? order.tong_thanh_toan ?? order.tong_tien ?? 0);
      const paidReceipts = await sumCustomerNetPaid({ don_hang_id: docId });
      const paid = paidReceipts == null ? Number(order.khach_thanh_toan || 0) : paidReceipts;
      return { remaining: Math.max(0, payable - paid), found: true, code: order.ma_don_hang };
    }
    if (docType === 'hoa_don') {
      const invoice = await HoaDonBanHang.findOne({ _id: docId, cua_hang_id: storeId }).lean();
      if (!invoice || ['cancelled'].includes(String(invoice.trang_thai || ''))) return { remaining: 0, found: false };
      const payable = Number(invoice.thanh_toan || 0);
      const paid = await sumCustomerNetPaid({
        $or: [
          { hoa_don_id: docId },
          ...(invoice.don_hang_id ? [{ don_hang_id: invoice.don_hang_id }] : [])
        ]
      });
      return { remaining: Math.max(0, payable - Number(paid || 0)), found: true, code: invoice.ma_hoa_don };
    }
    if (docType === 'phieu_tra_hang_nhap') {
      const row = await PhieuTraHangNhap.findOne({ _id: docId, cua_hang_id: storeId, deleted_at: null }).lean();
      if (!row || row.trang_thai === 'cancelled') return { remaining: 0, found: false };
      const remaining = Math.max(0, Number(row.ncc_can_tra || 0) - Number(row.ncc_da_tra || 0));
      return { remaining, found: remaining > 0, code: row.ma_phieu_tra_nhap };
    }
    if (docType === 'van_don') {
      const row = await VanDon.findOne({ _id: docId, cua_hang_id: storeId }).lean();
      if (!row || row.trang_thai === 'cancelled') return { remaining: 0, found: false };
      if (!row.cod_enabled || row.trang_thai_cod !== 'chua_thu') return { remaining: 0, found: false };
      const remaining = Number(row.cod_amount || 0);
      return { remaining, found: remaining > 0, code: row.ma_van_don };
    }
  } else {
    if (docType === 'phieu_nhap') {
      const row = await PhieuNhap.findOne({ _id: docId, cua_hang_id: storeId, deleted_at: null }).lean();
      if (!row || row.trang_thai === 'cancelled') return { remaining: 0, found: false };
      const remaining = Number(row.con_no_ncc || 0);
      return { remaining, found: remaining > 0, code: row.ma_phieu_nhap };
    }
    if (docType === 'phieu_tra_hang') {
      const row = await PhieuTraHang.findOne({ _id: docId, cua_hang_id: storeId, deleted_at: null }).lean();
      if (!row || ['cancelled'].includes(String(row.trang_thai || ''))) return { remaining: 0, found: false };
      const paid = await sumReceiptAmount('chi', { phieu_tra_hang_id: docId });
      const remaining = Math.max(0, Number(row.can_tra_khach || 0) - paid);
      return { remaining, found: remaining > 0, code: row.ma_phieu_tra };
    }
    if (docType === 'van_don') {
      const row = await VanDon.findOne({ _id: docId, cua_hang_id: storeId }).lean();
      if (!row || row.trang_thai === 'cancelled') return { remaining: 0, found: false };
      const target = Math.max(Number(row.phi_giao_hang || 0), Number(row.thanh_tien_van_chuyen || 0));
      const paid = await sumReceiptAmount('chi', { van_don_id: docId });
      const remaining = Math.max(0, target - paid);
      return { remaining, found: remaining > 0, code: row.ma_van_don };
    }
    if (docType === 'don_hang') {
      const order = await DonHang.findOne({ _id: docId, cua_hang_id: storeId }).lean();
      if (!order || ['cancelled'].includes(String(order.trang_thai || ''))) return { remaining: 0, found: false };
      const paid = Number(order.khach_thanh_toan || 0);
      const refunded = await sumReceiptAmount('chi', { don_hang_id: docId });
      const remaining = Math.max(0, paid - refunded);
      return { remaining, found: remaining > 0, code: order.ma_don_hang };
    }
    if (docType === 'hoa_don') {
      const invoice = await HoaDonBanHang.findOne({ _id: docId, cua_hang_id: storeId }).lean();
      if (!invoice || ['cancelled'].includes(String(invoice.trang_thai || ''))) return { remaining: 0, found: false };
      const thu = await sumReceiptAmount('thu', {
        $or: [
          { hoa_don_id: docId },
          ...(invoice.don_hang_id ? [{ don_hang_id: invoice.don_hang_id }] : [])
        ]
      });
      const refunded = await sumReceiptAmount('chi', {
        $or: [
          { hoa_don_id: docId },
          ...(invoice.don_hang_id ? [{ don_hang_id: invoice.don_hang_id }] : [])
        ]
      });
      const remaining = Math.max(0, thu - refunded);
      return { remaining, found: remaining > 0, code: invoice.ma_hoa_don };
    }
  }

  return { remaining: 0, found: false };
}

async function validateReceiptDocumentAmount(data) {
  const docType = String(data.document_type || '').trim();
  if (!docType || docType === 'khac') return;

  const field = DOC_REF_FIELD[docType];
  if (!field) return;

  const docId = data[field];
  if (!isObjectId(docId)) {
    throw new Error('Chung tu lien quan khong hop le');
  }

  const remainingInfo = await getDocumentRemaining({
    cua_hang_id: data.cua_hang_id,
    loai_phieu: data.loai_phieu,
    document_type: docType,
    document_id: docId
  });

  if (!remainingInfo.found || remainingInfo.remaining <= 0) {
    throw new Error('Chung tu da het so tien can thu/chi hoac da huy');
  }

  const amount = parseMoney(data.gia_tri);
  if (amount > remainingInfo.remaining) {
    throw new Error(
      `So tien vuot so con lai ${remainingInfo.remaining.toLocaleString('vi-VN')} VND (${remainingInfo.code || ''})`
    );
  }
}

module.exports = {
  listRelatedDocuments,
  getDocumentRemaining,
  validateReceiptDocumentAmount,
  DOC_REF_FIELD
};
