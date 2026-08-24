const mongoose = require('mongoose');
const { CHANGE_RECEIPT_LOAI_THU_CHI } = require('../utils/customerPayment');
const { buildReceiptPaymentInfo } = require('./paymentCashBook.service');

const {
  PhieuThuChi,
  SoQuy,
  KhachHang,
  NhaCungCap,
  DoiTacGiaoHang,
  CongNoKhachHang,
  CongNoNhaCungCap
} = require('../models/kiot.model');
const { NhanVien } = require('../models/chamcong.model');

const DOCUMENT_TYPE_TO_FIELD = {

  don_hang: 'don_hang_id',

  hoa_don: 'hoa_don_id',

  phieu_nhap: 'phieu_nhap_id',

  nhap_vat_chua: 'nhap_vat_chua_id',

  xuat_vat_chua: 'xuat_vat_chua_id',

  phieu_tra_hang_nhap: 'phieu_tra_hang_nhap_id',

  phieu_tra_hang: 'phieu_tra_hang_id',

  van_don: 'van_don_id',

};

const ALL_DOCUMENT_FIELDS = Object.values(DOCUMENT_TYPE_TO_FIELD);

function parseMoney(value) {

  return Number(String(value || '').replace(/\./g, '').replace(/,/g, '')) || 0;

}

function isObjectId(value) {

  return mongoose.Types.ObjectId.isValid(String(value || '').trim());

}

function optionalId(value) {

  return isObjectId(value) ? value : undefined;

}

function parseCheckbox(value) {

  return value === true || value === 'true' || value === 'on';

}

function normalizePaymentMethod(value) {
  return ['tien_mat', 'chuyen_khoan', 'vi_dien_tu', 'khac'].includes(value) ? value : 'tien_mat';
}

function paymentMethodFromCashBookName(tenSoQuy) {
  const name = String(tenSoQuy || '').trim();
  if (!name) return 'tien_mat';
  const lower = name.toLowerCase();
  const plain = lower.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const blob = `${lower} ${plain}`;
  if (blob.includes('tien mat') || blob.includes('tiền mặt')) return 'tien_mat';
  if (blob.includes('chuyen khoan') || blob.includes('chuyển khoản')) return 'chuyen_khoan';
  if (
    blob.includes('vi dien tu')
    || blob.includes('ví điện tử')
    || blob.includes('momo')
    || blob.includes('zalopay')
  ) return 'vi_dien_tu';
  return 'khac';
}

function normalizeChiTietThanhToan(raw, giaTri) {
  const amount = parseMoney(giaTri);
  const tienMat = Math.max(0, parseMoney(raw?.tien_mat));
  const chuyenKhoan = Math.max(0, parseMoney(raw?.chuyen_khoan));
  const tienTraKhach = Math.max(0, parseMoney(raw?.tien_tra_khach));
  if (tienMat > 0 || chuyenKhoan > 0 || tienTraKhach > 0) {
    return { tien_mat: tienMat, chuyen_khoan: chuyenKhoan, tien_tra_khach: tienTraKhach };
  }
  if (amount > 0) {
    return { tien_mat: amount, chuyen_khoan: 0, tien_tra_khach: 0 };
  }
  return { tien_mat: 0, chuyen_khoan: 0, tien_tra_khach: 0 };
}

function resolvePaymentMethod(data, cashBook) {
  const explicit = String(data.phuong_thuc_thanh_toan || '').trim();
  if (explicit && ['tien_mat', 'chuyen_khoan', 'vi_dien_tu', 'khac'].includes(explicit)) {
    return explicit;
  }
  return paymentMethodFromCashBookName(cashBook?.ten_so_quy);
}



function normalizeSubjectGroup(value, customerId, supplierId, employeeId, carrierId) {

  if (customerId) return 'khach_hang';

  if (supplierId) return 'nha_cung_cap';

  if (carrierId) return 'doi_tac_giao_hang';

  if (['khach_hang', 'nha_cung_cap', 'doi_tac_giao_hang', 'khac'].includes(value)) return value;

  return 'khac';

}



