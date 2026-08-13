var db = require('./db.model');

const mongoose = db.mongoose;
const Schema = mongoose.Schema;
const ObjectId = Schema.Types.ObjectId;


/**
 * =========================================================
 * 1. PHÒNG BAN
 * =========================================================
 */
const PhongBanSchema = new Schema({
  cua_hang_id: {
    type: ObjectId,
    ref: 'CuaHang',
    required: true
  },

  ma_phong_ban: {
    type: String,
    trim: true,
    uppercase: true
  },

  ten_phong_ban: {
    type: String,
    required: true,
    trim: true
  },

  mo_ta: {
    type: String,
    trim: true
  },

  trang_thai: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active'
  }
}, {
  collection: 'phong_ban',
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  }
});

PhongBanSchema.index(
  {
    cua_hang_id: 1,
    ma_phong_ban: 1
  },
  {
    unique: true,
    sparse: true
  }
);

PhongBanSchema.index({
  cua_hang_id: 1,
  ten_phong_ban: 1
});

PhongBanSchema.index({
  cua_hang_id: 1,
  trang_thai: 1
});


/**
 * =========================================================
 * 2. CHỨC DANH
 * =========================================================
 */
const ChucDanhSchema = new Schema({
  cua_hang_id: {
    type: ObjectId,
    ref: 'CuaHang',
    required: true
  },

  ma_chuc_danh: {
    type: String,
    trim: true,
    uppercase: true
  },

  ten_chuc_danh: {
    type: String,
    required: true,
    trim: true
  },

  mo_ta: {
    type: String,
    trim: true
  },

  trang_thai: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active'
  }
}, {
  collection: 'chuc_danh',
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  }
});

ChucDanhSchema.index(
  {
    cua_hang_id: 1,
    ma_chuc_danh: 1
  },
  {
    unique: true,
    sparse: true
  }
);

ChucDanhSchema.index({
  cua_hang_id: 1,
  ten_chuc_danh: 1
});

ChucDanhSchema.index({
  cua_hang_id: 1,
  trang_thai: 1
});


/**
 * =========================================================
 * 3. NHÂN VIÊN
 * =========================================================
 *
 * Chỉ chứa HỒ SƠ NHÂN VIÊN.
 *
 * Không nhét:
 * - lương
 * - BHXH
 * - BHYT
 * - phụ cấp
 *
 * vào đây.
 */
const NhanVienSchema = new Schema({
  cua_hang_id: {
    type: ObjectId,
    ref: 'CuaHang',
    required: true
  },

  ma_nhan_vien: {
    type: String,
    trim: true,
    uppercase: true
  },

  ten_nhan_vien: {
    type: String,
    required: true,
    trim: true
  },

  anh_dai_dien: {
    type: String,
    trim: true
  },

  sdt: {
    type: String,
    trim: true
  },

  email: {
    type: String,
    trim: true,
    lowercase: true
  },

  cccd: {
    type: String,
    trim: true
  },

  ngay_sinh: {
    type: Date
  },

  gioi_tinh: {
    type: String,
    enum: ['nam', 'nu', 'khac']
  },

  phong_ban_id: {
    type: ObjectId,
    ref: 'PhongBan'
  },

  chuc_danh_id: {
    type: ObjectId,
    ref: 'ChucDanh'
  },

  /**
   * Nếu nhân viên có tài khoản đăng nhập.
   */
  nguoi_dung_id: {
    type: ObjectId,
    ref: 'NguoiDung'
  },

  ngay_bat_dau_lam_viec: {
    type: Date
  },

  ngay_nghi_viec: {
    type: Date
  },

  dia_chi: {
    type: String,
    trim: true
  },

  ghi_chu: {
    type: String,
    trim: true
  },

  trang_thai: {
    type: String,
    enum: [
      'dang_lam_viec',
      'da_nghi'
    ],
    default: 'dang_lam_viec'
  }
}, {
  collection: 'nhan_vien',
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  }
});

NhanVienSchema.index(
  {
    cua_hang_id: 1,
    ma_nhan_vien: 1
  },
  {
    unique: true,
    sparse: true
  }
);

NhanVienSchema.index({
  cua_hang_id: 1,
  ten_nhan_vien: 1
});

NhanVienSchema.index({
  cua_hang_id: 1,
  phong_ban_id: 1
});

NhanVienSchema.index({
  cua_hang_id: 1,
  chuc_danh_id: 1
});

NhanVienSchema.index({
  cua_hang_id: 1,
  trang_thai: 1
});


/**
 * =========================================================
 * 4. DANH MỤC KHOẢN NỘP
 * =========================================================
 *
 * Định nghĩa khoản là gì.
 *
 * Ví dụ:
 *
 * BHXH
 * BHYT
 * BHTN
 * Công đoàn
 * Thuế TNCN
 *
 * KHÔNG lưu tỷ lệ tại đây.
 */
