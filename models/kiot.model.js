var db = require('./db.model');
const mongoose = db.mongoose;
const Schema = mongoose.Schema;
const ObjectId = Schema.Types.ObjectId;

// CUA_HANG
const CuaHangSchema = new Schema({
  ma_cua_hang: { type: String, unique: true },
  ten_cua_hang: { type: String },
  dia_chi: { type: String },
  dia_chi_gui_hang: { type: String },
  tinh_thanh: { type: String },
  quan_huyen: { type: String },
  phuong_xa: { type: String },
  sdt: { type: String },
  email: { type: String },
  trang_thai: { type: String, default: 'active' }
}, { collection: "cua_hang", timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

// CHI_NHANH
const ChiNhanhSchema = new Schema({
  ma_chi_nhanh: { type: String, unique: true },
  ten_chi_nhanh: { type: String },
  dia_chi: { type: String },
  sdt: { type: String },
  cua_hang_id: { type: ObjectId, ref: 'CuaHang' },
  trang_thai: { type: String, default: 'active' }
}, { collection: "chi_nhanh", timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

// NGUOI_DUNG
const NguoiDungSchema = new Schema({
  google_id: { type: String, unique: true, sparse: true },
  email: { type: String, unique: true, required: true },
  ho_ten: { type: String },
  anh_dai_dien: { type: String },
  sdt: { type: String },
  dia_chi: { type: String },
  vai_tro: { type: String, enum: ['admin', 'user'], default: 'user' },
  cua_hang_id: { type: ObjectId, ref: 'CuaHang' },
  chi_nhanh_id: { type: ObjectId, ref: 'ChiNhanh' },
  trang_thai: { type: String, enum: ['active', 'inactive', 'blocked'], default: 'active' },
  lan_dang_nhap_cuoi: { type: Date }
}, { collection: "nguoi_dung", timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

// NHOM_KHACH_HANG
const NhomKhachHangSchema = new Schema({
  ten_nhom: { type: String },
  mo_ta: { type: String },
  cua_hang_id: { type: ObjectId, ref: 'CuaHang' }
}, { collection: "nhom_khach_hang", timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

// KHACH_HANG
const KhachHangSchema = new Schema({
  ma_khach_hang: { type: String, unique: true },
  ten_khach_hang: { type: String },
  sdt: { type: String },
  sdt2: { type: String },
  email: { type: String },
  facebook: { type: String },
  ngay_sinh: { type: Date },
  gioi_tinh: { type: String },
  loai_khach_hang: { type: String, enum: ['ca_nhan', 'cong_ty'], default: 'ca_nhan' },
  dia_chi_nhan: { type: String },
  tinh_thanh: { type: String },
  quan_huyen: { type: String },
  phuong_xa: { type: String },
  ghi_chu: { type: String },
  ten_nguoi_mua: { type: String },
  ten_cong_ty: { type: String },
  ma_so_thue: { type: String },
  tong_no: { type: Number, default: 0 },
  trang_thai: { type: String, enum: ['active', 'inactive'], default: 'active' },
  cua_hang_id: { type: ObjectId, ref: 'CuaHang' },
  nhom_khach_hang_id: { type: ObjectId, ref: 'NhomKhachHang' },
  nguoi_tao_id: { type: ObjectId, ref: 'NguoiDung' }
}, { collection: "khach_hang", timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

// DIA_CHI_KHACH_HANG
const DiaChiKhachHangSchema = new Schema({
  khach_hang_id: { type: ObjectId, ref: 'KhachHang' },
  dia_chi: { type: String },
  tinh_thanh: { type: String },
  quan_huyen: { type: String },
  phuong_xa: { type: String },
  mac_dinh: { type: Boolean, default: false }
}, { collection: "dia_chi_khach_hang" });

// NHA_CUNG_CAP
const NhaCungCapSchema = new Schema({
  ma_ncc: { type: String, unique: true },
  ten_ncc: { type: String },
  sdt: { type: String },
  email: { type: String },
  dia_chi: { type: String },
  tinh_thanh: { type: String },
  quan_huyen: { type: String },
  phuong_xa: { type: String },
  ghi_chu: { type: String },
  nhom_ncc: { type: String },
  ten_cong_ty: { type: String },
  ma_so_thue: { type: String },
  tong_no: { type: Number, default: 0 },
  tong_mua: { type: Number, default: 0 },
  trang_thai: { type: String, enum: ['active', 'inactive'], default: 'active' },
  cua_hang_id: { type: ObjectId, ref: 'CuaHang' },
  nguoi_tao_id: { type: ObjectId, ref: 'NguoiDung' }
}, { collection: "nha_cung_cap", timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

// NHOM_HANG
const NhomHangSchema = new Schema({
  ten_nhom_hang: { type: String },
  mo_ta: { type: String },
  nhom_cha_id: { type: ObjectId, ref: 'NhomHang' },
  cua_hang_id: { type: ObjectId, ref: 'CuaHang' }
}, { collection: "nhom_hang" });

// DON_VI_TINH
const DonViTinhSchema = new Schema({
  ten_don_vi: { type: String },
  cua_hang_id: { type: ObjectId, ref: 'CuaHang' }
}, { collection: "don_vi_tinh" });

// THUONG_HIEU
const ThuongHieuSchema = new Schema({
  ten_thuong_hieu: { type: String },
  mo_ta: { type: String },
  cua_hang_id: { type: ObjectId, ref: 'CuaHang' }
}, { collection: "thuong_hieu" });

// VI_TRI
const ViTriSchema = new Schema({
  ten_vi_tri: { type: String },
  mo_ta: { type: String },
  cua_hang_id: { type: ObjectId, ref: 'CuaHang' }
}, { collection: "vi_tri" });

// HANG_HOA
const HangHoaSchema = new Schema({
  ma_hang: { type: String, unique: true },
  ten_hang: { type: String, required: true },
  loai_hang: { type: String, enum: ['hang_hoa', 'dich_vu', 'combo'], default: 'hang_hoa' },
  mo_ta: { type: String },
  gia_von: { type: Number, default: 0 },
  gia_ban: { type: Number, default: 0 },
  ton_kho: { type: Number, default: 0 },
  dinh_muc_ton_thap: { type: Number, default: 0 },
  dinh_muc_ton_cao: { type: Number, default: 999999999 },
  trong_luong: { type: Number, default: 0 },
  don_vi_trong_luong: { type: String, default: 'g' },
  don_vi_tinh: { type: String, default: 'cái' },
  quan_ly_theo_lo: { type: Boolean, default: false },
  ban_truc_tiep: { type: Boolean, default: true },
  anh_san_pham: [{ type: String }],
  trang_thai: { type: String, enum: ['active', 'inactive'], default: 'active' },
  cua_hang_id: { type: ObjectId, ref: 'CuaHang' },
  nhom_hang_id: { type: ObjectId, ref: 'NhomHang' },
  don_vi_tinh_id: { type: ObjectId, ref: 'DonViTinh' },
  thuong_hieu_id: { type: ObjectId, ref: 'ThuongHieu' },
  vi_tri_id: { type: ObjectId, ref: 'ViTri' },
  nha_cung_cap_id: { type: ObjectId, ref: 'NhaCungCap' },
  nguoi_tao_id: { type: ObjectId, ref: 'NguoiDung' }
}, { collection: "hang_hoa", timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

// THUOC_TINH_HANG
const ThuocTinhHangSchema = new Schema({
  ten_thuoc_tinh: { type: String },
  cua_hang_id: { type: ObjectId, ref: 'CuaHang' }
}, { collection: "thuoc_tinh_hang" });

// GIA_TRI_THUOC_TINH
const GiaTriThuocTinhSchema = new Schema({
  gia_tri: { type: String },
  thuoc_tinh_hang_id: { type: ObjectId, ref: 'ThuocTinhHang' }
}, { collection: "gia_tri_thuoc_tinh" });

// HANG_HOA_THUOC_TINH
const HangHoaThuocTinhSchema = new Schema({
  hang_hoa_id: { type: ObjectId, ref: 'HangHoa' },
  gia_tri_thuoc_tinh_id: { type: ObjectId, ref: 'GiaTriThuocTinh' }
}, { collection: "hang_hoa_thuoc_tinh" });

// BANG_GIA
const BangGiaSchema = new Schema({
  ten_bang_gia: { type: String },
  ngay_bat_dau: { type: Date },
  ngay_ket_thuc: { type: Date },
  trang_thai: { type: String, default: 'active' },
  cua_hang_id: { type: ObjectId, ref: 'CuaHang' }
}, { collection: "bang_gia", timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

// CT_BANG_GIA
const CTBangGiaSchema = new Schema({
  bang_gia_id: { type: ObjectId, ref: 'BangGia' },
  hang_hoa_id: { type: ObjectId, ref: 'HangHoa' },
  gia_ban: { type: Number }
}, { collection: "ct_bang_gia" });

// TON_KHO
const TonKhoSchema = new Schema({
  chi_nhanh_id: { type: ObjectId, ref: 'ChiNhanh' },
  hang_hoa_id: { type: ObjectId, ref: 'HangHoa' },
  so_luong: { type: Number, default: 0 }
}, { collection: "ton_kho" });

// PHIEU_NHAP
const PhieuNhapSchema = new Schema({
  ma_phieu_nhap: { type: String, unique: true },
  ngay_nhap: { type: Date },
  tong_tien: { type: Number },
  trang_thai: { type: String },
  ghi_chu: { type: String },
  cua_hang_id: { type: ObjectId, ref: 'CuaHang' },
  chi_nhanh_id: { type: ObjectId, ref: 'ChiNhanh' },
  nha_cung_cap_id: { type: ObjectId, ref: 'NhaCungCap' },
  nguoi_tao_id: { type: ObjectId, ref: 'NguoiDung' }
}, { collection: "phieu_nhap", timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

// CT_PHIEU_NHAP
const CTPhieuNhapSchema = new Schema({
  phieu_nhap_id: { type: ObjectId, ref: 'PhieuNhap' },
  hang_hoa_id: { type: ObjectId, ref: 'HangHoa' },
  so_luong: { type: Number },
  don_gia_nhap: { type: Number },
  thanh_tien: { type: Number }
}, { collection: "ct_phieu_nhap" });

// HOA_DON_DAU_VAO
const HoaDonDauVaoSchema = new Schema({
  ma_hoa_don: { type: String, unique: true },
  ngay_hoa_don: { type: Date, default: Date.now },
  nha_cung_cap_id: { type: ObjectId, ref: 'NhaCungCap' },
  phieu_nhap_id: { type: ObjectId, ref: 'PhieuNhap' },
  tong_tien: { type: Number, default: 0 },
  trang_thai: { type: String, enum: ['draft', 'completed', 'cancelled'], default: 'completed' },
  ghi_chu: { type: String },
  nguoi_tao_id: { type: ObjectId, ref: 'NguoiDung' }
}, { collection: "hoa_don_dau_vao", timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

// PHIEU_TRA_HANG_NHAP
const PhieuTraHangNhapSchema = new Schema({
  ma_phieu_tra_nhap: { type: String, unique: true },
  ngay_tra: { type: Date, default: Date.now },
  nha_cung_cap_id: { type: ObjectId, ref: 'NhaCungCap' },
  phieu_nhap_id: { type: ObjectId, ref: 'PhieuNhap' },
  tong_tien_tra: { type: Number, default: 0 },
  trang_thai: { type: String, enum: ['draft', 'completed', 'cancelled'], default: 'completed' },
  ly_do: { type: String },
  ghi_chu: { type: String },
  nguoi_tao_id: { type: ObjectId, ref: 'NguoiDung' }
}, { collection: "phieu_tra_hang_nhap", timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

const CTPhieuTraHangNhapSchema = new Schema({
  phieu_tra_nhap_id: { type: ObjectId, ref: 'PhieuTraHangNhap' },
  hang_hoa_id: { type: ObjectId, ref: 'HangHoa' },
  so_luong: { type: Number },
  don_gia: { type: Number },
  thanh_tien: { type: Number }
}, { collection: "ct_phieu_tra_hang_nhap" });

// DON_HANG
const DonHangSchema = new Schema({
  ma_don_hang: { type: String, unique: true },
  ngay_dat: { type: Date, default: Date.now },
  ngay_tao: { type: Date, default: Date.now },
  tong_tien: { type: Number, default: 0 },
  tong_tien_hang: { type: Number },
  tong_thanh_toan: { type: Number },
  trang_thai: { type: String },
  ghi_chu: { type: String },
  cua_hang_id: { type: ObjectId, ref: 'CuaHang' },
  chi_nhanh_id: { type: ObjectId, ref: 'ChiNhanh' },
  khach_hang_id: { type: ObjectId, ref: 'KhachHang' },
  nguoi_tao_id: { type: ObjectId, ref: 'NguoiDung' }
}, { collection: "don_hang", timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

// CT_DON_HANG
const CTDonHangSchema = new Schema({
  don_hang_id: { type: ObjectId, ref: 'DonHang' },
  hang_hoa_id: { type: ObjectId, ref: 'HangHoa' },
  so_luong: { type: Number },
  don_gia_ban: { type: Number },
  chiet_khau: { type: Number },
  thanh_tien: { type: Number }
}, { collection: "ct_don_hang" });

// HOA_DON_BAN_HANG
const HoaDonBanHangSchema = new Schema({
  ma_hoa_don: { type: String, unique: true },
  ngay_ban: { type: Date, default: Date.now },
  tong_tien: { type: Number },
  giam_gia: { type: Number, default: 0 },
  thanh_toan: { type: Number },
  phuong_thuc_tt: { type: String },
  trang_thai: { type: String },
  ghi_chu: { type: String },
  cua_hang_id: { type: ObjectId, ref: 'CuaHang' },
  chi_nhanh_id: { type: ObjectId, ref: 'ChiNhanh' },
  don_hang_id: { type: ObjectId, ref: 'DonHang' },
  khach_hang_id: { type: ObjectId, ref: 'KhachHang' },
  nguoi_ban_id: { type: ObjectId, ref: 'NguoiDung' }
}, { collection: "hoa_don_ban_hang", timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

// CT_HOA_DON_BAN_HANG
const CTHoaDonBanHangSchema = new Schema({
  hoa_don_id: { type: ObjectId, ref: 'HoaDonBanHang' },
  hang_hoa_id: { type: ObjectId, ref: 'HangHoa' },
  so_luong: { type: Number },
  don_gia: { type: Number },
  chiet_khau: { type: Number },
  thanh_tien: { type: Number }
}, { collection: "ct_hoa_don_ban_hang" });

// DOI_TAC_GIAO_HANG / NHA_XE
const DoiTacGiaoHangSchema = new Schema({
  ma_doi_tac: { type: String, unique: true },
  ten_doi_tac: { type: String, required: true },
  sdt: { type: String },
  email: { type: String },
  dia_chi: { type: String },
  ghi_chu: { type: String },
  trang_thai: { type: String, enum: ['active', 'inactive'], default: 'active' }
}, { collection: "doi_tac_giao_hang", timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

// VAN_DON
const VanDonSchema = new Schema({
  ma_van_don: { type: String, unique: true },
  don_hang_id: { type: ObjectId, ref: 'DonHang' },
  hoa_don_id: { type: ObjectId, ref: 'HoaDonBanHang' },
  doi_tac_giao_hang_id: { type: ObjectId, ref: 'DoiTacGiaoHang' },
  cua_hang_id: { type: ObjectId, ref: 'CuaHang' },
  khach_hang_id: { type: ObjectId, ref: 'KhachHang' },
  ten_nguoi_nhan: { type: String },
  sdt_nguoi_nhan: { type: String },
  dia_chi_nhan: { type: String },
  phi_giao_hang: { type: Number, default: 0 },
  trang_thai: { type: String, enum: ['draft', 'shipping', 'completed', 'cancelled'], default: 'draft' },
  ghi_chu: { type: String }
}, { collection: "van_don", timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

// PHIEU_TRA_HANG
const PhieuTraHangSchema = new Schema({
  ma_phieu_tra: { type: String, unique: true },
  ngay_tra: { type: Date, default: Date.now },
  tong_tien_tra: { type: Number },
  ly_do: { type: String },
  trang_thai: { type: String },
  ghi_chu: { type: String },
  cua_hang_id: { type: ObjectId, ref: 'CuaHang' },
  chi_nhanh_id: { type: ObjectId, ref: 'ChiNhanh' },
  hoa_don_id: { type: ObjectId, ref: 'HoaDonBanHang' },
  khach_hang_id: { type: ObjectId, ref: 'KhachHang' },
  nguoi_tao_id: { type: ObjectId, ref: 'NguoiDung' }
}, { collection: "phieu_tra_hang", timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

// CT_PHIEU_TRA_HANG
const CTPhieuTraHangSchema = new Schema({
  phieu_tra_hang_id: { type: ObjectId, ref: 'PhieuTraHang' },
  hang_hoa_id: { type: ObjectId, ref: 'HangHoa' },
  so_luong: { type: Number },
  don_gia: { type: Number },
  thanh_tien: { type: Number }
}, { collection: "ct_phieu_tra_hang" });

// PHIEU_KIEM_KHO
const PhieuKiemKhoSchema = new Schema({
  ma_kiem_kho: { type: String, unique: true },
  ngay_kiem: { type: Date, default: Date.now },
  tong_so_luong_thuc_te: { type: Number },
  tong_so_luong_lech: { type: Number },
  trang_thai: { type: String, enum: ['pending', 'completed'], default: 'completed' },
  ghi_chu: { type: String },
  cua_hang_id: { type: ObjectId, ref: 'CuaHang' },
  chi_nhanh_id: { type: ObjectId, ref: 'ChiNhanh' },
  nguoi_tao_id: { type: ObjectId, ref: 'NguoiDung' }
}, { collection: "phieu_kiem_kho", timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

// CT_PHIEU_KIEM_KHO
const CTPhieuKiemKhoSchema = new Schema({
  phieu_kiem_kho_id: { type: ObjectId, ref: 'PhieuKiemKho' },
  hang_hoa_id: { type: ObjectId, ref: 'HangHoa' },
  ton_kho_he_thong: { type: Number },
  so_luong_thuc_te: { type: Number },
  so_luong_lech: { type: Number },
  gia_tri_lech: { type: Number }
}, { collection: "ct_phieu_kiem_kho" });

// SO_QUY
const SoQuySchema = new Schema({
  ten_so_quy: { type: String },
  loai: { type: String },
  so_du: { type: Number, default: 0 },
  trang_thai: { type: String, default: 'active' },
  cua_hang_id: { type: ObjectId, ref: 'CuaHang' },
  chi_nhanh_id: { type: ObjectId, ref: 'ChiNhanh' }
}, { collection: "so_quy", timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

// PHIEU_THU_CHI
const PhieuThuChiSchema = new Schema({
  ma_phieu: { type: String, unique: true },
  ngay_lap: { type: Date, default: Date.now },
  loai_phieu: { type: String, enum: ['thu', 'chi'] },
  loai_thu_chi: { type: String },
  gia_tri: { type: Number },
  doi_tuong: { type: String },
  ghi_chu: { type: String },
  trang_thai: { type: String, default: 'paid' },
  hach_toan: { type: Boolean, default: true },
  cua_hang_id: { type: ObjectId, ref: 'CuaHang' },
  chi_nhanh_id: { type: ObjectId, ref: 'ChiNhanh' },
  so_quy_id: { type: ObjectId, ref: 'SoQuy' },
  nguoi_tao_id: { type: ObjectId, ref: 'NguoiDung' },
  khach_hang_id: { type: ObjectId, ref: 'KhachHang' },
  nha_cung_cap_id: { type: ObjectId, ref: 'NhaCungCap' }
}, { collection: "phieu_thu_chi", timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

// CONG_NO_KHACH_HANG
const CongNoKhachHangSchema = new Schema({
  khach_hang_id: { type: ObjectId, ref: 'KhachHang' },
  don_hang_id: { type: ObjectId, ref: 'DonHang' },
  hoa_don_id: { type: ObjectId, ref: 'HoaDonBanHang' },
  phieu_thu_chi_id: { type: ObjectId, ref: 'PhieuThuChi' },
  so_tien: { type: Number },
  loai: { type: String },
  ghi_chu: { type: String },
  ngay: { type: Date, default: Date.now }
}, { collection: "cong_no_khach_hang", timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

// CONG_NO_NHA_CUNG_CAP
const CongNoNhaCungCapSchema = new Schema({
  nha_cung_cap_id: { type: ObjectId, ref: 'NhaCungCap' },
  phieu_nhap_id: { type: ObjectId, ref: 'PhieuNhap' },
  phieu_thu_chi_id: { type: ObjectId, ref: 'PhieuThuChi' },
  so_tien: { type: Number },
  loai: { type: String },
  ghi_chu: { type: String },
  ngay: { type: Date, default: Date.now }
}, { collection: "cong_no_nha_cung_cap", timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

// LICH_SU_KHO
const LichSuKhoSchema = new Schema({
  cua_hang_id: { type: ObjectId, ref: 'CuaHang' },
  chi_nhanh_id: { type: ObjectId, ref: 'ChiNhanh' },
  hang_hoa_id: { type: ObjectId, ref: 'HangHoa' },
  nguoi_tao_id: { type: ObjectId, ref: 'NguoiDung' },
  loai_phieu: { type: String },
  ma_phieu: { type: String },
  so_luong_thay_doi: { type: Number },
  ton_kho_sau: { type: Number },
  ghi_chu: { type: String },
  ngay: { type: Date, default: Date.now }
}, { collection: "lich_su_kho", timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

// PHIEU_XUAT_NOI_BO (feature supplement - not in core ref schema)
const PhieuXuatNoiBoSchema = new Schema({
  ma_xuat_noi_bo: { type: String, unique: true },
  ngay_xuat: { type: Date, default: Date.now },
  loai_xuat: { type: String },
  cua_hang_id: { type: ObjectId, ref: 'CuaHang' },
  nguoi_tao_id: { type: ObjectId, ref: 'NguoiDung' },
  nguoi_nhan: { type: String },
  tong_gia_tri: { type: Number, default: 0 },
  trang_thai: { type: String, enum: ['draft', 'completed', 'cancelled'], default: 'draft' },
  ghi_chu: { type: String }
}, { collection: "phieu_xuat_noi_bo", timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

const CTXuatNoiBoSchema = new Schema({
  phieu_xuat_id: { type: ObjectId, ref: 'PhieuXuatNoiBo' },
  hang_hoa_id: { type: ObjectId, ref: 'HangHoa' },
  so_luong: { type: Number },
  gia_von: { type: Number },
  thanh_tien: { type: Number }
}, { collection: "ct_xuat_noi_bo" });

// Register models
const CuaHang = mongoose.models.CuaHang || mongoose.model("CuaHang", CuaHangSchema);
const ChiNhanh = mongoose.models.ChiNhanh || mongoose.model("ChiNhanh", ChiNhanhSchema);
const NguoiDung = mongoose.models.NguoiDung || mongoose.model("NguoiDung", NguoiDungSchema);
const NhomKhachHang = mongoose.models.NhomKhachHang || mongoose.model("NhomKhachHang", NhomKhachHangSchema);
const KhachHang = mongoose.models.KhachHang || mongoose.model("KhachHang", KhachHangSchema);
const DiaChiKhachHang = mongoose.models.DiaChiKhachHang || mongoose.model("DiaChiKhachHang", DiaChiKhachHangSchema);
const NhaCungCap = mongoose.models.NhaCungCap || mongoose.model("NhaCungCap", NhaCungCapSchema);
const NhomHang = mongoose.models.NhomHang || mongoose.model("NhomHang", NhomHangSchema);
const DonViTinh = mongoose.models.DonViTinh || mongoose.model("DonViTinh", DonViTinhSchema);
const ThuongHieu = mongoose.models.ThuongHieu || mongoose.model("ThuongHieu", ThuongHieuSchema);
const ViTri = mongoose.models.ViTri || mongoose.model("ViTri", ViTriSchema);
const HangHoa = mongoose.models.HangHoa || mongoose.model("HangHoa", HangHoaSchema);
const ThuocTinhHang = mongoose.models.ThuocTinhHang || mongoose.model("ThuocTinhHang", ThuocTinhHangSchema);
const GiaTriThuocTinh = mongoose.models.GiaTriThuocTinh || mongoose.model("GiaTriThuocTinh", GiaTriThuocTinhSchema);
const HangHoaThuocTinh = mongoose.models.HangHoaThuocTinh || mongoose.model("HangHoaThuocTinh", HangHoaThuocTinhSchema);
const BangGia = mongoose.models.BangGia || mongoose.model("BangGia", BangGiaSchema);
const CTBangGia = mongoose.models.CTBangGia || mongoose.model("CTBangGia", CTBangGiaSchema);
const TonKho = mongoose.models.TonKho || mongoose.model("TonKho", TonKhoSchema);
const PhieuNhap = mongoose.models.PhieuNhap || mongoose.model("PhieuNhap", PhieuNhapSchema);
const CTPhieuNhap = mongoose.models.CTPhieuNhap || mongoose.model("CTPhieuNhap", CTPhieuNhapSchema);
const HoaDonDauVao = mongoose.models.HoaDonDauVao || mongoose.model("HoaDonDauVao", HoaDonDauVaoSchema);
const PhieuTraHangNhap = mongoose.models.PhieuTraHangNhap || mongoose.model("PhieuTraHangNhap", PhieuTraHangNhapSchema);
const CTPhieuTraHangNhap = mongoose.models.CTPhieuTraHangNhap || mongoose.model("CTPhieuTraHangNhap", CTPhieuTraHangNhapSchema);
const DonHang = mongoose.models.DonHang || mongoose.model("DonHang", DonHangSchema);
const CTDonHang = mongoose.models.CTDonHang || mongoose.model("CTDonHang", CTDonHangSchema);
const HoaDonBanHang = mongoose.models.HoaDonBanHang || mongoose.model("HoaDonBanHang", HoaDonBanHangSchema);
const CTHoaDonBanHang = mongoose.models.CTHoaDonBanHang || mongoose.model("CTHoaDonBanHang", CTHoaDonBanHangSchema);
const DoiTacGiaoHang = mongoose.models.DoiTacGiaoHang || mongoose.model("DoiTacGiaoHang", DoiTacGiaoHangSchema);
const VanDon = mongoose.models.VanDon || mongoose.model("VanDon", VanDonSchema);
const PhieuTraHang = mongoose.models.PhieuTraHang || mongoose.model("PhieuTraHang", PhieuTraHangSchema);
const CTPhieuTraHang = mongoose.models.CTPhieuTraHang || mongoose.model("CTPhieuTraHang", CTPhieuTraHangSchema);
const PhieuKiemKho = mongoose.models.PhieuKiemKho || mongoose.model("PhieuKiemKho", PhieuKiemKhoSchema);
const CTPhieuKiemKho = mongoose.models.CTPhieuKiemKho || mongoose.model("CTPhieuKiemKho", CTPhieuKiemKhoSchema);
const SoQuy = mongoose.models.SoQuy || mongoose.model("SoQuy", SoQuySchema);
const PhieuThuChi = mongoose.models.PhieuThuChi || mongoose.model("PhieuThuChi", PhieuThuChiSchema);
const CongNoKhachHang = mongoose.models.CongNoKhachHang || mongoose.model("CongNoKhachHang", CongNoKhachHangSchema);
const CongNoNhaCungCap = mongoose.models.CongNoNhaCungCap || mongoose.model("CongNoNhaCungCap", CongNoNhaCungCapSchema);
const LichSuKho = mongoose.models.LichSuKho || mongoose.model("LichSuKho", LichSuKhoSchema);
const PhieuXuatNoiBo = mongoose.models.PhieuXuatNoiBo || mongoose.model("PhieuXuatNoiBo", PhieuXuatNoiBoSchema);
const CTXuatNoiBo = mongoose.models.CTXuatNoiBo || mongoose.model("CTXuatNoiBo", CTXuatNoiBoSchema);

module.exports = {
  CuaHang, ChiNhanh, NguoiDung,
  NhomKhachHang, KhachHang, DiaChiKhachHang, NhaCungCap,
  NhomHang, DonViTinh, ThuongHieu, ViTri, HangHoa,
  ThuocTinhHang, GiaTriThuocTinh, HangHoaThuocTinh,
  BangGia, CTBangGia, TonKho,
  PhieuNhap, CTPhieuNhap, HoaDonDauVao, PhieuTraHangNhap, CTPhieuTraHangNhap,
  DonHang, CTDonHang,
  HoaDonBanHang, CTHoaDonBanHang, DoiTacGiaoHang, VanDon,
  PhieuTraHang, CTPhieuTraHang,
  PhieuKiemKho, CTPhieuKiemKho,
  SoQuy, PhieuThuChi,
  CongNoKhachHang, CongNoNhaCungCap, LichSuKho,
  PhieuXuatNoiBo, CTXuatNoiBo
};
