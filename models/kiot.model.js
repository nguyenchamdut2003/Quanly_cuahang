var db = require('./db.model');
const mongoose = db.mongoose;
const Schema = mongoose.Schema;
const ObjectId = Schema.Types.ObjectId;

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
  trang_thai: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active'
  }
}, {
  collection: 'cua_hang',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

const HangHoaThuocTinhSchema = new Schema({
  hang_hoa_id: { type: ObjectId, ref: 'HangHoa' },
  thuoc_tinh_id: { type: ObjectId, ref: 'ThuocTinhHang' },
  gia_tri_id: { type: ObjectId, ref: 'GiaTriThuocTinh' }
}, { collection: "hang_hoa_thuoc_tinh" });

const NguoiDungSchema = new Schema({
  cua_hang_id: { type: ObjectId, ref: 'CuaHang' },
  google_id: { type: String, unique: true, sparse: true },
  email: { type: String, unique: true, required: true },
  ho_ten: { type: String },
  anh_dai_dien: { type: String },
  sdt: { type: String },
  vai_tro: {
    type: String,
    enum: ['admin', 'quan_ly', 'nhan_vien', 'user'],
    default: 'user'
  },
  trang_thai: {
    type: String,
    enum: ['active', 'inactive', 'blocked'],
    default: 'active'
  },
  lan_dang_nhap_cuoi: { type: Date }
}, {
  collection: 'nguoi_dung',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});
const KhoSchema = new Schema({
  cua_hang_id: { type: ObjectId, ref: 'CuaHang' },
  ma_kho: { type: String, unique: true },
  ten_kho: { type: String },
  dia_chi: { type: String },
  trang_thai: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active'
  }
}, {
  collection: 'kho',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});
const NhomKhachHangSchema = new Schema({
  cua_hang_id: { type: ObjectId, ref: 'CuaHang' },
  ten_nhom: { type: String },
  mo_ta: { type: String },
  trang_thai: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active'
  }
}, {
  collection: 'nhom_khach_hang',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});
const KhachHangSchema = new Schema({
  cua_hang_id: { type: ObjectId, ref: 'CuaHang' },
  nhom_khach_hang_id: { type: ObjectId, ref: 'NhomKhachHang' },
  nguoi_tao_id: { type: ObjectId, ref: 'NguoiDung' },

  ma_khach_hang: { type: String, unique: true },

  loai_khach_hang: {
    type: String,
    enum: ['ca_nhan', 'cong_ty'],
    default: 'ca_nhan'
  },

  // Tên hiển thị chung trên danh sách
  ten_khach_hang: { type: String },

  // Nếu là cá nhân
  ten_ca_nhan: { type: String },
  cccd: { type: String },
  so_ho_chieu: { type: String },
  ngay_sinh: { type: Date },
  gioi_tinh: { type: String },

  // Nếu là công ty
  ten_cong_ty: { type: String },
  ma_so_thue: { type: String },
  nguoi_dai_dien: { type: String },
  chuc_vu_nguoi_dai_dien: { type: String },

  // Thông tin liên hệ chung
  sdt: { type: String },
  sdt2: { type: String },
  email: { type: String },
  facebook: { type: String },

  // Ngân hàng
  ngan_hang: { type: String },
  stk_ngan_hang: { type: String },
  chu_tai_khoan: { type: String },

  // Công nợ, doanh số
  tong_no: { type: Number, default: 0 }, // khách đang nợ cửa hàng
  tong_ban: { type: Number, default: 0 },

  khu_vuc_giao_hang: { type: String },

  ghi_chu: { type: String },

  trang_thai: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active'
  }
}, {
  collection: 'khach_hang',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});
const DiaChiKhachHangSchema = new Schema({
  khach_hang_id: { type: ObjectId, ref: 'KhachHang' },
  ma_dia_chi: { type: String, unique: true },
  ten_nguoi_nhan: { type: String },
  sdt_nguoi_nhan: { type: String },
  so_nha: { type: String },
  dia_chi_day_du: { type: String },
  tinh_thanh: { type: String },
  quan_huyen: { type: String },
  phuong_xa: { type: String },
  loai_dia_chi: { type: String, },
  ghi_chu: { type: String },
  mac_dinh: { type: Boolean, default: false }
}, {
  collection: 'dia_chi_khach_hang',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});
const LoaiDiaChiKhachHangSchema = new Schema({
  ma_loai: { type: String, unique: true },
  ten_loai: { type: String, unique: true },
  trang_thai: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active'
  }
}, {
  collection: 'loai_dia_chi_khach_hang',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});
const NhomNhaCungCapSchema = new Schema({
  cua_hang_id: { type: ObjectId, ref: 'CuaHang' },
  ma_nhom_ncc: { type: String, unique: true },
  ten_nhom_ncc: { type: String },
  mo_ta: { type: String },
  trang_thai: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active'
  }
}, {
  collection: 'nhom_nha_cung_cap',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});