const DanhMucKhoanNopSchema = new Schema({
  cua_hang_id: {
    type: ObjectId,
    ref: 'CuaHang',
    required: true
  },

  ma_khoan: {
    type: String,
    required: true,
    trim: true,
    uppercase: true
  },

  ten_khoan: {
    type: String,
    required: true,
    trim: true
  },

  /**
   * Dùng để gom ngân sách:
   *
   * thue
   * bao_hiem
   * cong_doan
   */
  nhom_khoan: {
    type: String,
    enum: [
      'thue',
      'bao_hiem',
      'cong_doan',
      'khac'
    ],
    required: true
  },

  /**
   * Khoản cụ thể.
   */
  loai_khoan: {
    type: String,
    enum: [
      'thue_tncn',
      'bhxh',
      'bhyt',
      'bhtn',
      'cong_doan',
      'khac'
    ],
    required: true
  },

  /**
   * Khoản này nộp cho cơ quan nào.
   */
  noi_nop: {
    type: String,
    enum: [
      'co_quan_thue',
      'co_quan_bhxh',
      'lien_doan_lao_dong',
      'khac'
    ],
    required: true
  },

  mo_ta: {
    type: String,
    trim: true
  },

  thu_tu_hien_thi: {
    type: Number,
    default: 0,
    min: 0
  },

  trang_thai: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active'
  }
}, {
  collection: 'danh_muc_khoan_nop',
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  }
});

DanhMucKhoanNopSchema.index(
  {
    cua_hang_id: 1,
    ma_khoan: 1
  },
  {
    unique: true
  }
);

DanhMucKhoanNopSchema.index({
  cua_hang_id: 1,
  nhom_khoan: 1,
  trang_thai: 1
});

DanhMucKhoanNopSchema.index({
  cua_hang_id: 1,
  noi_nop: 1,
  trang_thai: 1
});


/**
 * =========================================================
 * 5. CHÍNH SÁCH KHOẢN NỘP
 * =========================================================
 *
 * Một bộ chính sách.
 *
 * Ví dụ:
 *
 * Chính sách mặc định 2026
 */
const ChinhSachKhoanNopSchema = new Schema({
  cua_hang_id: {
    type: ObjectId,
    ref: 'CuaHang',
    required: true
  },

  ma_chinh_sach: {
    type: String,
    trim: true,
    uppercase: true
  },

  ten_chinh_sach: {
    type: String,
    required: true,
    trim: true
  },

  la_mac_dinh: {
    type: Boolean,
    default: false
  },

  tu_ngay: {
    type: Date
  },

  den_ngay: {
    type: Date
  },

  mo_ta: {
    type: String,
    trim: true
  },

  trang_thai: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active'
  }
}, {
  collection: 'chinh_sach_khoan_nop',
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  }
});

ChinhSachKhoanNopSchema.index(
  {
    cua_hang_id: 1,
    ma_chinh_sach: 1
  },
  {
    unique: true,
    sparse: true
  }
);

ChinhSachKhoanNopSchema.index({
  cua_hang_id: 1,
  la_mac_dinh: 1,
  trang_thai: 1
});


/**
 * =========================================================
 * 6. CHI TIẾT CHÍNH SÁCH KHOẢN NỘP
 * =========================================================
 *
 * Ví dụ:
 *
 * BHXH | NLĐ | 8%
 * BHXH | DN  | 17.5%
 *
 * BHYT | NLĐ | 1.5%
 * BHYT | DN  | 3%
 */
const ChiTietChinhSachKhoanNopSchema = new Schema({
  chinh_sach_khoan_nop_id: {
    type: ObjectId,
    ref: 'ChinhSachKhoanNop',
    required: true
  },

  danh_muc_khoan_nop_id: {
    type: ObjectId,
    ref: 'DanhMucKhoanNop',
    required: true
  },

  ben_chiu: {
    type: String,
    enum: [
      'nguoi_lao_dong',
      'doanh_nghiep'
    ],
    required: true
  },

  kieu_tinh: {
    type: String,
    enum: [
      'phan_tram',
      'so_tien_co_dinh',
      'nhap_tay'
    ],
    default: 'phan_tram'
  },

  /**
   * Nếu phần trăm:
   *
   * 8    = 8%
   * 1.5  = 1.5%
   * 17.5 = 17.5%
   */
  gia_tri: {
    type: Number,
    default: 0,
    min: 0
  },

  /**
   * Khoản có trừ vào tiền NLĐ nhận không?
   */
  tru_vao_luong: {
    type: Boolean,
    default: false
  },

  /**
   * Khoản có tính vào chi phí DN không?
   */
  tinh_vao_chi_phi_luong: {
    type: Boolean,
    default: false
  },

  ghi_chu: {
    type: String,
    trim: true
  },

  trang_thai: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active'
  }
}, {
  collection: 'chi_tiet_chinh_sach_khoan_nop',
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  }
});