function normalizeAllocations(value) {

  if (!Array.isArray(value)) return [];

  return value.map(item => {

    const phieuNhapId = optionalId(item && item.phieu_nhap_id);
    const nhapVatChuaId = optionalId(item && item.nhap_vat_chua_id);
    const hoaDonId = optionalId(item && item.hoa_don_id);

    const amount = parseMoney(item && item.so_tien);

    if ((!phieuNhapId && !nhapVatChuaId && !hoaDonId) || amount <= 0) return null;

    return {

      phieu_nhap_id: phieuNhapId || undefined,

      nhap_vat_chua_id: nhapVatChuaId || undefined,

      hoa_don_id: hoaDonId || undefined,

      ma_phieu_nhap: String(item.ma_phieu_nhap || '').trim(),

      ma_nhap_vat_chua: String(item.ma_nhap_vat_chua || '').trim(),

      ma_hoa_don: String(item.ma_hoa_don || '').trim(),

      so_tien: amount,

      con_no_truoc: parseMoney(item.con_no_truoc),

      con_no_sau: parseMoney(item.con_no_sau)

    };

  }).filter(Boolean);

}



function withSession(options, session) {

  return session ? Object.assign({}, options, { session }) : options;

}



function sanitizeDocumentRefs(data) {

  const docType = String(data.document_type || '').trim();

  const refs = {};

  ALL_DOCUMENT_FIELDS.forEach(field => {

    refs[field] = undefined;

  });



  if (docType && docType !== 'khac' && DOCUMENT_TYPE_TO_FIELD[docType]) {

    const field = DOCUMENT_TYPE_TO_FIELD[docType];

    const id = optionalId(data[field]);

    if (id) refs[field] = id;

  }



  const maChungTu = String(data.ma_chung_tu_goc || '').trim();

  if (maChungTu) refs.ma_chung_tu_goc = maChungTu;

  const chungTuKhac = String(data.chung_tu_khac || '').trim();

  if (docType === 'khac' && chungTuKhac) refs.chung_tu_khac = chungTuKhac;



  return refs;

}



async function makeReceiptCode(loaiPhieu, session) {

  const prefix = loaiPhieu === 'thu' ? 'PT' : 'PC';
  const regex = new RegExp('^' + prefix + '(\\d+)$');
  const last = await PhieuThuChi.findOne({
    loai_phieu: loaiPhieu,
    ma_phieu: { $regex: regex }
  }).sort({ ma_phieu: -1 }).select('ma_phieu').session(session || null).lean();

  const match = last && String(last.ma_phieu || '').match(regex);
  let next = match ? Number(match[1]) + 1 : 1;

  for (let i = 0; i < 10000; i += 1) {
    const code = prefix + String(next + i).padStart(6, '0');
    const exists = await PhieuThuChi.exists({ ma_phieu: code }).session(session || null);
    if (!exists) return code;
  }

  return prefix + String(Date.now()).slice(-10);

}



