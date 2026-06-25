var db = require('./db.model');
var mongoose = db.mongoose;
var Schema = mongoose.Schema;
var ObjectId = Schema.Types.ObjectId;

var ChamCongMoiNhanVienSchema = new Schema({
  cua_hang_id: {
    type: ObjectId,
    ref: 'CuaHang',
    required: true
  },
  ma_nhan_vien: {
    type: String,
    trim: true
  },
  ten_nhan_vien: {
    type: String,
    required: true,
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
    enum: ['nam', 'nu', 'khac', '']
  },
  chuc_vu: {
    type: String,
    trim: true
  },
  co_luong_theo_ngay: {
    type: Boolean,
    default: false
  },
  luong_theo_ngay: {
    type: Number,
    default: 0,
    min: 0
  },
  co_luong_theo_thang: {
    type: Boolean,
    default: false
  },
  luong_theo_thang: {
    type: Number,
    default: 0,
    min: 0
  },
  ngay_bat_dau_lam_viec: {
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
  collection: 'chamcongmoi_nhan_vien',
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  }
});

ChamCongMoiNhanVienSchema.index(
  { cua_hang_id: 1, ma_nhan_vien: 1 },
  { unique: true, sparse: true }
);
ChamCongMoiNhanVienSchema.index({ cua_hang_id: 1, ten_nhan_vien: 1 });
ChamCongMoiNhanVienSchema.index({ cua_hang_id: 1, sdt: 1 });
ChamCongMoiNhanVienSchema.index({ cua_hang_id: 1, email: 1 });
ChamCongMoiNhanVienSchema.index({ cua_hang_id: 1, cccd: 1 });
ChamCongMoiNhanVienSchema.index({ cua_hang_id: 1, trang_thai: 1 });

var ChamCongMoiBanGhiSchema = new Schema({
  cua_hang_id: {
    type: ObjectId,
    ref: 'CuaHang',
    required: true
  },
  nhan_vien_id: {
    type: ObjectId,
    ref: 'ChamCongMoiNhanVien',
    required: true
  },
  ngay_cham_cong: {
    type: Date,
    required: true
  },
  gio_vao: {
    type: String,
    trim: true
  },
  gio_ra: {
    type: String,
    trim: true
  },
  dong_y: {
    type: Boolean,
    default: false
  },
  ghi_chu: {
    type: String,
    trim: true
  }
}, {
  collection: 'chamcongmoi_ban_ghi',
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  }
});

ChamCongMoiBanGhiSchema.index(
  { cua_hang_id: 1, nhan_vien_id: 1, ngay_cham_cong: 1 },
  { unique: true }
);
ChamCongMoiBanGhiSchema.index({ cua_hang_id: 1, ngay_cham_cong: 1 });

var ChamCongMoiThangSchema = new Schema({
  cua_hang_id: {
    type: ObjectId,
    ref: 'CuaHang',
    required: true
  },
  nhan_vien_id: {
    type: ObjectId,
    ref: 'ChamCongMoiNhanVien',
    required: true
  },
  thang_cham_cong: {
    type: String,
    required: true,
    trim: true
  },
  dong_y: {
    type: Boolean,
    default: false
  },
  ghi_chu: {
    type: String,
    trim: true
  }
}, {
  collection: 'chamcongmoi_thang',
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  }
});

ChamCongMoiThangSchema.index(
  { cua_hang_id: 1, nhan_vien_id: 1, thang_cham_cong: 1 },
  { unique: true }
);
ChamCongMoiThangSchema.index({ cua_hang_id: 1, thang_cham_cong: 1 });

var ChamCongMoiBangLuongSchema = new Schema({
  cua_hang_id: {
    type: ObjectId,
    ref: 'CuaHang',
    required: true
  },
  nhan_vien_id: {
    type: ObjectId,
    ref: 'ChamCongMoiNhanVien',
    required: true
  },
  ma_bang_luong: {
    type: String,
    trim: true
  },
  ma_nhan_vien: {
    type: String,
    trim: true
  },
  ten_nhan_vien: {
    type: String,
    trim: true
  },
  thang_bang_luong: {
    type: String,
    required: true,
    trim: true
  },
  loai_luong: {
    type: String,
    enum: ['ngay', 'thang'],
    required: true
  },
  so_ngay_cong: {
    type: Number,
    default: 0,
    min: 0
  },
  so_thang_cong: {
    type: Number,
    default: 0,
    min: 0
  },
  luong_theo_ngay: {
    type: Number,
    default: 0,
    min: 0
  },
  luong_theo_thang: {
    type: Number,
    default: 0,
    min: 0
  },
  tong_tien: {
    type: Number,
    default: 0,
    min: 0
  },
  trang_thai: {
    type: String,
    enum: ['can_thanh_toan', 'da_thanh_toan'],
    default: 'can_thanh_toan'
  }
}, {
  collection: 'chamcongmoi_bang_luong',
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  }
});

ChamCongMoiBangLuongSchema.index(
  { cua_hang_id: 1, nhan_vien_id: 1, thang_bang_luong: 1, loai_luong: 1 },
  { unique: true, name: 'uq_chamcongmoi_bang_luong_employee_month_type' }
);
ChamCongMoiBangLuongSchema.index(
  { cua_hang_id: 1, ma_bang_luong: 1 },
  { unique: true, sparse: true }
);
ChamCongMoiBangLuongSchema.index({ cua_hang_id: 1, thang_bang_luong: -1 });
ChamCongMoiBangLuongSchema.index({ cua_hang_id: 1, trang_thai: 1 });

var ChamCongMoiNhanVien =
  mongoose.models.ChamCongMoiNhanVien ||
  mongoose.model('ChamCongMoiNhanVien', ChamCongMoiNhanVienSchema);

var ChamCongMoiBanGhi =
  mongoose.models.ChamCongMoiBanGhi ||
  mongoose.model('ChamCongMoiBanGhi', ChamCongMoiBanGhiSchema);

var ChamCongMoiThang =
  mongoose.models.ChamCongMoiThang ||
  mongoose.model('ChamCongMoiThang', ChamCongMoiThangSchema);

var ChamCongMoiBangLuong =
  mongoose.models.ChamCongMoiBangLuong ||
  mongoose.model('ChamCongMoiBangLuong', ChamCongMoiBangLuongSchema);

module.exports = {
  ChamCongMoiNhanVien: ChamCongMoiNhanVien,
  ChamCongMoiBanGhi: ChamCongMoiBanGhi,
  ChamCongMoiThang: ChamCongMoiThang,
  ChamCongMoiBangLuong: ChamCongMoiBangLuong
};