ChiTietChinhSachKhoanNopSchema.index(
  {
    chinh_sach_khoan_nop_id: 1,
    danh_muc_khoan_nop_id: 1,
    ben_chiu: 1
  },
  {
    unique: true
  }
);

ChiTietChinhSachKhoanNopSchema.index({
  chinh_sach_khoan_nop_id: 1,
  trang_thai: 1
});


/**
 * =========================================================
 * 7. CẤU HÌNH LƯƠNG CỬA HÀNG
 * =========================================================
 *
 * Cấu hình MẶC ĐỊNH.
 */
const CauHinhLuongCuaHangSchema = new Schema({
  cua_hang_id: {
    type: ObjectId,
    ref: 'CuaHang',
    required: true
  },

  /**
   * so_ngay_trong_thang:
   * 28 / 29 / 30 / 31
   *
   * ngay_cong_chuan:
   * VD 26
   */
  cach_tinh_ngay_cong_mac_dinh: {
    type: String,
    enum: [
      'so_ngay_trong_thang',
      'ngay_cong_chuan'
    ],
    default: 'ngay_cong_chuan'
  },

  so_ngay_cong_chuan_mac_dinh: {
    type: Number,
    default: 26,
    min: 0
  },

  /**
   * Ví dụ:
   * 1.5
   * 2
   */
  he_so_tang_ca_mac_dinh: {
    type: Number,
    default: 1,
    min: 0
  },

  /**
   * Chính sách BHXH/BHYT/BHTN...
   * mặc định của cửa hàng.
   */
  chinh_sach_khoan_nop_mac_dinh_id: {
    type: ObjectId,
    ref: 'ChinhSachKhoanNop'
  },

  ghi_chu: {
    type: String,
    trim: true
  },

  trang_thai: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active'
  }
}, {
  collection: 'cau_hinh_luong_cua_hang',
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  }
});

CauHinhLuongCuaHangSchema.index(
  {
    cua_hang_id: 1
  },
  {
    unique: true
  }
);


/**
 * =========================================================
 * 8. CẤU HÌNH LƯƠNG NHÂN VIÊN
 * =========================================================
 *
 * Có lịch sử.
 *
 * VD:
 *
 * 01/01 -> 30/06 = 12 triệu
 * 01/07 -> ...    = 15 triệu
 */
const CauHinhLuongNhanVienSchema = new Schema({
  cua_hang_id: {
    type: ObjectId,
    ref: 'CuaHang',
    required: true
  },

  nhan_vien_id: {
    type: ObjectId,
    ref: 'NhanVien',
    required: true
  },

  /**
   * Chỉ dùng lương tháng.
   */
  luong_thang: {
    type: Number,
    required: true,
    min: 0
  },

  /**
   * Cách xác định mẫu số ngày công.
   */
  nguon_cach_tinh_ngay_cong: {
    type: String,
    enum: [
      'mac_dinh',
      'tuy_chinh'
    ],
    default: 'mac_dinh'
  },

  cach_tinh_ngay_cong: {
    type: String,
    enum: [
      'so_ngay_trong_thang',
      'ngay_cong_chuan'
    ]
  },

  so_ngay_cong_chuan: {
    type: Number,
    min: 0
  },

  /**
   * MỨC LƯƠNG TRÍCH ĐÓNG.
   *
   * KHÔNG PHẢI TẠM ỨNG.
   *
   * Đây là số tiền làm cơ sở
   * tính BHXH/BHYT/BHTN...
   */
  muc_luong_trich_dong: {
    type: Number,
    default: 0,
    min: 0
  },

  /**
   * Chính sách khoản nộp.
   */
  nguon_chinh_sach_khoan_nop: {
    type: String,
    enum: [
      'mac_dinh',
      'tuy_chinh'
    ],
    default: 'mac_dinh'
  },

  chinh_sach_khoan_nop_id: {
    type: ObjectId,
    ref: 'ChinhSachKhoanNop'
  },

  /**
   * Hệ số tăng ca.
   */
  nguon_he_so_tang_ca: {
    type: String,
    enum: [
      'mac_dinh',
      'tuy_chinh'
    ],
    default: 'mac_dinh'
  },

  he_so_tang_ca: {
    type: Number,
    min: 0
  },

  tu_ngay: {
    type: Date,
    required: true
  },

  den_ngay: {
    type: Date
  },

  ghi_chu: {
    type: String,
    trim: true
  },

  trang_thai: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active'
  }
}, {
  collection: 'cau_hinh_luong_nhan_vien',
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  }
});

CauHinhLuongNhanVienSchema.index({
  cua_hang_id: 1,
  nhan_vien_id: 1,
  tu_ngay: 1
});

CauHinhLuongNhanVienSchema.index({
  nhan_vien_id: 1,
  trang_thai: 1
});