const NhaCungCapSchema = new Schema({
  cua_hang_id: { type: ObjectId, ref: 'CuaHang' },
  nhom_nha_cung_cap_id: { type: ObjectId, ref: 'NhomNhaCungCap' },
  nguoi_tao_id: { type: ObjectId, ref: 'NguoiDung' },
  ma_ncc: { type: String, unique: true },
  ten_ncc: { type: String },
  sdt: { type: String },
  email: { type: String },
  ghi_chu: { type: String },
  ten_cong_ty: { type: String },
  ma_so_thue: { type: String },
  // Cửa hàng đang nợ nhà cung cấp
  tong_no: { type: Number, default: 0 },
  tong_mua: { type: Number, default: 0 },
  trang_thai: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active'
  }
}, {
  collection: 'nha_cung_cap',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});
const DiaChiNccSchema = new Schema({
  nha_cung_cap_id: { type: ObjectId, ref: 'NhaCungCap' },
  ma_dia_chi: { type: String, unique: true },
  ten_nguoi_nhan: { type: String },
  sdt_nguoi_nhan: { type: String },
  so_nha: { type: String },
  dia_chi_day_du: { type: String },
  tinh_thanh: { type: String },
  quan_huyen: { type: String },
  phuong_xa: { type: String },
  loai_dia_chi: { type: String, },
  ghi_chu: { type: String },
  mac_dinh: { type: Boolean, default: false }
}, {
  collection: 'dia_chi_ncc',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});
const DoiTacGiaoHangSchema = new Schema({
  cua_hang_id: { type: ObjectId, ref: 'CuaHang' },
  ma_doi_tac: { type: String, unique: true },
  ten_doi_tac: { type: String, required: true },
  sdt: { type: String },
  email: { type: String },
  dia_chi: { type: String },
  ghi_chu: { type: String },
  trang_thai: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active'
  }
}, {
  collection: 'doi_tac_giao_hang',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});
const BangGiaVanChuyenSchema = new Schema({
  doi_tac_giao_hang_id: { type: ObjectId, ref: 'DoiTacGiaoHang' },
  cua_hang_id: { type: ObjectId, ref: 'CuaHang' },
  ten_bang_gia: { type: String },
  loai_tinh_phi: {
    type: String,
    enum: ['theo_km', 'co_dinh', 'theo_tuyen'],
    default: 'theo_km'
  },
  diem_di: { type: String },
  diem_den: { type: String },
  khoang_cach_km: { type: Number, default: 0 },
  don_gia_km: { type: Number, default: 0 },
  phi_co_dinh: { type: Number, default: 0 },
  phi_toi_thieu: { type: Number, default: 0 },
  trang_thai: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active'
  }
}, {
  collection: 'bang_gia_van_chuyen',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});
const NhomHangSchema = new Schema({
  cua_hang_id: { type: ObjectId, ref: 'CuaHang' },

  ma_nhom_hang: { type: String, unique: true, sparse: true },
  ten_nhom_hang: { type: String, required: true },

  mo_ta: { type: String },

  trang_thai: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active'
  }
}, {
  collection: 'nhom_hang',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});
const DonViTinhSchema = new Schema({
  cua_hang_id: { type: ObjectId, ref: 'CuaHang' },

  ma_don_vi: { type: String, unique: true, sparse: true },
  ten_don_vi: { type: String, required: true },

  trang_thai: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active'
  }
}, {
  collection: 'don_vi_tinh',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});
const ThuongHieuSchema = new Schema({
  ten_thuong_hieu: { type: String },
  mo_ta: { type: String },
  cua_hang_id: { type: ObjectId, ref: 'CuaHang' }
}, { collection: "thuong_hieu" });
const HangHoaSchema = new Schema({
  cua_hang_id: { type: ObjectId, ref: 'CuaHang' },
  nhom_hang_id: { type: ObjectId, ref: 'NhomHang' },
  thuong_hieu_id: { type: ObjectId, ref: 'ThuongHieu' },
  don_vi_tinh_id: { type: ObjectId, ref: 'DonViTinh' },
  nha_cung_cap_id: { type: ObjectId, ref: 'NhaCungCap' },
  nguoi_tao_id: { type: ObjectId, ref: 'NguoiDung' },

  ma_hang: { type: String, unique: true, sparse: true },
  ten_hang: { type: String, required: true },

  mo_ta: { type: String },

  gia_von: {
    type: Number,
    default: 0
  },

  gia_nhap_cuoi: {
    type: Number,
    default: 0
  },

  loai_gia: {
    type: String,
    enum: ['thi_truong', 'co_dinh'],
    default: 'thi_truong'
  },

  gia_co_dinh: {
    type: Number,
    default: 0
  },

  ban_truc_tiep: {
    type: Boolean,
    default: true
  },

  quan_ly_theo_lo: {
    type: Boolean,
    default: false
  },

  anh_san_pham: {
    type: String
  },

  trang_thai: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active'
  }
}, {
  collection: 'hang_hoa',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});
