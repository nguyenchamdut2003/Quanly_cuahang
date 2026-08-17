var db = require('./db.model');

const mongoose = db.mongoose;
const Schema = mongoose.Schema;
const ObjectId = Schema.Types.ObjectId;

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
PhongBanSchema.index({ cua_hang_id: 1, ten_phong_ban: 1 });
PhongBanSchema.index({ cua_hang_id: 1, trang_thai: 1 });

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
ChucDanhSchema.index({ cua_hang_id: 1, ten_chuc_danh: 1 });
ChucDanhSchema.index({ cua_hang_id: 1, trang_thai: 1 });

const NoiNopKhoanNopSchema = new Schema({
  cua_hang_id: {
    type: ObjectId,
    ref: 'CuaHang',
    required: true
  },
  ma_noi_nop: {
    type: String,
    required: true,
    trim: true,
    uppercase: true
  },
  ten_noi_nop: {
    type: String,
    required: true,
    trim: true
  },
  trang_thai: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active'
  }
}, {
  collection: 'noi_nop_khoan_nop',
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  }
});

NoiNopKhoanNopSchema.index(
  {
    cua_hang_id: 1,
    ma_noi_nop: 1
  },
  {
    unique: true
  }
);
NoiNopKhoanNopSchema.index({ cua_hang_id: 1, ten_noi_nop: 1 });
NoiNopKhoanNopSchema.index({ cua_hang_id: 1, trang_thai: 1 });

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
  noi_nop_id: {
    type: ObjectId,
    ref: 'NoiNopKhoanNop',
    required: true
  },
  ti_le_nld: {
    type: Number,
    default: 0,
    min: 0
  },
  ti_le_nsdld: {
    type: Number,
    default: 0,
    min: 0
  },
  ti_le: {
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
DanhMucKhoanNopSchema.index({ cua_hang_id: 1, ten_khoan: 1 });
DanhMucKhoanNopSchema.index({ cua_hang_id: 1, noi_nop_id: 1, trang_thai: 1 });

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
    enum: ['active', 'inactive'],
    default: 'active'
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
NhanVienSchema.index({ cua_hang_id: 1, ten_nhan_vien: 1 });
NhanVienSchema.index({ cua_hang_id: 1, phong_ban_id: 1 });
NhanVienSchema.index({ cua_hang_id: 1, chuc_danh_id: 1 });
NhanVienSchema.index({ cua_hang_id: 1, trang_thai: 1 });

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
  luong_thang: {
    type: Number,
    required: true,
    min: 0
  },
  so_ngay_cong_trong_thang: {
    type: Number,
    min: 0
  },
  khoan_nop_ids: [{
    type: ObjectId,
    ref: 'DanhMucKhoanNop'
  }],
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

  kieu_tinh: {
    type: String,
    enum: ['co_dinh_thang', 'theo_ngay_di_lam', 'theo_cong'],
    required: true
  },

  muc_phu_cap: {
    type: Number,
    required: true,
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

  cong_tang_ca: {
    type: Number,
    default: 0,
    min: 0
  },

  tick_tang_ca: {
    type: Boolean,
    default: false
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

  ma_tam_ung: {
    type: String,
    trim: true,
    uppercase: true
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
    enum: ['active','cancelled'],
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

TamUngNhanVienSchema.index(
  {
    cua_hang_id: 1,
    ma_tam_ung: 1
  },
  {
    unique: true,
    sparse: true
  }
);

TamUngNhanVienSchema.index({
  cua_hang_id: 1,
  chi_tiet_bang_luong_id: 1
});

const BangLuongSchema = new Schema({
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

  ma_bang_luong: {
    type: String,
    required: true,
    trim: true,
    uppercase: true
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

  ma_nhan_vien_snapshot: {
    type: String,
    trim: true
  },

  ten_nhan_vien_snapshot: {
    type: String,
    trim: true
  },

  phong_ban_id: {
    type: ObjectId,
    ref: 'PhongBan'
  },

  ten_phong_ban_snapshot: {
    type: String,
    trim: true
  },

  chuc_danh_id: {
    type: ObjectId,
    ref: 'ChucDanh'
  },

  ten_chuc_danh_snapshot: {
    type: String,
    trim: true
  },

  luong_thang: {
    type: Number,
    required: true,
    min: 0
  },

  so_ngay_cong_trong_thang: {
    type: Number,
    required: true,
    min: 0
  },

  cham_cong_ids: [{
    type: ObjectId,
    ref: 'ChamCong'
  }],

  ngay_cong_thuc_te: {
    type: Number,
    default: 0,
    min: 0
  },

  so_ngay_di_lam: {
    type: Number,
    default: 0,
    min: 0
  },

  luong_thuc_te: {
    type: Number,
    default: 0,
    min: 0
  },

  cong_tang_ca: {
    type: Number,
    default: 0,
    min: 0
  },

  luong_tang_ca: {
    type: Number,
    default: 0,
    min: 0
  },

  phu_caps: [{
    danh_muc_phu_cap_id: {
      type: ObjectId,
      ref: 'DanhMucPhuCap'
    },

    ma_phu_cap_snapshot: {
      type: String,
      trim: true
    },

    ten_phu_cap_snapshot: {
      type: String,
      trim: true
    },

    kieu_tinh_snapshot: {
      type: String,
      enum: [
        'co_dinh_thang',
        'theo_ngay_di_lam',
        'theo_cong'
      ]
    },

    muc_phu_cap_snapshot: {
      type: Number,
      default: 0,
      min: 0
    },

    so_luong: {
      type: Number,
      default: 0,
      min: 0
    },

    so_tien: {
      type: Number,
      default: 0,
      min: 0
    }
  }],

  tong_phu_cap: {
    type: Number,
    default: 0,
    min: 0
  },

  tong_luong: {
    type: Number,
    default: 0,
    min: 0
  },

  khoan_trus: [{
    danh_muc_khoan_nop_id: {
      type: ObjectId,
      ref: 'DanhMucKhoanNop'
    },

    ma_khoan_snapshot: {
      type: String,
      trim: true
    },

    ten_khoan_snapshot: {
      type: String,
      trim: true
    },

    noi_nop_id: {
      type: ObjectId,
      ref: 'NoiNopKhoanNop'
    },

    ma_noi_nop_snapshot: {
      type: String,
      trim: true
    },

    ten_noi_nop_snapshot: {
      type: String,
      trim: true
    },

    ti_le_snapshot: {
      type: Number,
      default: 0,
      min: 0
    },

    ti_le_nld_snapshot: {
      type: Number,
      default: 0,
      min: 0
    },

    ti_le_nsdld_snapshot: {
      type: Number,
      default: 0,
      min: 0
    },

    muc_tinh: {
      type: Number,
      default: 0,
      min: 0
    },

    so_tien: {
      type: Number,
      default: 0,
      min: 0
    }
  }],

  tong_khoan_tru: {
    type: Number,
    default: 0,
    min: 0
  },

  tam_ung_ids: [{
    type: ObjectId,
    ref: 'TamUngNhanVien'
  }],

  tong_tam_ung: {
    type: Number,
    default: 0,
    min: 0
  },

  thuc_nhan: {
    type: Number,
    default: 0
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

  trang_thai_du_lieu: {
    type: String,
    enum: [
      'active',
      'inactive'
    ],
    default: 'active',
    index: true
  },

  nguoi_tao_id: {
    type: ObjectId,
    ref: 'NguoiDung'
  },

  nguoi_cap_nhat_id: {
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

BangLuongSchema.index(
  {
    cua_hang_id: 1,
    nhan_vien_id: 1,
    thang: 1,
    nam: 1
  }
);

BangLuongSchema.index({
  cua_hang_id: 1,
  thang: 1,
  nam: 1
});

BangLuongSchema.index({
  cua_hang_id: 1,
  trang_thai_thanh_toan: 1
});

BangLuongSchema.index({
  cua_hang_id: 1,
  trang_thai_du_lieu: 1
});

BangLuongSchema.index({
  cua_hang_id: 1,
  nhan_vien_id: 1,
  nam: -1,
  thang: -1
});

const ThanhToanLuongSchema = new Schema({
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

  ma_tham_chieu: {
    type: String,
    trim: true
  },

  phieu_chi_id: {
    type: ObjectId,
    ref: 'PhieuThuChi'
  },

  tien_mat: {
    type: Number,
    default: 0,
    min: 0
  },

  chuyen_khoan: {
    type: Number,
    default: 0,
    min: 0
  },

  so_quy_tien_mat_id: {
    type: ObjectId,
    ref: 'SoQuy'
  },

  so_quy_chuyen_khoan_id: {
    type: ObjectId,
    ref: 'SoQuy'
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
  },

  trang_thai_du_lieu: {
    type: String,
    enum: [
      'active',
      'inactive'
    ],
    default: 'active',
    index: true
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
  bang_luong_id: 1,
  ngay_thanh_toan: 1
});


ThanhToanLuongSchema.index({
  bang_luong_id: 1,
  trang_thai: 1
});

ThanhToanLuongSchema.index({
  cua_hang_id: 1,
  trang_thai_du_lieu: 1
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

const NoiNopKhoanNop =
  mongoose.models.NoiNopKhoanNop ||
  mongoose.model(
    'NoiNopKhoanNop',
    NoiNopKhoanNopSchema
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

async function dropOldBangLuongEmployeeMonthUniqueIndex() {
  try {
    await BangLuong.collection.dropIndex('cua_hang_id_1_nhan_vien_id_1_thang_1_nam_1');
  } catch (error) {
    if (!error || !['IndexNotFound', 'NamespaceNotFound', 27, 26].includes(error.codeName || error.code)) {
      console.log('[ChamCong] Không bỏ được unique index bảng lương cũ');
      console.log(error);
    }
  }
}

async function backfillBangLuongDataStatus() {
  try {
    await BangLuong.updateMany(
      { trang_thai_du_lieu: { $exists: false } },
      { $set: { trang_thai_du_lieu: 'active' } }
    );
  } catch (error) {
    console.log('[ChamCong] Không cập nhật được trạng thái dữ liệu bảng lương cũ');
    console.log(error);
  }
}

async function backfillThanhToanLuongDataStatus() {
  try {
    await ThanhToanLuong.updateMany(
      { trang_thai_du_lieu: { $exists: false } },
      { $set: { trang_thai_du_lieu: 'active' } }
    );
  } catch (error) {
    console.log('[ChamCong] Khong cap nhat duoc trang thai du lieu thanh toan luong cu');
    console.log(error);
  }
}

async function migrateBangLuongIndexesAndDefaults() {
  await dropOldBangLuongEmployeeMonthUniqueIndex();
  await backfillBangLuongDataStatus();
  await backfillThanhToanLuongDataStatus();
}

const ThanhToanLuong =
  mongoose.models.ThanhToanLuong ||
  mongoose.model(
    'ThanhToanLuong',
    ThanhToanLuongSchema
  );

if (mongoose.connection.readyState === 1) {
  migrateBangLuongIndexesAndDefaults();
} else {
  mongoose.connection.once('open', migrateBangLuongIndexesAndDefaults);
}

module.exports = {
  PhongBan,
  ChucDanh,
  NhanVien,

  DanhMucKhoanNop,
  NoiNopKhoanNop,

  CauHinhLuongNhanVien,

  DanhMucPhuCap,
  PhuCapNhanVien,

  ChamCong,
  TamUngNhanVien,

  BangLuong,
  ThanhToanLuong
};