/**
 * =========================================================
 * 9. DANH MỤC PHỤ CẤP
 * =========================================================
 *
 * Ví dụ:
 *
 * Ăn trưa
 * Điện thoại
 * Xăng xe
 * Trách nhiệm
 *
 * Sau này người dùng có thể thêm loại khác.
 */
const DanhMucPhuCapSchema = new Schema({
  cua_hang_id: {
    type: ObjectId,
    ref: 'CuaHang',
    required: true
  },

  ma_phu_cap: {
    type: String,
    required: true,
    trim: true,
    uppercase: true
  },

  ten_phu_cap: {
    type: String,
    required: true,
    trim: true
  },

  mo_ta: {
    type: String,
    trim: true
  },

  thu_tu_hien_thi: {
    type: Number,
    default: 0,
    min: 0
  },

  trang_thai: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active'
  }
}, {
  collection: 'danh_muc_phu_cap',
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  }
});

DanhMucPhuCapSchema.index(
  {
    cua_hang_id: 1,
    ma_phu_cap: 1
  },
  {
    unique: true
  }
);


/**
 * =========================================================
 * 10. PHỤ CẤP NHÂN VIÊN
 * =========================================================
 *
 * Phụ cấp mặc định của nhân viên.
 *
 * Có lịch sử thời gian.
 */
const PhuCapNhanVienSchema = new Schema({
  cua_hang_id: {
    type: ObjectId,
    ref: 'CuaHang',
    required: true
  },

  nhan_vien_id: {
    type: ObjectId,
    ref: 'NhanVien',
    required: true
  },

  danh_muc_phu_cap_id: {
    type: ObjectId,
    ref: 'DanhMucPhuCap',
    required: true
  },

  so_tien: {
    type: Number,
    default: 0,
    min: 0
  },

  tu_ngay: {
    type: Date,
    required: true
  },

  den_ngay: {
    type: Date
  },

  ghi_chu: {
    type: String,
    trim: true
  },

  trang_thai: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active'
  }
}, {
  collection: 'phu_cap_nhan_vien',
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  }
});

PhuCapNhanVienSchema.index({
  cua_hang_id: 1,
  nhan_vien_id: 1,
  danh_muc_phu_cap_id: 1,
  tu_ngay: 1
});

PhuCapNhanVienSchema.index({
  nhan_vien_id: 1,
  trang_thai: 1
});


/**
 * =========================================================
 * 11. CHẤM CÔNG
 * =========================================================
 *
 * 1 nhân viên + 1 ngày = 1 record.
 *
 * Ca sáng  = 0.5 công.
 * Ca chiều = 0.5 công.
 *
 * tong_cong KHÔNG lưu DB.
 *
 * Backend tính:
 *
 * const tongCong =
 *   (ca_sang ? 0.5 : 0) +
 *   (ca_chieu ? 0.5 : 0);
 */
const ChamCongSchema = new Schema({
  cua_hang_id: {
    type: ObjectId,
    ref: 'CuaHang',
    required: true
  },

  nhan_vien_id: {
    type: ObjectId,
    ref: 'NhanVien',
    required: true
  },

  ngay_cham_cong: {
    type: Date,
    required: true
  },

  ca_sang: {
    type: Boolean,
    default: false
  },

  ca_chieu: {
    type: Boolean,
    default: false
  },

  /**
   * Công tăng ca.
   *
   * VD:
   * 0
   * 0.5
   * 1
   * 1.5
   */
  cong_tang_ca: {
    type: Number,
    default: 0,
    min: 0
  },

  ghi_chu: {
    type: String,
    trim: true
  },

  nguoi_tao_id: {
    type: ObjectId,
    ref: 'NguoiDung'
  },

  nguoi_cap_nhat_id: {
    type: ObjectId,
    ref: 'NguoiDung'
  }
}, {
  collection: 'cham_cong',
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  }
});

ChamCongSchema.index(
  {
    cua_hang_id: 1,
    nhan_vien_id: 1,
    ngay_cham_cong: 1
  },
  {
    unique: true
  }
);

ChamCongSchema.index({
  cua_hang_id: 1,
  ngay_cham_cong: 1
});

ChamCongSchema.index({
  cua_hang_id: 1,
  nhan_vien_id: 1,
  ngay_cham_cong: 1
});


/**
 * =========================================================
 * 12. TẠM ỨNG NHÂN VIÊN
 * =========================================================
 *
 * VD:
 *
 * 05/08 = 1 triệu
 * 15/08 = 2 triệu
 *
 * Tổng tháng = 3 triệu.
 */