const TonKhoSchema = new Schema({
  cua_hang_id: { type: ObjectId, ref: 'CuaHang' },
  kho_id: { type: ObjectId, ref: 'Kho', required: true },
  hang_hoa_id: { type: ObjectId, ref: 'HangHoa', required: true },

  so_luong: {
    type: Number,
    default: 0
  }
}, {
  collection: 'ton_kho',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});
TonKhoSchema.index(
  { kho_id: 1, hang_hoa_id: 1 },
  { unique: true }
);
const BangGiaSchema = new Schema({
  cua_hang_id: { type: ObjectId, ref: 'CuaHang' },
  nguoi_tao_id: { type: ObjectId, ref: 'NguoiDung' },

  ma_bang_gia: { type: String, unique: true, sparse: true },
  ten_bang_gia: { type: String, required: true },

  ngay_bat_dau: { type: Date },
  ngay_ket_thuc: { type: Date },

  trang_thai: {
    type: String,
    enum: ['active', 'inactive', 'draft'],
    default: 'active'
  },

  nguon_gia: {
    type: String,
    enum: ['nhap_tay', 'gia_von', 'gia_nhap_cuoi', 'bang_gia_khac'],
    default: 'nhap_tay'
  },

  bang_gia_goc_id: {
    type: ObjectId,
    ref: 'BangGia'
  },

  phep_tinh: {
    type: String,
    enum: ['cong', 'tru']
  },

  kieu_dieu_chinh: {
    type: String,
    enum: ['vnd', 'phan_tram']
  },

  gia_tri_dieu_chinh: {
    type: Number,
    default: 0
  },

  cho_phep_hang_ngoai_bang_gia: {
    type: Boolean,
    default: true
  },

  canh_bao_hang_ngoai_bang_gia: {
    type: Boolean,
    default: false
  },

  ghi_chu: { type: String }
}, {
  collection: 'bang_gia',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});
const CtBangGiaSchema = new Schema({
  bang_gia_id: {
    type: ObjectId,
    ref: 'BangGia',
    required: true
  },

  hang_hoa_id: {
    type: ObjectId,
    ref: 'HangHoa',
    required: true
  },

  gia_goc: {
    type: Number,
    default: 0
  },

  gia_ban: {
    type: Number,
    default: 0
  }
}, {
  collection: 'ct_bang_gia',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});
CtBangGiaSchema.index(
  { bang_gia_id: 1, hang_hoa_id: 1 },
  { unique: true }
);
const PhieuNhapSchema = new Schema({
  cua_hang_id: {
    type: ObjectId,
    ref: 'CuaHang',
    required: true
  },

  kho_id: {
    type: ObjectId,
    ref: 'Kho',
    required: true
  },

  nha_cung_cap_id: {
    type: ObjectId,
    ref: 'NhaCungCap'
  },

  nguoi_tao_id: {
    type: ObjectId,
    ref: 'NguoiDung'
  },

  ma_phieu_nhap: {
    type: String,
    unique: true,
    sparse: true
  },

  ngay_nhap: {
    type: Date,
    default: Date.now
  },

  tong_tien_hang: {
    type: Number,
    default: 0
  },

  giam_gia: {
    type: Number,
    default: 0
  },

  kieu_giam_gia: {
    type: String,
    enum: ['vnd', 'percent'],
    default: 'vnd'
  },

  tong_tien: {
    type: Number,
    default: 0
  },

  can_tra_ncc: {
    type: Number,
    default: 0
  },

  da_tra_ncc: {
    type: Number,
    default: 0
  },

  con_no_ncc: {
    type: Number,
    default: 0
  },

  phuong_thuc_thanh_toan: {
    type: String,
    enum: ['tien_mat', 'chuyen_khoan', 'cong_no'],
    default: 'cong_no'
  },

  trang_thai: {
    type: String,
    enum: ['draft', 'completed', 'cancelled'],
    default: 'draft'
  },

  ghi_chu: {
    type: String
  }
}, {
  collection: 'phieu_nhap',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});
const CtPhieuNhapSchema = new Schema({
  phieu_nhap_id: {
    type: ObjectId,
    ref: 'PhieuNhap',
    required: true
  },
  lo_hang_id: {
    type: ObjectId,
    ref: 'LoHang'
  },
  hang_hoa_id: {
    type: ObjectId,
    ref: 'HangHoa',
    required: true
  },

  don_vi_tinh_id: {
    type: ObjectId,
    ref: 'DonViTinh'
  },

  so_luong: {
    type: Number,
    default: 0,
    min: 0
  },

  don_gia_nhap: {
    type: Number,
    default: 0,
    min: 0
  },

  giam_gia_dong: {
    type: Number,
    default: 0,
    min: 0
  },

  kieu_giam_gia_dong: {
    type: String,
    enum: ['vnd', 'percent'],
    default: 'vnd'
  },

  thanh_tien: {
    type: Number,
    default: 0
  },

  ghi_chu: {
    type: String
  }
}, {
  collection: 'ct_phieu_nhap',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});