async function resolvePartner(data) {

  const group = data.nhom_doi_tuong;

  const entityId = optionalId(data.doi_tuong_entity_id)

    || optionalId(data.doi_tuong_id)

    || (group === 'khach_hang' ? optionalId(data.khach_hang_id) : undefined)

    || (group === 'nha_cung_cap' ? optionalId(data.nha_cung_cap_id) : undefined)

    || (group === 'nhan_vien' ? optionalId(data.nhan_vien_id) : undefined)

    || (group === 'doi_tac_giao_hang' ? optionalId(data.doi_tac_giao_hang_id) : undefined);



  let displayName = String(data.doi_tuong || '').trim();

  const result = {

    khach_hang_id: undefined,

    nha_cung_cap_id: undefined,

    nhan_vien_id: undefined,

    doi_tac_giao_hang_id: undefined,

    displayName: ''

  };



  if (group === 'khac') {

    result.displayName = displayName || 'Khác';

    return result;

  }



  if (group === 'khach_hang' && entityId) {

    const customer = await KhachHang.findById(entityId).select('ten_khach_hang');

    result.khach_hang_id = entityId;

    displayName = customer?.ten_khach_hang || displayName;

  } else if (group === 'nha_cung_cap' && entityId) {

    const supplier = await NhaCungCap.findById(entityId).select('ten_ncc');

    result.nha_cung_cap_id = entityId;

    displayName = supplier?.ten_ncc || displayName;

  } else if (group === 'nhan_vien' && entityId) {

    const employee = await NhanVien.findById(entityId).select('ten_nhan_vien');

    result.nhan_vien_id = entityId;

    displayName = employee?.ten_nhan_vien || displayName;

  } else if (group === 'doi_tac_giao_hang' && entityId) {
    const carrier = await DoiTacGiaoHang.findById(entityId).select('ten_doi_tac');
    result.doi_tac_giao_hang_id = entityId;
    displayName = carrier?.ten_doi_tac || displayName;
  }



  if (!entityId) {

    result.displayName = displayName || 'Khác';

    return result;

  }



  if (!displayName) displayName = 'Khác';

  result.displayName = displayName;

  return result;

}



async function ghiCongNoKhachHang(receipt, amount, data, session) {

  if (!receipt.khach_hang_id) return;

  if (receipt.loai_phieu === 'thu') {

    const customer = await KhachHang.findById(receipt.khach_hang_id).select('tong_no').session(session || null).lean();

    if (customer && typeof customer.tong_no === 'number') {

      await KhachHang.updateOne({ _id: receipt.khach_hang_id }, { $inc: { tong_no: -amount } }, withSession({}, session));

    }

    await CongNoKhachHang.create([{

      khach_hang_id: receipt.khach_hang_id,

      don_hang_id: receipt.don_hang_id || undefined,

      hoa_don_id: receipt.hoa_don_id || undefined,

      phieu_thu_chi_id: receipt._id,

      so_tien: amount,

      loai: 'thanh_toan',

      ghi_chu: data.ghi_chu || `Thanh toan ${receipt.ma_phieu}`,

      ngay: receipt.ngay_lap

    }], withSession({}, session));

  } else {

    const customer = await KhachHang.findById(receipt.khach_hang_id).select('tong_no').session(session || null).lean();

    if (customer && typeof customer.tong_no === 'number') {

      await KhachHang.updateOne({ _id: receipt.khach_hang_id }, { $inc: { tong_no: amount } }, withSession({}, session));

    }

    await CongNoKhachHang.create([{

      khach_hang_id: receipt.khach_hang_id,

      don_hang_id: receipt.don_hang_id || undefined,

      hoa_don_id: receipt.hoa_don_id || undefined,

      phieu_thu_chi_id: receipt._id,

      so_tien: amount,

      loai: 'tang_no',

      ghi_chu: data.ghi_chu || `Phieu chi ${receipt.ma_phieu}`,

      ngay: receipt.ngay_lap

    }], withSession({}, session));

  }

}