const TamUngNhanVienSchema = new Schema({
  cua_hang_id: {
    type: ObjectId,
    ref: 'CuaHang',
    required: true
  },

  nhan_vien_id: {
    type: ObjectId,
    ref: 'NhanVien',
    required: true
  },

  ngay_tam_ung: {
    type: Date,
    required: true
  },

  so_tien: {
    type: Number,
    required: true,
    min: 0
  },

  /**
   * null:
   * chưa được đưa vào bảng lương.
   *
   * Có id:
   * đã được snapshot vào kỳ lương.
   */
  chi_tiet_bang_luong_id: {
    type: ObjectId,
    ref: 'ChiTietBangLuong'
  },

  ghi_chu: {
    type: String,
    trim: true
  },

  nguoi_tao_id: {
    type: ObjectId,
    ref: 'NguoiDung'
  },

  trang_thai: {
    type: String,
    enum: [
      'active',
      'cancelled'
    ],
    default: 'active'
  }
}, {
  collection: 'tam_ung_nhan_vien',
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  }
});

TamUngNhanVienSchema.index({
  cua_hang_id: 1,
  nhan_vien_id: 1,
  ngay_tam_ung: 1
});

TamUngNhanVienSchema.index({
  cua_hang_id: 1,
  chi_tiet_bang_luong_id: 1
});


/**
 * =========================================================
 * 13. BẢNG LƯƠNG
 * =========================================================
 *
 * Một record = một kỳ lương.
 *
 * VD:
 *
 * BL-2026-08
 */
const BangLuongSchema = new Schema({
  cua_hang_id: {
    type: ObjectId,
    ref: 'CuaHang',
    required: true
  },

  ma_bang_luong: {
    type: String,
    required: true,
    trim: true,
    uppercase: true
  },

  ten_bang_luong: {
    type: String,
    trim: true
  },

  thang: {
    type: Number,
    required: true,
    min: 1,
    max: 12
  },

  nam: {
    type: Number,
    required: true
  },

  tu_ngay: {
    type: Date,
    required: true
  },

  den_ngay: {
    type: Date,
    required: true
  },

  tong_nhan_vien: {
    type: Number,
    default: 0,
    min: 0
  },

  /**
   * Tổng lương sau quy đổi ngày công.
   */
  tong_luong_thuc_te: {
    type: Number,
    default: 0,
    min: 0
  },

  tong_luong_tang_ca: {
    type: Number,
    default: 0,
    min: 0
  },

  tong_phu_cap: {
    type: Number,
    default: 0,
    min: 0
  },

  /**
   * =
   * lương thực tế
   * + tăng ca
   * + phụ cấp
   */
  tong_luong_truoc_khau_tru: {
    type: Number,
    default: 0,
    min: 0
  },

  /**
   * Phần người lao động chịu.
   *
   * BHXH NLĐ
   * BHYT NLĐ
   * BHTN NLĐ
   * Công đoàn NLĐ
   * Thuế...
   */
  tong_khoan_tru_nld: {
    type: Number,
    default: 0,
    min: 0
  },

  tong_tam_ung: {
    type: Number,
    default: 0,
    min: 0
  },

  /**
   * Tổng thực nhận nhân viên.
   */
  tong_thuc_nhan: {
    type: Number,
    default: 0
  },

  /**
   * Phần doanh nghiệp chịu.
   *
   * BHXH DN
   * BHYT DN
   * BHTN DN
   * Công đoàn DN...
   */
  tong_khoan_doanh_nghiep_chiu: {
    type: Number,
    default: 0,
    min: 0
  },

  /**
   * =
   * tong_luong_truoc_khau_tru
   * +
   * tong_khoan_doanh_nghiep_chiu
   */
  tong_chi_phi_luong: {
    type: Number,
    default: 0,
    min: 0
  },

  tong_da_thanh_toan: {
    type: Number,
    default: 0,
    min: 0
  },

  tong_con_phai_tra: {
    type: Number,
    default: 0
  },

  trang_thai: {
    type: String,
    enum: [
      'draft',
      'calculated',
      'locked',
      'cancelled'
    ],
    default: 'draft'
  },

  nguoi_tao_id: {
    type: ObjectId,
    ref: 'NguoiDung'
  },

  ngay_chot: {
    type: Date
  },

  nguoi_chot_id: {
    type: ObjectId,
    ref: 'NguoiDung'
  },

  ghi_chu: {
    type: String,
    trim: true
  }
}, {
  collection: 'bang_luong',
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  }
});

BangLuongSchema.index(
  {
    cua_hang_id: 1,
    ma_bang_luong: 1
  },
  {
    unique: true
  }
);

BangLuongSchema.index({
  cua_hang_id: 1,
  thang: 1,
  nam: 1
});

BangLuongSchema.index({
  cua_hang_id: 1,
  trang_thai: 1
});


/**
 * =========================================================
 * 14. CHI TIẾT BẢNG LƯƠNG
 * =========================================================
 *
 * 1 nhân viên trong 1 kỳ lương.
 *
 * Đây là SNAPSHOT.
 */