CtPhieuNhapSchema.index(
  { phieu_nhap_id: 1, hang_hoa_id: 1 }
);
const PhieuTraHangNhapSchema = new Schema({
  cua_hang_id: { type: ObjectId, ref: 'CuaHang', required: true },
  kho_id: { type: ObjectId, ref: 'Kho' },
  ma_phieu_tra_nhap: { type: String, unique: true, sparse: true },
  ngay_tra: { type: Date, default: Date.now },
  nha_cung_cap_id: { type: ObjectId, ref: 'NhaCungCap' },
  phieu_nhap_id: { type: ObjectId, ref: 'PhieuNhap' },
  tong_tien_hang: { type: Number, default: 0 },
  giam_gia: { type: Number, default: 0 },
  kieu_giam_gia: { type: String, enum: ['vnd', 'percent'], default: 'vnd' },
  ncc_can_tra: { type: Number, default: 0 },
  ncc_da_tra: { type: Number, default: 0 },
  tinh_vao_cong_no: { type: Boolean, default: true },
  tong_tien_tra: { type: Number, default: 0 },
  trang_thai: { type: String, enum: ['draft', 'completed', 'cancelled'], default: 'completed' },
  ly_do: { type: String },
  ghi_chu: { type: String },
  nguoi_tra_id: { type: ObjectId, ref: 'NguoiDung' },
  nguoi_tao_id: { type: ObjectId, ref: 'NguoiDung' }
}, {
  collection: 'phieu_tra_hang_nhap',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});
const CtPhieuTraHangNhapSchema = new Schema({
  phieu_tra_nhap_id: { type: ObjectId, ref: 'PhieuTraHangNhap', required: true },
  phieu_nhap_id: { type: ObjectId, ref: 'PhieuNhap' },
  ct_phieu_nhap_id: { type: ObjectId, ref: 'CTPhieuNhap' },
  hang_hoa_id: { type: ObjectId, ref: 'HangHoa', required: true },
  lo_hang_id: { type: ObjectId, ref: 'LoHang' },
  don_vi_tinh_id: { type: ObjectId, ref: 'DonViTinh' },
  so_luong: { type: Number, default: 0 },
  don_gia: { type: Number, default: 0 },
  gia_nhap: { type: Number, default: 0 },
  gia_tra_lai: { type: Number, default: 0 },
  ghi_chu: { type: String },
  thanh_tien: { type: Number, default: 0 }
}, {
  collection: 'ct_phieu_tra_hang_nhap',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});