async function ghiCongNoNhaCungCap(receipt, amount, data, session) {

  if (!receipt.nha_cung_cap_id) return;

  const storeId = receipt.cua_hang_id || data.cua_hang_id;

  if (!storeId) throw new Error('Thieu cua_hang_id khi ghi cong no nha cung cap');



  if (receipt.loai_phieu === 'chi') {

    const supplier = await NhaCungCap.findById(receipt.nha_cung_cap_id).select('tong_no').session(session || null).lean();

    if (supplier && typeof supplier.tong_no === 'number') {

      await NhaCungCap.updateOne({ _id: receipt.nha_cung_cap_id }, { $inc: { tong_no: -amount } }, withSession({}, session));

    }

    await CongNoNhaCungCap.create([{

      cua_hang_id: storeId,

      nha_cung_cap_id: receipt.nha_cung_cap_id,

      phieu_nhap_id: receipt.phieu_nhap_id || undefined,

      nhap_vat_chua_id: receipt.nhap_vat_chua_id || undefined,

      phieu_tra_nhap_id: receipt.phieu_tra_hang_nhap_id || undefined,

      phieu_thu_chi_id: receipt._id,

      so_tien: amount,

      loai: 'thanh_toan',

      ghi_chu: data.ghi_chu || `Thanh toan NCC ${receipt.ma_phieu}`,

      ngay: receipt.ngay_lap

    }], withSession({}, session));

  } else {

    const supplier = await NhaCungCap.findById(receipt.nha_cung_cap_id).select('tong_no').session(session || null).lean();

    if (supplier && typeof supplier.tong_no === 'number') {

      await NhaCungCap.updateOne({ _id: receipt.nha_cung_cap_id }, { $inc: { tong_no: amount } }, withSession({}, session));

    }

    await CongNoNhaCungCap.create([{

      cua_hang_id: storeId,

      nha_cung_cap_id: receipt.nha_cung_cap_id,

      phieu_nhap_id: receipt.phieu_nhap_id || undefined,

      nhap_vat_chua_id: receipt.nhap_vat_chua_id || undefined,

      phieu_tra_nhap_id: receipt.phieu_tra_hang_nhap_id || undefined,

      phieu_thu_chi_id: receipt._id,

      so_tien: amount,

      loai: 'tang_no',

      ghi_chu: data.ghi_chu || `NCC hoan tien ${receipt.ma_phieu}`,

      ngay: receipt.ngay_lap

    }], withSession({}, session));

  }

}



async function taoPhieuThuChi(data = {}, options = {}) {

  const loaiPhieu = data.loai_phieu;

  if (!['thu', 'chi'].includes(loaiPhieu)) throw new Error('Loai phieu khong hop le');



  const session = options.session || data.session;

  const storeIdFromData = optionalId(data.cua_hang_id);

  if (!storeIdFromData) throw new Error('Thieu cua_hang_id khi tao phieu thu chi');

  const paymentInfo = data._paymentInfo || await buildReceiptPaymentInfo(data, {
    cuaHangId: storeIdFromData,
    chiNhanhId: data.chi_nhanh_id,
    session
  });
  const amount = paymentInfo.gia_tri;
  const paymentMethod = paymentInfo.phuong_thuc_thanh_toan;

  const partner = await resolvePartner(data);

  const docRefs = sanitizeDocumentRefs(data);

  const displayName = String(data.doi_tuong || '').trim() || partner.displayName;

  const code = String(data.ma_phieu || '').trim() || await makeReceiptCode(loaiPhieu, session);

  const storeId = storeIdFromData;

  const allocations = normalizeAllocations(data.allocations);

  const overpaymentAmount = Math.max(0, parseMoney(data.overpayment_amount));



  const subjectGroup = normalizeSubjectGroup(

    data.nhom_doi_tuong,

    partner.khach_hang_id,

    partner.nha_cung_cap_id,

    partner.nhan_vien_id,

    partner.doi_tac_giao_hang_id

  );



  const hachToan = Boolean(
    parseCheckbox(data.hach_toan)
    && ['khach_hang', 'nha_cung_cap'].includes(subjectGroup)
    && (partner.khach_hang_id || partner.nha_cung_cap_id)
  );

  const receiptRows = await PhieuThuChi.create([{

    ma_phieu: code,

    ngay_lap: data.ngay_lap ? new Date(data.ngay_lap) : new Date(),

    loai_phieu: loaiPhieu,

    loai_thu_chi: data.loai_thu_chi || (loaiPhieu === 'thu' ? 'Thu khac' : 'Chi khac'),

    gia_tri: amount,

    doi_tuong: displayName,

    ghi_chu: data.ghi_chu,

    trang_thai: data.trang_thai || 'paid',

    hach_toan: hachToan,

    cua_hang_id: storeId,

    chi_nhanh_id: optionalId(data.chi_nhanh_id),

    so_quy_id: paymentInfo.so_quy_id,

    nguoi_tao_id: optionalId(data.nguoi_tao_id),

    khach_hang_id: partner.khach_hang_id,

    nha_cung_cap_id: partner.nha_cung_cap_id,

    nhan_vien_id: partner.nhan_vien_id,

    doi_tac_giao_hang_id: partner.doi_tac_giao_hang_id,

    don_hang_id: docRefs.don_hang_id,

    hoa_don_id: docRefs.hoa_don_id,

    phieu_nhap_id: docRefs.phieu_nhap_id,

    nhap_vat_chua_id: docRefs.nhap_vat_chua_id,

    xuat_vat_chua_id: docRefs.xuat_vat_chua_id,

    phieu_tra_hang_nhap_id: docRefs.phieu_tra_hang_nhap_id,

    phieu_tra_hang_id: docRefs.phieu_tra_hang_id,

    van_don_id: docRefs.van_don_id,

    ma_chung_tu_goc: docRefs.ma_chung_tu_goc,

    chung_tu_khac: docRefs.chung_tu_khac,

    allocation_type: data.allocation_type,

    overpayment_amount: overpaymentAmount,

    allocations,

    nhom_doi_tuong: subjectGroup,

    phuong_thuc_thanh_toan: paymentMethod,

    chi_tiet_thanh_toan: paymentInfo.chi_tiet_thanh_toan

  }], withSession({}, session));

  const receipt = receiptRows[0];



  if (receipt.hach_toan) {

    if (partner.khach_hang_id) await ghiCongNoKhachHang(receipt, amount, data, session);

    if (partner.nha_cung_cap_id) await ghiCongNoNhaCungCap(receipt, amount, data, session);

  }



  return receipt;

}

