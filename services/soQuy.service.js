const mongoose = require('mongoose');
const {
  PhieuThuChi,
  SoQuy,
  CuaHang,
  KhachHang,
  NhaCungCap,
  CongNoKhachHang,
  CongNoNhaCungCap
} = require('../models/kiot.model');

function parseMoney(value) {
  return Number(String(value || '').replace(/\./g, '').replace(/,/g, '')) || 0;
}

function isObjectId(value) {
  return mongoose.Types.ObjectId.isValid(String(value || '').trim());
}

function optionalId(value) {
  return isObjectId(value) ? value : undefined;
}

function normalizePaymentMethod(value) {
  return ['tien_mat', 'chuyen_khoan', 'vi_dien_tu', 'khac'].includes(value) ? value : 'tien_mat';
}

function normalizeSubjectGroup(value, customerId, supplierId) {
  if (customerId) return 'khach_hang';
  if (supplierId) return 'nha_cung_cap';
  if (['khach_hang', 'nha_cung_cap', 'doi_tac_giao_hang', 'nhan_vien', 'khac'].includes(value)) return value;
  return 'khac';
}

async function ensureDefaultSoQuy(cuaHangId) {
  const query = cuaHangId && isObjectId(cuaHangId)
    ? { loai: 'cash', cua_hang_id: cuaHangId }
    : { loai: 'cash' };
  let cashBook = await SoQuy.findOne(query);
  if (!cashBook && query.cua_hang_id) cashBook = await SoQuy.findOne({ loai: 'cash' });
  if (!cashBook) {
    const store = cuaHangId && isObjectId(cuaHangId)
      ? await CuaHang.findById(cuaHangId)
      : await CuaHang.findOne().sort({ created_at: 1 });
    cashBook = await SoQuy.create({
      ten_so_quy: 'So tien mat',
      loai: 'cash',
      so_du: 0,
      trang_thai: 'active',
      cua_hang_id: store?._id || null
    });
  }
  return cashBook;
}

async function makeReceiptCode(loaiPhieu) {
  const count = await PhieuThuChi.countDocuments({ loai_phieu: loaiPhieu });
  return (loaiPhieu === 'thu' ? 'PT' : 'PC') + String(count + 1).padStart(6, '0');
}

async function resolvePartner(data) {
  let customerId = optionalId(data.khach_hang_id);
  let supplierId = optionalId(data.nha_cung_cap_id);
  let partnerName = String(data.doi_tuong || '').trim();

  if (!customerId && data.doi_tuong_loai === 'khach_hang') customerId = optionalId(data.doi_tuong_id);
  if (!supplierId && data.doi_tuong_loai === 'nha_cung_cap') supplierId = optionalId(data.doi_tuong_id);

  if (customerId) {
    const customer = await KhachHang.findById(customerId).select('ten_khach_hang');
    partnerName = customer?.ten_khach_hang || partnerName;
  }
  if (supplierId) {
    const supplier = await NhaCungCap.findById(supplierId).select('ten_ncc');
    partnerName = supplier?.ten_ncc || partnerName;
  }
  if (!partnerName) partnerName = 'Khac';

  return { customerId, supplierId, partnerName };
}

async function ghiCongNoKhachHang(receipt, amount, data) {
  if (!receipt.khach_hang_id) return;
  if (receipt.loai_phieu === 'thu') {
    const customer = await KhachHang.findById(receipt.khach_hang_id).select('tong_no').lean();
    if (customer && typeof customer.tong_no === 'number') {
      await KhachHang.updateOne({ _id: receipt.khach_hang_id }, { $inc: { tong_no: -amount } });
    }
    await CongNoKhachHang.create({
      khach_hang_id: receipt.khach_hang_id,
      don_hang_id: receipt.don_hang_id || undefined,
      hoa_don_id: receipt.hoa_don_id || undefined,
      phieu_thu_chi_id: receipt._id,
      so_tien: amount,
      loai: 'thanh_toan',
      ghi_chu: data.ghi_chu || `Thanh toan ${receipt.ma_phieu}`,
      ngay: receipt.ngay_lap
    });
  } else {
    const customer = await KhachHang.findById(receipt.khach_hang_id).select('tong_no').lean();
    if (customer && typeof customer.tong_no === 'number') {
      await KhachHang.updateOne({ _id: receipt.khach_hang_id }, { $inc: { tong_no: amount } });
    }
    await CongNoKhachHang.create({
      khach_hang_id: receipt.khach_hang_id,
      don_hang_id: receipt.don_hang_id || undefined,
      hoa_don_id: receipt.hoa_don_id || undefined,
      phieu_thu_chi_id: receipt._id,
      so_tien: amount,
      loai: 'tang_no',
      ghi_chu: data.ghi_chu || `Phieu chi ${receipt.ma_phieu}`,
      ngay: receipt.ngay_lap
    });
  }
}