const LichSuKhoSchema = new Schema({
  cua_hang_id: {
    type: ObjectId,
    ref: 'CuaHang',
    required: true
  },

  chi_nhanh_id: {
    type: ObjectId,
    ref: 'ChiNhanh'
  },

  kho_id: {
    type: ObjectId,
    ref: 'Kho',
    required: true
  },

  hang_hoa_id: {
    type: ObjectId,
    ref: 'HangHoa',
    required: true
  },

  lo_hang_id: {
    type: ObjectId,
    ref: 'LoHang'
  },

  nguoi_tao_id: {
    type: ObjectId,
    ref: 'NguoiDung'
  },

  loai_phieu: {
    type: String,
    enum: ['nhap_hang', 'tra_hang_nhap', 'kiem_kho', 'ban_hang', 'xuat_huy', 'xuat_noi_bo', 'dieu_chinh'],
    required: true
  },

  ma_phieu: {
    type: String
  },

  so_luong_thay_doi: {
    type: Number,
    default: 0
  },

  ton_kho_sau: {
    type: Number,
    default: 0
  },

  gia_tri_thay_doi: {
    type: Number,
    default: 0
  },

  ghi_chu: {
    type: String
  },

  ngay: {
    type: Date,
    default: Date.now
  }
}, {
  collection: 'lich_su_kho',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

LichSuKhoSchema.index({ kho_id: 1, hang_hoa_id: 1, ngay: -1 });

const CongNoNhaCungCapSchema = new Schema({
  cua_hang_id: {
    type: ObjectId,
    ref: 'CuaHang',
    required: true
  },

  nha_cung_cap_id: {
    type: ObjectId,
    ref: 'NhaCungCap',
    required: true
  },

  phieu_nhap_id: {
    type: ObjectId,
    ref: 'PhieuNhap'
  },

  phieu_tra_nhap_id: {
    type: ObjectId,
    ref: 'PhieuTraHangNhap'
  },

  phieu_thu_chi_id: {
    type: ObjectId,
    ref: 'PhieuThuChi'
  },

  so_tien: {
    type: Number,
    default: 0
  },

  loai: {
    type: String,
    enum: ['tang_no', 'giam_no', 'thanh_toan'],
    required: true
  },

  ghi_chu: {
    type: String
  },

  ngay: {
    type: Date,
    default: Date.now
  }
}, {
  collection: 'cong_no_nha_cung_cap',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

CongNoNhaCungCapSchema.index({
  nha_cung_cap_id: 1,
  ngay: -1
});
const LoHangSchema = new Schema({
  cua_hang_id: {
    type: ObjectId,
    ref: 'CuaHang',
    required: true
  },

  kho_id: {
    type: ObjectId,
    ref: 'Kho',
    required: true
  },

  hang_hoa_id: {
    type: ObjectId,
    ref: 'HangHoa',
    required: true
  },

  nha_cung_cap_id: {
    type: ObjectId,
    ref: 'NhaCungCap'
  },

  phieu_nhap_id: {
    type: ObjectId,
    ref: 'PhieuNhap'
  },

  ct_phieu_nhap_id: {
    type: ObjectId,
    ref: 'CtPhieuNhap'
  },

  ma_lo: {
    type: String,
    unique: true,
    sparse: true
  },

  ten_lo: {
    type: String
  },

  ngay_nhap: {
    type: Date,
    default: Date.now
  },

  ngay_san_xuat: {
    type: Date
  },

  ngay_thu_hoach: {
    type: Date
  },

  han_su_dung: {
    type: Date
  },

  so_luong_ban_dau: {
    type: Number,
    default: 0
  },

  so_luong_con_lai: {
    type: Number,
    default: 0
  },

  don_gia_nhap: {
    type: Number,
    default: 0
  },

  gia_von: {
    type: Number,
    default: 0
  },

  trang_thai: {
    type: String,
    enum: ['active', 'het_hang', 'huy'],
    default: 'active'
  },

  ghi_chu: {
    type: String
  }
}, {
  collection: 'lo_hang',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});
LoHangSchema.index({
  kho_id: 1,
  hang_hoa_id: 1,
  ngay_nhap: -1
});
const TonKhoLoSchema = new Schema({
  cua_hang_id: {
    type: ObjectId,
    ref: 'CuaHang',
    required: true
  },

  kho_id: {
    type: ObjectId,
    ref: 'Kho',
    required: true
  },

  hang_hoa_id: {
    type: ObjectId,
    ref: 'HangHoa',
    required: true
  },

  lo_hang_id: {
    type: ObjectId,
    ref: 'LoHang',
    required: true
  },

  so_luong: {
    type: Number,
    default: 0
  },

  gia_von: {
    type: Number,
    default: 0
  }
}, {
  collection: 'ton_kho_lo',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

TonKhoLoSchema.index(
  { kho_id: 1, hang_hoa_id: 1, lo_hang_id: 1 },
  { unique: true }
);

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

// DON_HANG
const DonHangSchema = new Schema({
  ma_don_hang: { type: String, unique: true },
  bang_gia_id: { type: ObjectId, ref: 'BangGia' },
  ngay_dat: { type: Date, default: Date.now },
  ngay_tao: { type: Date, default: Date.now },
  tong_tien: { type: Number, default: 0 },
  tong_tien_hang: { type: Number },
  giam_gia: { type: Number, default: 0 },
  kieu_giam_gia: { type: String, enum: ['vnd', 'phan_tram'], default: 'vnd' },
  tong_thanh_toan: { type: Number },
  khach_can_tra: { type: Number, default: 0 },
  khach_thanh_toan: { type: Number, default: 0 },
  tien_thua_tra_khach: { type: Number, default: 0 },
  cod_enabled: { type: Boolean, default: false },
  cod_amount: { type: Number, default: 0 },
  trang_thai: { type: String },
  trang_thai_giao_hang: { type: String, enum: ['chua_giao', 'giao_mot_phan', 'giao_thieu', 'giao_du'], default: 'chua_giao' },
  ngay_giao_thuc_te: { type: Date },
  ghi_chu: { type: String },
  cua_hang_id: { type: ObjectId, ref: 'CuaHang' },
  chi_nhanh_id: { type: ObjectId, ref: 'ChiNhanh' },
  kho_id: { type: ObjectId, ref: 'Kho' },
  khach_hang_id: { type: ObjectId, ref: 'KhachHang' },
  nguoi_tao_id: { type: ObjectId, ref: 'NguoiDung' }
}, { collection: "don_hang", timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

// CT_DON_HANG
const CTDonHangSchema = new Schema({
  don_hang_id: { type: ObjectId, ref: 'DonHang' },
  hang_hoa_id: { type: ObjectId, ref: 'HangHoa' },
  so_luong: { type: Number },
  so_luong_dat: { type: Number, default: 0 },
  so_luong_xac_nhan: { type: Number, default: 0 },
  so_luong_da_giao: { type: Number, default: 0 },
  so_luong_con_thieu: { type: Number, default: 0 },
  trang_thai_giao: { type: String, enum: ['chua_giao', 'giao_thieu', 'giao_du'], default: 'chua_giao' },
  lo_hang_id: { type: ObjectId, ref: 'LoHang' },
  don_gia_ban: { type: Number },
  chiet_khau: { type: Number },
  kieu_chiet_khau: { type: String, enum: ['vnd', 'phan_tram'], default: 'vnd' },
  thanh_tien: { type: Number }
}, { collection: "ct_don_hang" });
CTDonHangSchema.index(
  { don_hang_id: 1, hang_hoa_id: 1 }
);

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
  kho_id: { type: ObjectId, ref: 'Kho' },
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

// VAN_DON
const VanDonSchema = new Schema({
  ma_van_don: { type: String, unique: true },
  don_hang_id: { type: ObjectId, ref: 'DonHang' },
  hoa_don_id: { type: ObjectId, ref: 'HoaDonBanHang' },
  doi_tac_giao_hang_id: { type: ObjectId, ref: 'DoiTacGiaoHang' },
  cua_hang_id: { type: ObjectId, ref: 'CuaHang' },
  khach_hang_id: { type: ObjectId, ref: 'KhachHang' },
  dia_chi_khach_hang_id: { type: ObjectId, ref: 'DiaChiKhachHang' },
  ten_nguoi_nhan: { type: String },
  sdt_nguoi_nhan: { type: String },
  dia_chi_nhan: { type: String },
  phi_giao_hang: { type: Number, default: 0 },
  don_gia_van_chuyen_ap_dung: { type: Number, default: 0 },
  so_luong_tinh_phi: { type: Number, default: 1 },
  thanh_tien_van_chuyen: { type: Number, default: 0 },
  nguoi_tra_phi_giao_hang: { type: String, enum: ['khach', 'cua_hang'], default: 'khach' },
  cod_enabled: { type: Boolean, default: false },
  cod_amount: { type: Number, default: 0 },
  trang_thai_cod: { type: String, enum: ['khong_cod', 'chua_thu', 'da_thu', 'da_doi_soat'], default: 'khong_cod' },
  trang_thai: { type: String, enum: ['draft', 'shipping', 'completed', 'cancelled'], default: 'draft' },
  ghi_chu: { type: String }
}, { collection: "van_don", timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });
VanDonSchema.index(
  { don_hang_id: 1 }
);
VanDonSchema.index(
  { doi_tac_giao_hang_id: 1, trang_thai: 1 }
);

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
  kho_id: { type: ObjectId, ref: 'Kho' },
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
  tong_gia_tri_lech: { type: Number, default: 0 },
  trang_thai: { type: String, enum: ['pending', 'completed'], default: 'completed' },
  ghi_chu: { type: String },
  cua_hang_id: { type: ObjectId, ref: 'CuaHang' },
  chi_nhanh_id: { type: ObjectId, ref: 'ChiNhanh' },
  kho_id: { type: ObjectId, ref: 'Kho' },
  nguoi_tao_id: { type: ObjectId, ref: 'NguoiDung' }
}, { collection: "phieu_kiem_kho", timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

// CT_PHIEU_KIEM_KHO
const CTPhieuKiemKhoSchema = new Schema({
  phieu_kiem_kho_id: { type: ObjectId, ref: 'PhieuKiemKho' },
  hang_hoa_id: { type: ObjectId, ref: 'HangHoa' },
  lo_hang_id: { type: ObjectId, ref: 'LoHang' },
  ton_kho_he_thong: { type: Number },
  so_luong_thuc_te: { type: Number },
  so_luong_lech: { type: Number },
  gia_tri_lech: { type: Number },
  nguyen_nhan_lech: { type: String }
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

// PHIEU_XUAT_NOI_BO (feature supplement - not in core ref schema)
const PhieuXuatNoiBoSchema = new Schema({
  ma_xuat_noi_bo: { type: String, unique: true },
  ngay_xuat: { type: Date, default: Date.now },
  loai_xuat: { type: String },
  cua_hang_id: { type: ObjectId, ref: 'CuaHang' },
  kho_id: { type: ObjectId, ref: 'Kho' },
  nguoi_tao_id: { type: ObjectId, ref: 'NguoiDung' },
  nguoi_nhan: { type: String },
  loai_nguoi_nhan: { type: String, enum: ['nhan_vien', 'khach_hang', 'nha_cung_cap', 'khac'], default: 'khac' },
  tong_so_luong: { type: Number, default: 0 },
  tong_gia_tri: { type: Number, default: 0 },
  cong_don_vao_the: { type: Boolean, default: false },
  trang_thai: { type: String, enum: ['draft', 'completed', 'cancelled'], default: 'draft' },
  ghi_chu: { type: String }
}, { collection: "phieu_xuat_noi_bo", timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

const CTXuatNoiBoSchema = new Schema({
  phieu_xuat_id: { type: ObjectId, ref: 'PhieuXuatNoiBo' },
  hang_hoa_id: { type: ObjectId, ref: 'HangHoa' },
  lo_hang_id: { type: ObjectId, ref: 'LoHang' },
  so_luong: { type: Number },
  gia_von: { type: Number },
  thanh_tien: { type: Number }
}, { collection: "ct_xuat_noi_bo" });

// PHIEU_XUAT_HUY
const PhieuXuatHuySchema = new Schema({
  ma_xuat_huy: { type: String, unique: true },
  ngay_xuat: { type: Date, default: Date.now },
  cua_hang_id: { type: ObjectId, ref: 'CuaHang' },
  chi_nhanh_id: { type: ObjectId, ref: 'ChiNhanh' },
  kho_id: { type: ObjectId, ref: 'Kho' },
  nguoi_tao_id: { type: ObjectId, ref: 'NguoiDung' },
  ly_do_huy: { type: String, required: true },
  tong_so_luong: { type: Number, default: 0 },
  tong_gia_tri: { type: Number, default: 0 },
  trang_thai: { type: String, enum: ['draft', 'completed', 'cancelled'], default: 'draft' },
  ghi_chu: { type: String }
}, { collection: "phieu_xuat_huy", timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

const CTXuatHuySchema = new Schema({
  phieu_xuat_huy_id: { type: ObjectId, ref: 'PhieuXuatHuy' },
  hang_hoa_id: { type: ObjectId, ref: 'HangHoa' },
  lo_hang_id: { type: ObjectId, ref: 'LoHang' },
  so_luong: { type: Number },
  gia_von: { type: Number },
  thanh_tien: { type: Number }
}, { collection: "ct_xuat_huy" });

// PHAN_BO_HANG
const PhanBoHangSchema = new Schema({
  ma_phan_bo: { type: String, unique: true },
  cua_hang_id: { type: ObjectId, ref: 'CuaHang' },
  chi_nhanh_id: { type: ObjectId, ref: 'ChiNhanh' },
  kho_id: { type: ObjectId, ref: 'Kho' },
  khach_hang_id: { type: ObjectId, ref: 'KhachHang' },
  don_hang_id: { type: ObjectId, ref: 'DonHang' },
  nguoi_tao_id: { type: ObjectId, ref: 'NguoiDung' },
  nguoi_phan_bo_id: { type: ObjectId, ref: 'NguoiDung' },
  tong_so_luong: { type: Number, default: 0 },
  tong_tien_hang: { type: Number, default: 0 },
  tong_thanh_tien: { type: Number, default: 0 },
  trang_thai: { type: String, enum: ['draft', 'confirmed', 'cancelled'], default: 'draft' },
  ngay_xac_nhan: { type: Date },
  ghi_chu: { type: String }
}, { collection: "phan_bo_hang", timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

const CTPhanBoHangSchema = new Schema({
  phan_bo_hang_id: { type: ObjectId, ref: 'PhanBoHang' },
  ct_don_hang_id: { type: ObjectId, ref: 'CTDonHang' },
  hang_hoa_id: { type: ObjectId, ref: 'HangHoa' },
  lo_hang_id: { type: ObjectId, ref: 'LoHang' },
  so_luong: { type: Number, default: 0 },
  don_gia_ban: { type: Number, default: 0 },
  chiet_khau: { type: Number, default: 0 },
  kieu_chiet_khau: { type: String, enum: ['vnd', 'phan_tram'], default: 'vnd' },
  thanh_tien: { type: Number, default: 0 },
  so_luong_xuat_thuc_te: { type: Number, default: 0 },
  ghi_chu: { type: String }
}, { collection: "ct_phan_bo_hang" });
CTPhanBoHangSchema.index(
  { phan_bo_hang_id: 1, ct_don_hang_id: 1, lo_hang_id: 1 }
);
const PhiVanChuyenKhachHangSchema = new Schema({
  cua_hang_id: { type: ObjectId, ref: 'CuaHang' },

  khach_hang_id: { type: ObjectId, ref: 'KhachHang', required: true },
  dia_chi_khach_hang_id: { type: ObjectId, ref: 'DiaChiKhachHang', required: true },
  doi_tac_giao_hang_id: { type: ObjectId, ref: 'DoiTacGiaoHang', required: true },

  phi_van_chuyen: { type: Number, default: 0 },

  ghi_chu: { type: String },

  trang_thai: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active'
  }
}, {
  collection: 'phi_van_chuyen_khach_hang',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

PhiVanChuyenKhachHangSchema.index(
  {
    khach_hang_id: 1,
    dia_chi_khach_hang_id: 1,
    doi_tac_giao_hang_id: 1
  },
  { unique: true }
);
// Register models
const CuaHang = mongoose.models.CuaHang || mongoose.model("CuaHang", CuaHangSchema);
const Kho = mongoose.models.Kho || mongoose.model("Kho", KhoSchema);
const NguoiDung = mongoose.models.NguoiDung || mongoose.model("NguoiDung", NguoiDungSchema);
const NhomKhachHang = mongoose.models.NhomKhachHang || mongoose.model("NhomKhachHang", NhomKhachHangSchema);
const KhachHang = mongoose.models.KhachHang || mongoose.model("KhachHang", KhachHangSchema);
const DiaChiKhachHang = mongoose.models.DiaChiKhachHang || mongoose.model("DiaChiKhachHang", DiaChiKhachHangSchema);
const LoaiDiaChiKhachHang = mongoose.models.LoaiDiaChiKhachHang || mongoose.model("LoaiDiaChiKhachHang", LoaiDiaChiKhachHangSchema);
const NhomNhaCungCap = mongoose.models.NhomNhaCungCap || mongoose.model("NhomNhaCungCap", NhomNhaCungCapSchema);
const DiaChiDoiTuong = mongoose.models.DiaChiDoiTuong || mongoose.model("DiaChiDoiTuong", DiaChiNccSchema);
const DiaChiNcc = mongoose.models.DiaChiNcc || mongoose.model("DiaChiNcc", DiaChiNccSchema);
const NhaCungCap = mongoose.models.NhaCungCap || mongoose.model("NhaCungCap", NhaCungCapSchema);
const NhomHang = mongoose.models.NhomHang || mongoose.model("NhomHang", NhomHangSchema);
const DonViTinh = mongoose.models.DonViTinh || mongoose.model("DonViTinh", DonViTinhSchema);
const HangHoa = mongoose.models.HangHoa || mongoose.model("HangHoa", HangHoaSchema);
const BangGia = mongoose.models.BangGia || mongoose.model("BangGia", BangGiaSchema);
const CTBangGia = mongoose.models.CTBangGia || mongoose.model("CTBangGia", CtBangGiaSchema);
const TonKho = mongoose.models.TonKho || mongoose.model("TonKho", TonKhoSchema);
const LoHang = mongoose.models.LoHang || mongoose.model("LoHang", LoHangSchema);
const TonKhoLo = mongoose.models.TonKhoLo || mongoose.model("TonKhoLo", TonKhoLoSchema);
const PhieuNhap = mongoose.models.PhieuNhap || mongoose.model("PhieuNhap", PhieuNhapSchema);
const CTPhieuNhap = mongoose.models.CTPhieuNhap || mongoose.model("CTPhieuNhap", CtPhieuNhapSchema);
const HoaDonDauVao = mongoose.models.HoaDonDauVao || mongoose.model("HoaDonDauVao", HoaDonDauVaoSchema);
const PhieuTraHangNhap = mongoose.models.PhieuTraHangNhap || mongoose.model("PhieuTraHangNhap", PhieuTraHangNhapSchema);
const CTPhieuTraHangNhap = mongoose.models.CTPhieuTraHangNhap || mongoose.model("CTPhieuTraHangNhap", CtPhieuTraHangNhapSchema);
const DonHang = mongoose.models.DonHang || mongoose.model("DonHang", DonHangSchema);
const CTDonHang = mongoose.models.CTDonHang || mongoose.model("CTDonHang", CTDonHangSchema);
const HoaDonBanHang = mongoose.models.HoaDonBanHang || mongoose.model("HoaDonBanHang", HoaDonBanHangSchema);
const CTHoaDonBanHang = mongoose.models.CTHoaDonBanHang || mongoose.model("CTHoaDonBanHang", CTHoaDonBanHangSchema);
const DoiTacGiaoHang = mongoose.models.DoiTacGiaoHang || mongoose.model("DoiTacGiaoHang", DoiTacGiaoHangSchema);
const BangGiaVanChuyen = mongoose.models.BangGiaVanChuyen || mongoose.model("BangGiaVanChuyen", BangGiaVanChuyenSchema);
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
const PhieuXuatHuy = mongoose.models.PhieuXuatHuy || mongoose.model("PhieuXuatHuy", PhieuXuatHuySchema);
const CTXuatHuy = mongoose.models.CTXuatHuy || mongoose.model("CTXuatHuy", CTXuatHuySchema);
const PhanBoHang = mongoose.models.PhanBoHang || mongoose.model("PhanBoHang", PhanBoHangSchema);
const CTPhanBoHang = mongoose.models.CTPhanBoHang || mongoose.model("CTPhanBoHang", CTPhanBoHangSchema);
const PhiVanChuyenKhachHang = mongoose.models.PhiVanChuyenKhachHang || mongoose.model("PhiVanChuyenKhachHang", PhiVanChuyenKhachHangSchema);
module.exports = {
  CuaHang, Kho, NguoiDung,
  NhomKhachHang, KhachHang, DiaChiKhachHang, LoaiDiaChiKhachHang, 
  NhomNhaCungCap, DiaChiDoiTuong, DiaChiNcc, NhaCungCap,
  NhomHang, DonViTinh, HangHoa,
  BangGia, CTBangGia, TonKho, LoHang, TonKhoLo,
  PhieuNhap, CTPhieuNhap, HoaDonDauVao, PhieuTraHangNhap, CTPhieuTraHangNhap,
  DonHang, CTDonHang,
  HoaDonBanHang, CTHoaDonBanHang, DoiTacGiaoHang, BangGiaVanChuyen, VanDon,
  PhieuTraHang, CTPhieuTraHang,
  PhieuKiemKho, CTPhieuKiemKho,
  SoQuy, PhieuThuChi,
  CongNoKhachHang, CongNoNhaCungCap, LichSuKho,
  PhieuXuatNoiBo, CTXuatNoiBo, PhieuXuatHuy, CTXuatHuy,
  PhanBoHang, CTPhanBoHang,
  PhiVanChuyenKhachHang
};