async function taoPhieuThuKhachHang(data = {}) {
  const payment = data.payment;
  if (!payment || !payment.valid) {
    const message = (payment && payment.errors && payment.errors.length)
      ? payment.errors.join('. ')
      : (data.paymentError || 'Thanh toán không hợp lệ');
    throw new Error(message);
  }

  const base = Object.assign({}, data);
  delete base.payment;
  delete base.paymentError;

  const results = { thu: null, chi: null };

  if (payment.tong_khach_dua > 0) {
    const detail = {
      tien_mat: payment.tien_mat,
      chuyen_khoan: payment.chuyen_khoan,
      tien_tra_khach: 0
    };
    if (data.so_quy_tien_mat_id) detail.so_quy_tien_mat_id = data.so_quy_tien_mat_id;
    if (data.so_quy_chuyen_khoan_id) detail.so_quy_chuyen_khoan_id = data.so_quy_chuyen_khoan_id;
    const useV2 = data.payment_v2 === true
      || data.payment_v2 === 'true'
      || detail.so_quy_tien_mat_id
      || detail.so_quy_chuyen_khoan_id
      || (payment.tien_mat > 0 && payment.chuyen_khoan > 0);
    results.thu = await taoPhieuThuChi(Object.assign({}, base, {
      loai_phieu: 'thu',
      gia_tri: payment.tong_khach_dua,
      payment_v2: useV2,
      chi_tiet_thanh_toan: detail
    }));
  }

  if (payment.tien_thua > 0) {
    const cashBookId = data.so_quy_tien_mat_id || data.so_quy_id || '';
    results.chi = await taoPhieuThuChi(Object.assign({}, base, {
      loai_phieu: 'chi',
      loai_thu_chi: CHANGE_RECEIPT_LOAI_THU_CHI,
      gia_tri: payment.tien_thua,
      hach_toan: false,
      payment_v2: Boolean(cashBookId || data.payment_v2),
      so_quy_tien_mat_id: cashBookId,
      chi_tiet_thanh_toan: {
        tien_mat: payment.tien_thua,
        chuyen_khoan: 0,
        tien_tra_khach: 0,
        so_quy_tien_mat_id: cashBookId
      }
    }));
  }

  return results;
}

module.exports = {
  taoPhieuThuChi,
  taoPhieuThuKhachHang,
  parseMoney,
  parseCheckbox,
  sanitizeDocumentRefs,
  resolvePartner,
  paymentMethodFromCashBookName,
  resolvePaymentMethod
};