async function ghiCongNoNhaCungCap(receipt, amount, data) {
  if (!receipt.nha_cung_cap_id) return;
  const storeId = receipt.cua_hang_id || data.cua_hang_id;
  if (!storeId) throw new Error('Thieu cua_hang_id khi ghi cong no nha cung cap');

  if (receipt.loai_phieu === 'chi') {
    const supplier = await NhaCungCap.findById(receipt.nha_cung_cap_id).select('tong_no').lean();
    if (supplier && typeof supplier.tong_no === 'number') {
      await NhaCungCap.updateOne({ _id: receipt.nha_cung_cap_id }, { $inc: { tong_no: -amount } });
    }
    await CongNoNhaCungCap.create({
      cua_hang_id: storeId,
      nha_cung_cap_id: receipt.nha_cung_cap_id,
      phieu_nhap_id: receipt.phieu_nhap_id || undefined,
      phieu_tra_nhap_id: receipt.phieu_tra_hang_nhap_id || undefined,
      phieu_thu_chi_id: receipt._id,
      so_tien: amount,
      loai: 'thanh_toan',
      ghi_chu: data.ghi_chu || `Thanh toan NCC ${receipt.ma_phieu}`,
      ngay: receipt.ngay_lap
    });
  } else {
    const supplier = await NhaCungCap.findById(receipt.nha_cung_cap_id).select('tong_no').lean();
    if (supplier && typeof supplier.tong_no === 'number') {
      await NhaCungCap.updateOne({ _id: receipt.nha_cung_cap_id }, { $inc: { tong_no: -amount } });
    }
    await CongNoNhaCungCap.create({
      cua_hang_id: storeId,
      nha_cung_cap_id: receipt.nha_cung_cap_id,
      phieu_nhap_id: receipt.phieu_nhap_id || undefined,
      phieu_tra_nhap_id: receipt.phieu_tra_hang_nhap_id || undefined,
      phieu_thu_chi_id: receipt._id,
      so_tien: amount,
      loai: 'giam_no',
      ghi_chu: data.ghi_chu || `NCC hoan tien ${receipt.ma_phieu}`,
      ngay: receipt.ngay_lap
    });
  }
}

async function taoPhieuThuChi(data = {}) {
  const loaiPhieu = data.loai_phieu;
  if (!['thu', 'chi'].includes(loaiPhieu)) throw new Error('Loai phieu khong hop le');

  const amount = parseMoney(data.gia_tri ?? data.so_tien);
  if (amount <= 0) throw new Error('gia_tri phai lon hon 0');

  if (!data.so_quy_id || !isObjectId(data.so_quy_id)) throw new Error('Bat buoc so_quy_id');
  const cashBook = await SoQuy.findById(data.so_quy_id);
  if (!cashBook) throw new Error('Khong tim thay so quy');
  if (loaiPhieu === 'chi' && cashBook.cho_phep_am === false && Number(cashBook.so_du || 0) < amount) {
    throw new Error('So quy khong du so du de chi');
  }

  const { customerId, supplierId, partnerName } = await resolvePartner(data);
  const code = String(data.ma_phieu || '').trim() || await makeReceiptCode(loaiPhieu);
  const storeId = optionalId(data.cua_hang_id) || cashBook.cua_hang_id || undefined;
  const receipt = await PhieuThuChi.create({
    ma_phieu: code,
    ngay_lap: data.ngay_lap ? new Date(data.ngay_lap) : new Date(),
    loai_phieu: loaiPhieu,
    loai_thu_chi: data.loai_thu_chi || (loaiPhieu === 'thu' ? 'Thu khac' : 'Chi khac'),
    gia_tri: amount,
    doi_tuong: partnerName,
    ghi_chu: data.ghi_chu,
    trang_thai: data.trang_thai || 'paid',
    hach_toan: data.hach_toan === true || data.hach_toan === 'true' || data.hach_toan === 'on',
    cua_hang_id: storeId,
    chi_nhanh_id: optionalId(data.chi_nhanh_id),
    so_quy_id: cashBook._id,
    nguoi_tao_id: optionalId(data.nguoi_tao_id),
    khach_hang_id: customerId,
    nha_cung_cap_id: supplierId,
    don_hang_id: optionalId(data.don_hang_id),
    hoa_don_id: optionalId(data.hoa_don_id),
    phieu_nhap_id: optionalId(data.phieu_nhap_id),
    phieu_tra_hang_nhap_id: optionalId(data.phieu_tra_hang_nhap_id),
    van_don_id: optionalId(data.van_don_id),
    ma_chung_tu_goc: data.ma_chung_tu_goc,
    nhom_doi_tuong: normalizeSubjectGroup(data.nhom_doi_tuong, customerId, supplierId),
    phuong_thuc_thanh_toan: normalizePaymentMethod(data.phuong_thuc_thanh_toan)
  });

  await SoQuy.findByIdAndUpdate(cashBook._id, { $inc: { so_du: loaiPhieu === 'thu' ? amount : -amount } });

  if (receipt.hach_toan) {
    if (customerId) await ghiCongNoKhachHang(receipt, amount, data);
    if (supplierId) await ghiCongNoNhaCungCap(receipt, amount, data);
  }

  return receipt;
}

module.exports = {
  taoPhieuThuChi,
  ensureDefaultSoQuy,
  parseMoney
};