const ChiTietBangLuongSchema = new Schema({
  cua_hang_id: {
    type: ObjectId,
    ref: 'CuaHang',
    required: true
  },

  bang_luong_id: {
    type: ObjectId,
    ref: 'BangLuong',
    required: true
  },

  nhan_vien_id: {
    type: ObjectId,
    ref: 'NhanVien',
    required: true
  },

  /**
   * Snapshot nhân viên.
   */
  ma_nhan_vien: {
    type: String,
    trim: true
  },

  ten_nhan_vien: {
    type: String,
    trim: true
  },

  phong_ban_id: {
    type: ObjectId,
    ref: 'PhongBan'
  },

  chuc_danh_id: {
    type: ObjectId,
    ref: 'ChucDanh'
  },

  /**
   * Snapshot cấu hình lương.
   */
  luong_thang: {
    type: Number,
    default: 0,
    min: 0
  },

  cach_tinh_ngay_cong: {
    type: String,
    enum: [
      'so_ngay_trong_thang',
      'ngay_cong_chuan'
    ]
  },

  /**
   * Mẫu số thực tế tháng đó.
   *
   * VD:
   * 31
   * 30
   * 28
   * hoặc 26.
   */
  mau_so_ngay_cong: {
    type: Number,
    default: 0,
    min: 0
  },

  /**
   * Căn cứ tính khoản trích đóng.
   */
  muc_luong_trich_dong: {
    type: Number,
    default: 0,
    min: 0
  },

  he_so_tang_ca: {
    type: Number,
    default: 1,
    min: 0
  },

  /**
   * Chấm công.
   */
  tong_cong_thuc_te: {
    type: Number,
    default: 0,
    min: 0
  },

  tong_cong_tang_ca: {
    type: Number,
    default: 0,
    min: 0
  },

  /**
   * Kết quả tính lương.
   */
  luong_thuc_te: {
    type: Number,
    default: 0,
    min: 0
  },

  luong_tang_ca: {
    type: Number,
    default: 0,
    min: 0
  },

  tong_phu_cap: {
    type: Number,
    default: 0,
    min: 0
  },

  tong_luong_truoc_khau_tru: {
    type: Number,
    default: 0,
    min: 0
  },

  /**
   * Người lao động chịu.
   */
  tong_khoan_tru_nld: {
    type: Number,
    default: 0,
    min: 0
  },

  /**
   * Doanh nghiệp chịu.
   */
  tong_khoan_doanh_nghiep_chiu: {
    type: Number,
    default: 0,
    min: 0
  },

  tong_tam_ung: {
    type: Number,
    default: 0,
    min: 0
  },

  /**
   * =
   * tong_luong_truoc_khau_tru
   * -
   * tong_khoan_tru_nld
   * -
   * tong_tam_ung
   */
  thuc_nhan: {
    type: Number,
    default: 0
  },

  /**
   * =
   * tong_luong_truoc_khau_tru
   * +
   * tong_khoan_doanh_nghiep_chiu
   */
  tong_chi_phi_luong: {
    type: Number,
    default: 0,
    min: 0
  },

  da_thanh_toan: {
    type: Number,
    default: 0,
    min: 0
  },

  con_phai_tra: {
    type: Number,
    default: 0
  },

  trang_thai_thanh_toan: {
    type: String,
    enum: [
      'chua_thanh_toan',
      'thanh_toan_mot_phan',
      'da_thanh_toan'
    ],
    default: 'chua_thanh_toan'
  },

  ghi_chu: {
    type: String,
    trim: true
  }
}, {
  collection: 'chi_tiet_bang_luong',
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  }
});

ChiTietBangLuongSchema.index(
  {
    bang_luong_id: 1,
    nhan_vien_id: 1
  },
  {
    unique: true
  }
);

ChiTietBangLuongSchema.index({
  cua_hang_id: 1,
  nhan_vien_id: 1
});

ChiTietBangLuongSchema.index({
  cua_hang_id: 1,
  trang_thai_thanh_toan: 1
});


/**
 * =========================================================
 * 15. CHI TIẾT PHỤ CẤP BẢNG LƯƠNG
 * =========================================================
 *
 * Snapshot phụ cấp tháng.
 *
 * VD:
 *
 * mặc định ăn trưa = 500.000
 *
 * tháng 8 chỉnh = 400.000
 *
 * chỉ bảng lương tháng 8 là 400.000.
 */
const ChiTietPhuCapBangLuongSchema = new Schema({
  chi_tiet_bang_luong_id: {
    type: ObjectId,
    ref: 'ChiTietBangLuong',
    required: true
  },

  danh_muc_phu_cap_id: {
    type: ObjectId,
    ref: 'DanhMucPhuCap'
  },

  /**
   * Snapshot.
   */
  ma_phu_cap_snapshot: {
    type: String,
    trim: true
  },

  ten_phu_cap_snapshot: {
    type: String,
    trim: true
  },

  so_tien: {
    type: Number,
    default: 0,
    min: 0
  },

  ghi_chu: {
    type: String,
    trim: true
  }
}, {
  collection: 'chi_tiet_phu_cap_bang_luong',
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  }
});

