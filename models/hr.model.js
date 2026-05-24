var db = require('./db.model');
const mongoose = db.mongoose;
const Schema = mongoose.Schema;
const ObjectId = Schema.Types.ObjectId;

/**
 * PHONG BAN
 */
const PhongBanSchema = new Schema({
  cua_hang_id: { type: ObjectId, ref: 'CuaHang', required: true },
  ma_phong_ban: { type: String, trim: true },
  ten_phong_ban: { type: String, required: true, trim: true },
  mo_ta: { type: String },

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
  { cua_hang_id: 1, ma_phong_ban: 1 },
  { unique: true, sparse: true }
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
 * CHUC DANH
 */
const ChucDanhSchema = new Schema({
  cua_hang_id: { type: ObjectId, ref: 'CuaHang', required: true },
  ma_chuc_danh: { type: String, trim: true },
  ten_chuc_danh: { type: String, required: true, trim: true },
  mo_ta: { type: String },

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
  { cua_hang_id: 1, ma_chuc_danh: 1 },
  { unique: true, sparse: true }
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
 * SALARY SETUP
 * Lưu cấu hình lương mặc định của nhân viên
 */
const SalarySetupSchema = new Schema({
  enabled: {
    type: Boolean,
    default: false
  },

  loai_luong: {
    type: String,
    enum: [
      'theo_ca',
      'theo_ngay',
      'theo_gio',
      'theo_thang'
    ],
    default: 'theo_ca'
  },

  muc_luong: {
    type: Number,
    default: 0,
    min: 0
  },

  /**
   * THIẾT LẬP NÂNG CAO
   */
  nang_cao: {
    type: Boolean,
    default: false
  },

  muc_luong_nang_cao: {
    ngay_thuong: {
      type: Number,
      default: 0,
      min: 0
    },

    ngay_thuong_kieu: {
      type: String,
      enum: ['phan_tram', 'vnd'],
      default: 'phan_tram'
    },

    thu_7: {
      type: Number,
      default: 0,
      min: 0
    },

    thu_7_kieu: {
      type: String,
      enum: ['phan_tram', 'vnd'],
      default: 'phan_tram'
    },

    chu_nhat: {
      type: Number,
      default: 0,
      min: 0
    },

    chu_nhat_kieu: {
      type: String,
      enum: ['phan_tram', 'vnd'],
      default: 'phan_tram'
    },

    ngay_nghi: {
      type: Number,
      default: 0,
      min: 0
    },

    ngay_nghi_kieu: {
      type: String,
      enum: ['phan_tram', 'vnd'],
      default: 'phan_tram'
    },

    ngay_le_tet: {
      type: Number,
      default: 0,
      min: 0
    },

    ngay_le_tet_kieu: {
      type: String,
      enum: ['phan_tram', 'vnd'],
      default: 'phan_tram'
    },

    dieu_kien: [{
      ca_lam_viec_id: {
        type: ObjectId,
        ref: 'CaLamViec'
      },

      ten_ca: {
        type: String,
        trim: true
      },

      ten_dieu_kien: {
        type: String,
        trim: true
      },

      muc_luong: {
        type: Number,
        default: 0,
        min: 0
      },

      ngay_thuong: {
        type: Number,
        default: 0,
        min: 0
      },

      ngay_thuong_kieu: {
        type: String,
        enum: ['phan_tram', 'vnd'],
        default: 'vnd'
      },

      thu_7: {
        type: Number,
        default: 0,
        min: 0
      },

      thu_7_kieu: {
        type: String,
        enum: ['phan_tram', 'vnd'],
        default: 'phan_tram'
      },

      chu_nhat: {
        type: Number,
        default: 0,
        min: 0
      },

      chu_nhat_kieu: {
        type: String,
        enum: ['phan_tram', 'vnd'],
        default: 'phan_tram'
      },

      ngay_nghi: {
        type: Number,
        default: 0,
        min: 0
      },

      ngay_nghi_kieu: {
        type: String,
        enum: ['phan_tram', 'vnd'],
        default: 'phan_tram'
      },

      ngay_le_tet: {
        type: Number,
        default: 0,
        min: 0
      },

      ngay_le_tet_kieu: {
        type: String,
        enum: ['phan_tram', 'vnd'],
        default: 'phan_tram'
      }
    }]
  },

  /**
   * LƯƠNG OT
   */
  lam_them_gio: {
    enabled: {
      type: Boolean,
      default: false
    },

    he_so_ngay_thuong: {
      type: Number,
      default: 150,
      min: 0
    },

    he_so_ngay_thuong_kieu: {
      type: String,
      enum: ['phan_tram', 'vnd'],
      default: 'phan_tram'
    },

    he_so_thu_7: {
      type: Number,
      default: 200,
      min: 0
    },

    he_so_thu_7_kieu: {
      type: String,
      enum: ['phan_tram', 'vnd'],
      default: 'phan_tram'
    },

    he_so_chu_nhat: {
      type: Number,
      default: 200,
      min: 0
    },

    he_so_chu_nhat_kieu: {
      type: String,
      enum: ['phan_tram', 'vnd'],
      default: 'phan_tram'
    },

    he_so_ngay_nghi: {
      type: Number,
      default: 200,
      min: 0
    },

    he_so_ngay_nghi_kieu: {
      type: String,
      enum: ['phan_tram', 'vnd'],
      default: 'phan_tram'
    },

    he_so_ngay_le_tet: {
      type: Number,
      default: 300,
      min: 0
    },

    he_so_ngay_le_tet_kieu: {
      type: String,
      enum: ['phan_tram', 'vnd'],
      default: 'phan_tram'
    }
  },

  /**
   * MẪU LƯƠNG
   */
  mau_luong_id: {
    type: ObjectId
  },

  /**
   * THƯỞNG
   */
  thuong: {
    enabled: {
      type: Boolean,
      default: false
    },

    loai_thuong: {
      type: String,
      enum: [
        'doanh_thu_ca_nhan',
        'doanh_thu_cua_hang',
        'doanh_thu_phong_ban'
      ],
      default: 'doanh_thu_ca_nhan'
    },

    hinh_thuc: {
      type: String,
      enum: [
        'phan_tram_doanh_thu',
        'so_tien_co_dinh'
      ],
      default: 'phan_tram_doanh_thu'
    },

    rules: [{
      tu_doanh_thu: {
        type: Number,
        default: 0,
        min: 0
      },

      gia_tri_thuong: {
        type: Number,
        default: 0,
        min: 0
      }
    }]
  },

  /**
   * HOA HỒNG
   */
  hoa_hong: {
    enabled: {
      type: Boolean,
      default: false
    },

    rules: [{
      loai_hinh: {
        type: String,
        enum: [
          'tu_van_ban_hang',
          'ban_hang',
          'dich_vu',
          'khac'
        ],
        default: 'tu_van_ban_hang'
      },

      tu_doanh_thu: {
        type: Number,
        default: 0,
        min: 0
      },

      kieu_hoa_hong: {
        type: String,
        enum: [
          'phan_tram',
          'so_tien'
        ],
        default: 'phan_tram'
      },

      gia_tri_hoa_hong: {
        type: Number,
        default: 0,
        min: 0
      },

      bang_hoa_hong_id: {
        type: ObjectId
      }
    }]
  },

  /**
   * PHỤ CẤP
   */
  phu_cap: {
    enabled: {
      type: Boolean,
      default: false
    },

    items: [{
      ten_phu_cap: {
        type: String,
        trim: true
      },

      loai_phu_cap: {
        type: String,
        enum: [
          'co_dinh_theo_thang',
          'theo_ngay_cong',
          'theo_ca',
          'theo_gio'
        ],
        default: 'co_dinh_theo_thang'
      },

      so_tien: {
        type: Number,
        default: 0,
        min: 0
      }
    }]
  },

  /**
   * GIẢM TRỪ
   */
  giam_tru: {
    enabled: {
      type: Boolean,
      default: false
    },

    items: [{
      ten_giam_tru: {
        type: String,
        trim: true
      },

      loai_giam_tru: {
        type: String,
        enum: [
          'di_muon',
          've_som',
          'nghi_khong_phep',
          'vi_pham',
          'tam_ung',
          'khac'
        ],
        default: 'khac'
      },

      kieu_tinh: {
        type: String,
        enum: [
          'so_tien_co_dinh',
          'theo_so_lan',
          'theo_phut',
          'phan_tram_luong'
        ],
        default: 'so_tien_co_dinh'
      },

      gia_tri: {
        type: Number,
        default: 0,
        min: 0
      }
    }]
  },

  updated_at: {
    type: Date
  }
}, {
  _id: false
});


/**
 * NHAN VIEN
 */
const NhanVienSchema = new Schema({
  cua_hang_id: {
    type: ObjectId,
    ref: 'CuaHang',
    required: true
  },

  ma_nhan_vien: {
    type: String,
    trim: true
  },

  ma_cham_cong: {
    type: String,
    trim: true
  },

  ten_nhan_vien: {
    type: String,
    required: true,
    trim: true
  },

  anh_dai_dien: {
    type: String
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
   * Liên kết tùy chọn với user đăng nhập
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

  tinh_thanh: {
    type: String
  },

  tinh_thanh_id: {
    type: Number
  },

  quan_huyen: {
    type: String
  },

  quan_huyen_id: {
    type: Number
  },

  phuong_xa: {
    type: String
  },

  phuong_xa_code: {
    type: String
  },

  dia_chi_chi_tiet: {
    type: String
  },

  dia_chi_day_du: {
    type: String
  },

  facebook: {
    type: String
  },

  no_va_tam_ung: {
    type: Number,
    default: 0,
    min: 0
  },

  /**
   * CẤU HÌNH LƯƠNG
   */
  salary_setup: {
    type: SalarySetupSchema,
    default: () => ({})
  },

  ghi_chu: {
    type: String
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


/**
 * INDEX
 */

NhanVienSchema.index(
  { cua_hang_id: 1, ma_nhan_vien: 1 },
  { unique: true, sparse: true }
);

NhanVienSchema.index(
  { cua_hang_id: 1, ma_cham_cong: 1 },
  { sparse: true }
);

NhanVienSchema.index({
  cua_hang_id: 1,
  ten_nhan_vien: 1
});

NhanVienSchema.index({
  cua_hang_id: 1,
  sdt: 1
});

NhanVienSchema.index({
  cua_hang_id: 1,
  email: 1
});

NhanVienSchema.index({
  cua_hang_id: 1,
  cccd: 1
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
 * CA LAM VIEC
 */
const CaLamViecSchema = new Schema({
  cua_hang_id: {
    type: ObjectId,
    ref: 'CuaHang',
    required: true
  },

  ma_ca: {
    type: String,
    trim: true
  },

  ten_ca: {
    type: String,
    required: true,
    trim: true
  },

  gio_bat_dau: {
    type: String,
    required: true
  },

  gio_ket_thuc: {
    type: String,
    required: true
  },

  nghi_giua_ca_phut: {
    type: Number,
    default: 0,
    min: 0
  },

  cho_phep_di_muon_phut: {
    type: Number,
    default: 0,
    min: 0
  },

  cho_phep_ve_som_phut: {
    type: Number,
    default: 0,
    min: 0
  },

  tinh_lam_them_truoc_ca: {
    type: Boolean,
    default: false
  },

  tinh_lam_them_sau_ca: {
    type: Boolean,
    default: true
  },

  ghi_chu: {
    type: String
  },

  trang_thai: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active'
  }
}, {
  collection: 'ca_lam_viec',
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  }
});

CaLamViecSchema.index(
  { cua_hang_id: 1, ma_ca: 1 },
  { unique: true, sparse: true }
);

CaLamViecSchema.index({
  cua_hang_id: 1,
  ten_ca: 1
});

CaLamViecSchema.index({
  cua_hang_id: 1,
  trang_thai: 1
});

/**
 * NGÀY LÀM VIỆC CỬA HÀNG
 */
const NgayLamViecCuaHangSchema = new mongoose.Schema({
  cua_hang_id: {
    type: ObjectId,
    ref: 'CuaHang',
    required: true
  },

  thu_trong_tuan: {
    type: [Number],
    default: function() {
      return [2, 3, 4, 5, 6, 7];
    }
  },

  so_gio_ngay_cong_chuan: {
    type: Number,
    default: 8,
    min: 0
  },

  so_gio_nua_cong: {
    type: Number,
    default: 4,
    min: 0
  },

  ghi_chu: {
    type: String
  },

  trang_thai: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active'
  }
}, {
  collection: 'ngay_lam_viec_cua_hang',
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  }
});

NgayLamViecCuaHangSchema.index(
  { cua_hang_id: 1 },
  { unique: true }
);

/**
 * NGÀY LỄ TẾT
 */
const NgayLeTetSchema = new mongoose.Schema({
  cua_hang_id: {
    type: ObjectId,
    ref: 'CuaHang',
    required: true
  },

  ten_ngay_le: {
    type: String,
    required: true,
    trim: true
  },

  tu_ngay: {
    type: Date,
    required: true
  },

  den_ngay: {
    type: Date,
    required: true
  },

  so_ngay: {
    type: Number,
    default: 1,
    min: 1
  },

  he_so_luong: {
    type: Number,
    default: 300,
    min: 0
  },

  ghi_chu: {
    type: String
  },

  trang_thai: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active'
  }
}, {
  collection: 'ngay_le_tet',
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  }
});

NgayLeTetSchema.index({
  cua_hang_id: 1,
  tu_ngay: 1
});

NgayLeTetSchema.index({
  cua_hang_id: 1,
  trang_thai: 1
});

/**
 * LỊCH LÀM VIỆC / XẾP CA
 */
const LichLamViecSchema = new Schema({
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

  ca_lam_viec_id: {
    type: ObjectId,
    ref: 'CaLamViec',
    required: true
  },

  ngay_lam_viec: {
    type: Date,
    required: true
  },

  ma_ca: {
    type: String,
    trim: true
  },

  ten_ca: {
    type: String,
    trim: true
  },

  gio_bat_dau: {
    type: String,
    trim: true
  },

  gio_ket_thuc: {
    type: String,
    trim: true
  },

  nghi_giua_ca_phut: {
    type: Number,
    default: 0,
    min: 0
  },

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

  loai_ngay: {
    type: String,
    enum: ['ngay_thuong', 'thu_7', 'chu_nhat', 'ngay_nghi', 'ngay_le_tet'],
    default: 'ngay_thuong'
  },

  ten_ngay_le: {
    type: String,
    trim: true
  },

  he_so_luong_ngay: {
    type: Number,
    default: 100,
    min: 0
  },

  trang_thai: {
    type: String,
    enum: ['scheduled', 'cancelled', 'completed'],
    default: 'scheduled'
  },

  nguoi_tao_id: {
    type: ObjectId,
    ref: 'NguoiDung'
  },

  ghi_chu: {
    type: String
  }
}, {
  collection: 'lich_lam_viec',
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  }
});

LichLamViecSchema.index({
  cua_hang_id: 1,
  ngay_lam_viec: 1
});

LichLamViecSchema.index({
  cua_hang_id: 1,
  nhan_vien_id: 1,
  ngay_lam_viec: 1
});

LichLamViecSchema.index({
  cua_hang_id: 1,
  ca_lam_viec_id: 1,
  ngay_lam_viec: 1
});

LichLamViecSchema.index(
  { cua_hang_id: 1, nhan_vien_id: 1, ngay_lam_viec: 1, ca_lam_viec_id: 1 },
  {
    unique: true,
    partialFilterExpression: { trang_thai: 'scheduled' }
  }
);

/**
 * CHẤM CÔNG
 */
const ChamCongSchema = new Schema({
  cua_hang_id: {
    type: ObjectId,
    ref: 'CuaHang',
    required: true
  },

  lich_lam_viec_id: {
    type: ObjectId,
    ref: 'LichLamViec'
  },

  nhan_vien_id: {
    type: ObjectId,
    ref: 'NhanVien',
    required: true
  },

  ca_lam_viec_id: {
    type: ObjectId,
    ref: 'CaLamViec'
  },

  ngay_cham_cong: {
    type: Date,
    required: true
  },

  gio_vao: {
    type: Date
  },

  gio_ra: {
    type: Date
  },

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

  ma_ca: {
    type: String,
    trim: true
  },

  ten_ca: {
    type: String,
    trim: true
  },

  gio_bat_dau: {
    type: String,
    trim: true
  },

  gio_ket_thuc: {
    type: String,
    trim: true
  },

  nghi_giua_ca_phut: {
    type: Number,
    default: 0,
    min: 0
  },

  cho_phep_di_muon_phut: {
    type: Number,
    default: 0,
    min: 0
  },

  cho_phep_ve_som_phut: {
    type: Number,
    default: 0,
    min: 0
  },

  tinh_lam_them_truoc_ca: {
    type: Boolean,
    default: false
  },

  tinh_lam_them_sau_ca: {
    type: Boolean,
    default: true
  },

  loai_ngay: {
    type: String,
    enum: ['ngay_thuong', 'thu_7', 'chu_nhat', 'ngay_nghi', 'ngay_le_tet'],
    default: 'ngay_thuong'
  },

  ten_ngay_le: {
    type: String,
    trim: true
  },

  he_so_luong_ngay: {
    type: Number,
    default: 100,
    min: 0
  },

  so_phut_lam_viec: {
    type: Number,
    default: 0,
    min: 0
  },

  so_phut_di_muon: {
    type: Number,
    default: 0,
    min: 0
  },

  so_phut_ve_som: {
    type: Number,
    default: 0,
    min: 0
  },

  so_phut_tang_ca_truoc_ca: {
    type: Number,
    default: 0,
    min: 0
  },

  so_phut_tang_ca_sau_ca: {
    type: Number,
    default: 0,
    min: 0
  },

  so_phut_tang_ca: {
    type: Number,
    default: 0,
    min: 0
  },

  cong_quy_doi: {
    type: Number,
    default: 0,
    min: 0
  },

  trang_thai: {
    type: String,
    enum: [
      'chua_cham_cong',
      'dang_lam',
      'dung_gio',
      'di_muon',
      've_som',
      'di_muon_ve_som',
      'cham_cong_thieu',
      'nghi_lam',
      'nghi_phep'
    ],
    default: 'chua_cham_cong'
  },

  nguon_cham_cong: {
    type: String,
    enum: ['thu_cong', 'tu_dong', 'may_cham_cong', 'zalo'],
    default: 'thu_cong'
  },

  da_duyet: {
    type: Boolean,
    default: false
  },

  nguoi_duyet_id: {
    type: ObjectId,
    ref: 'NguoiDung'
  },

  ngay_duyet: {
    type: Date
  },

  nguoi_tao_id: {
    type: ObjectId,
    ref: 'NguoiDung'
  },

  ghi_chu: {
    type: String
  }
}, {
  collection: 'cham_cong',
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  }
});

ChamCongSchema.index({
  cua_hang_id: 1,
  ngay_cham_cong: 1
});

ChamCongSchema.index({
  cua_hang_id: 1,
  nhan_vien_id: 1,
  ngay_cham_cong: 1
});

ChamCongSchema.index(
  { cua_hang_id: 1, lich_lam_viec_id: 1 },
  { unique: true, sparse: true }
);

/**
 * BANG LUONG
 */
const BangLuongSchema = new Schema({
  cua_hang_id: {
    type: ObjectId,
    ref: 'CuaHang',
    required: true
  },

  ma_bang_luong: {
    type: String,
    trim: true
  },

  ten_bang_luong: {
    type: String,
    required: true,
    trim: true
  },

  tu_ngay: {
    type: Date,
    required: true
  },

  den_ngay: {
    type: Date,
    required: true
  },

  tong_nhan_vien: { type: Number, default: 0, min: 0 },
  tong_cong: { type: Number, default: 0, min: 0 },
  tong_phut_lam_viec: { type: Number, default: 0, min: 0 },
  tong_phut_tang_ca: { type: Number, default: 0, min: 0 },

  tong_luong_chinh: { type: Number, default: 0, min: 0 },
  tong_tien_tang_ca: { type: Number, default: 0, min: 0 },
  tong_thuong: { type: Number, default: 0, min: 0 },
  tong_hoa_hong: { type: Number, default: 0, min: 0 },
  tong_phu_cap: { type: Number, default: 0, min: 0 },
  tong_giam_tru: { type: Number, default: 0, min: 0 },

  tong_luong: { type: Number, default: 0 },
  da_tra_nhan_vien: { type: Number, default: 0, min: 0 },
  con_can_tra: { type: Number, default: 0 },

  trang_thai: {
    type: String,
    enum: ['draft', 'calculated', 'locked', 'cancelled'],
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
    type: String
  }
}, {
  collection: 'bang_luong',
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  }
});

BangLuongSchema.index(
  { cua_hang_id: 1, ma_bang_luong: 1 },
  { unique: true, sparse: true }
);

BangLuongSchema.index({
  cua_hang_id: 1,
  tu_ngay: 1,
  den_ngay: 1
});

BangLuongSchema.index({
  cua_hang_id: 1,
  trang_thai: 1
});

/**
 * CHI TIET BANG LUONG
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

  ma_nhan_vien: { type: String, trim: true },
  ten_nhan_vien: { type: String, trim: true },
  phong_ban_id: { type: ObjectId, ref: 'PhongBan' },
  chuc_danh_id: { type: ObjectId, ref: 'ChucDanh' },

  tu_ngay: { type: Date },
  den_ngay: { type: Date },

  tong_ca: { type: Number, default: 0, min: 0 },
  tong_cong_quy_doi: { type: Number, default: 0, min: 0 },
  tong_phut_lam_viec: { type: Number, default: 0, min: 0 },
  tong_phut_tang_ca: { type: Number, default: 0, min: 0 },
  tong_phut_tang_ca_truoc_ca: { type: Number, default: 0, min: 0 },
  tong_phut_tang_ca_sau_ca: { type: Number, default: 0, min: 0 },
  so_lan_di_muon: { type: Number, default: 0, min: 0 },
  so_lan_ve_som: { type: Number, default: 0, min: 0 },
  so_lan_nghi_lam: { type: Number, default: 0, min: 0 },

  luong_chinh: { type: Number, default: 0, min: 0 },
  tien_tang_ca: { type: Number, default: 0, min: 0 },
  tien_thuong: { type: Number, default: 0, min: 0 },
  tien_hoa_hong: { type: Number, default: 0, min: 0 },
  tien_phu_cap: { type: Number, default: 0, min: 0 },
  tien_giam_tru: { type: Number, default: 0, min: 0 },

  tong_luong: { type: Number, default: 0 },
  da_tra: { type: Number, default: 0, min: 0 },
  con_can_tra: { type: Number, default: 0 },

  snapshot_salary_setup: {
    type: Schema.Types.Mixed
  },

  snapshot_cham_cong_ids: [{
    type: ObjectId,
    ref: 'ChamCong'
  }],

  trang_thai: {
    type: String,
    enum: ['draft', 'calculated', 'locked', 'cancelled'],
    default: 'calculated'
  },

  ghi_chu: {
    type: String
  }
}, {
  collection: 'ct_bang_luong',
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  }
});

ChiTietBangLuongSchema.index(
  { bang_luong_id: 1, nhan_vien_id: 1 },
  { unique: true }
);

ChiTietBangLuongSchema.index({
  cua_hang_id: 1,
  nhan_vien_id: 1
});

ChiTietBangLuongSchema.index({
  cua_hang_id: 1,
  tu_ngay: 1,
  den_ngay: 1
});

/**
 * MODEL
 */

const PhongBan =
  mongoose.models.PhongBan ||
  mongoose.model('PhongBan', PhongBanSchema);

const ChucDanh =
  mongoose.models.ChucDanh ||
  mongoose.model('ChucDanh', ChucDanhSchema);

const NhanVien =
  mongoose.models.NhanVien ||
  mongoose.model('NhanVien', NhanVienSchema);

const CaLamViec =
  mongoose.models.CaLamViec ||
  mongoose.model('CaLamViec', CaLamViecSchema);

const NgayLamViecCuaHang =
  mongoose.models.NgayLamViecCuaHang ||
  mongoose.model('NgayLamViecCuaHang', NgayLamViecCuaHangSchema);

const NgayLeTet =
  mongoose.models.NgayLeTet ||
  mongoose.model('NgayLeTet', NgayLeTetSchema);

const LichLamViec =
  mongoose.models.LichLamViec ||
  mongoose.model('LichLamViec', LichLamViecSchema);

const ChamCong =
  mongoose.models.ChamCong ||
  mongoose.model('ChamCong', ChamCongSchema);

const BangLuong =
  mongoose.models.BangLuong ||
  mongoose.model('BangLuong', BangLuongSchema);

const ChiTietBangLuong =
  mongoose.models.ChiTietBangLuong ||
  mongoose.model('ChiTietBangLuong', ChiTietBangLuongSchema);

module.exports = {
  PhongBan,
  ChucDanh,
  NhanVien,
  CaLamViec,
  NgayLamViecCuaHang,
  NgayLeTet,
  LichLamViec,
  ChamCong,
  BangLuong,
  ChiTietBangLuong
};