ChiTietPhuCapBangLuongSchema.index({
  chi_tiet_bang_luong_id: 1
});

ChiTietPhuCapBangLuongSchema.index({
  chi_tiet_bang_luong_id: 1,
  danh_muc_phu_cap_id: 1
});


/**
 * =========================================================
 * 16. CHI TIẾT KHOẢN NỘP BẢNG LƯƠNG
 * =========================================================
 *
 * Bảng snapshot rất quan trọng.
 *
 * Ví dụ một nhân viên tháng 8:
 *
 * BHXH NLĐ
 * muc_tinh = 8.000.000
 * gia_tri_ap_dung = 8
 * so_tien = 640.000
 *
 *
 * BHXH DN
 * muc_tinh = 8.000.000
 * gia_tri_ap_dung = 17.5
 * so_tien = 1.400.000
 *
 *
 * Sau này dùng bảng này để báo cáo:
 *
 * - cơ quan thuế
 * - cơ quan BHXH
 * - liên đoàn lao động
 */
const ChiTietKhoanNopBangLuongSchema = new Schema({
  chi_tiet_bang_luong_id: {
    type: ObjectId,
    ref: 'ChiTietBangLuong',
    required: true
  },

  danh_muc_khoan_nop_id: {
    type: ObjectId,
    ref: 'DanhMucKhoanNop'
  },

  /**
   * Snapshot danh mục.
   */
  ma_khoan_snapshot: {
    type: String,
    trim: true
  },

  ten_khoan_snapshot: {
    type: String,
    trim: true
  },

  nhom_khoan_snapshot: {
    type: String,
    enum: [
      'thue',
      'bao_hiem',
      'cong_doan',
      'khac'
    ]
  },

  loai_khoan_snapshot: {
    type: String,
    enum: [
      'thue_tncn',
      'bhxh',
      'bhyt',
      'bhtn',
      'cong_doan',
      'khac'
    ]
  },

  noi_nop_snapshot: {
    type: String,
    enum: [
      'co_quan_thue',
      'co_quan_bhxh',
      'lien_doan_lao_dong',
      'khac'
    ]
  },

  /**
   * Ai chịu khoản tiền.
   */
  ben_chiu: {
    type: String,
    enum: [
      'nguoi_lao_dong',
      'doanh_nghiep'
    ],
    required: true
  },

  kieu_tinh: {
    type: String,
    enum: [
      'phan_tram',
      'so_tien_co_dinh',
      'nhap_tay'
    ]
  },

  /**
   * Ví dụ:
   *
   * mức lương trích đóng
   * = 8.000.000
   */
  muc_tinh: {
    type: Number,
    default: 0,
    min: 0
  },

  /**
   * Nếu %:
   *
   * 8 = 8%
   *
   * Nếu cố định:
   *
   * có thể là số tiền.
   */
  gia_tri_ap_dung: {
    type: Number,
    default: 0,
    min: 0
  },

  /**
   * Kết quả cuối cùng bằng tiền.
   */
  so_tien: {
    type: Number,
    default: 0,
    min: 0
  },

  tru_vao_luong: {
    type: Boolean,
    default: false
  },

  tinh_vao_chi_phi_luong: {
    type: Boolean,
    default: false
  },

  ghi_chu: {
    type: String,
    trim: true
  }
}, {
  collection: 'chi_tiet_khoan_nop_bang_luong',
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  }
});

ChiTietKhoanNopBangLuongSchema.index({
  chi_tiet_bang_luong_id: 1
});

ChiTietKhoanNopBangLuongSchema.index({
  chi_tiet_bang_luong_id: 1,
  danh_muc_khoan_nop_id: 1,
  ben_chiu: 1
});

ChiTietKhoanNopBangLuongSchema.index({
  noi_nop_snapshot: 1
});

ChiTietKhoanNopBangLuongSchema.index({
  nhom_khoan_snapshot: 1,
  ben_chiu: 1
});


/**
 * =========================================================
 * 17. THANH TOÁN LƯƠNG
 * =========================================================
 *
 * Một nhân viên có thể thanh toán nhiều lần.
 *
 * VD:
 *
 * phải trả = 10 triệu
 *
 * lần 1 = 4 triệu
 * lần 2 = 6 triệu
 */
const ThanhToanLuongSchema = new Schema({
  cua_hang_id: {
    type: ObjectId,
    ref: 'CuaHang',
    required: true
  },

  chi_tiet_bang_luong_id: {
    type: ObjectId,
    ref: 'ChiTietBangLuong',
    required: true
  },

  ngay_thanh_toan: {
    type: Date,
    required: true,
    default: Date.now
  },

  so_tien: {
    type: Number,
    required: true,
    min: 0
  },

  phuong_thuc: {
    type: String,
    enum: [
      'tien_mat',
      'chuyen_khoan',
      'khac'
    ],
    default: 'tien_mat'
  },

  /**
   * VD:
   *
   * mã giao dịch ngân hàng
   * số phiếu chi
   */
  ma_tham_chieu: {
    type: String,
    trim: true
  },

  ghi_chu: {
    type: String,
    trim: true
  },

  nguoi_thanh_toan_id: {
    type: ObjectId,
    ref: 'NguoiDung'
  },

  trang_thai: {
    type: String,
    enum: [
      'completed',
      'cancelled'
    ],
    default: 'completed'
  }
}, {
  collection: 'thanh_toan_luong',
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  }
});

ThanhToanLuongSchema.index({
  cua_hang_id: 1,
  chi_tiet_bang_luong_id: 1,
  ngay_thanh_toan: 1
});

ThanhToanLuongSchema.index({
  chi_tiet_bang_luong_id: 1,
  trang_thai: 1
});


/**
 * =========================================================
 * MODEL
 * =========================================================
 */

const PhongBan =
  mongoose.models.PhongBan ||
  mongoose.model(
    'PhongBan',
    PhongBanSchema
  );


const ChucDanh =
  mongoose.models.ChucDanh ||
  mongoose.model(
    'ChucDanh',
    ChucDanhSchema
  );


const NhanVien =
  mongoose.models.NhanVien ||
  mongoose.model(
    'NhanVien',
    NhanVienSchema
  );


const DanhMucKhoanNop =
  mongoose.models.DanhMucKhoanNop ||
  mongoose.model(
    'DanhMucKhoanNop',
    DanhMucKhoanNopSchema
  );


const ChinhSachKhoanNop =
  mongoose.models.ChinhSachKhoanNop ||
  mongoose.model(
    'ChinhSachKhoanNop',
    ChinhSachKhoanNopSchema
  );


const ChiTietChinhSachKhoanNop =
  mongoose.models.ChiTietChinhSachKhoanNop ||
  mongoose.model(
    'ChiTietChinhSachKhoanNop',
    ChiTietChinhSachKhoanNopSchema
  );


const CauHinhLuongCuaHang =
  mongoose.models.CauHinhLuongCuaHang ||
  mongoose.model(
    'CauHinhLuongCuaHang',
    CauHinhLuongCuaHangSchema
  );


const CauHinhLuongNhanVien =
  mongoose.models.CauHinhLuongNhanVien ||
  mongoose.model(
    'CauHinhLuongNhanVien',
    CauHinhLuongNhanVienSchema
  );


const DanhMucPhuCap =
  mongoose.models.DanhMucPhuCap ||
  mongoose.model(
    'DanhMucPhuCap',
    DanhMucPhuCapSchema
  );


const PhuCapNhanVien =
  mongoose.models.PhuCapNhanVien ||
  mongoose.model(
    'PhuCapNhanVien',
    PhuCapNhanVienSchema
  );


const ChamCong =
  mongoose.models.ChamCong ||
  mongoose.model(
    'ChamCong',
    ChamCongSchema
  );


const TamUngNhanVien =
  mongoose.models.TamUngNhanVien ||
  mongoose.model(
    'TamUngNhanVien',
    TamUngNhanVienSchema
  );


const BangLuong =
  mongoose.models.BangLuong ||
  mongoose.model(
    'BangLuong',
    BangLuongSchema
  );


const ChiTietBangLuong =
  mongoose.models.ChiTietBangLuong ||
  mongoose.model(
    'ChiTietBangLuong',
    ChiTietBangLuongSchema
  );


const ChiTietPhuCapBangLuong =
  mongoose.models.ChiTietPhuCapBangLuong ||
  mongoose.model(
    'ChiTietPhuCapBangLuong',
    ChiTietPhuCapBangLuongSchema
  );

const ChiTietKhoanNopBangLuong =
  mongoose.models.ChiTietKhoanNopBangLuong ||
  mongoose.model(
    'ChiTietKhoanNopBangLuong',
    ChiTietKhoanNopBangLuongSchema
  );


const ThanhToanLuong =
  mongoose.models.ThanhToanLuong ||
  mongoose.model(
    'ThanhToanLuong',
    ThanhToanLuongSchema
  );

module.exports = {
  PhongBan,
  ChucDanh,
  NhanVien,

  DanhMucKhoanNop,
  ChinhSachKhoanNop,
  ChiTietChinhSachKhoanNop,

  CauHinhLuongCuaHang,
  CauHinhLuongNhanVien,

  DanhMucPhuCap,
  PhuCapNhanVien,

  ChamCong,
  TamUngNhanVien,

  BangLuong,
  ChiTietBangLuong,
  ChiTietPhuCapBangLuong,
  ChiTietKhoanNopBangLuong,

  ThanhToanLuong
};