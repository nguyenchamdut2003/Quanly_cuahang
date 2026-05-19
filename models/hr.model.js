var db = require('./db.model');
const mongoose = db.mongoose;
const Schema = mongoose.Schema;
const ObjectId = Schema.Types.ObjectId;

const PhongBanSchema = new Schema({
  cua_hang_id: { type: ObjectId, ref: 'CuaHang', required: true },
  ma_phong_ban: { type: String },
  ten_phong_ban: { type: String, required: true },
  mo_ta: { type: String },
  trang_thai: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active'
  }
}, {
  collection: 'phong_ban',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});
PhongBanSchema.index({ cua_hang_id: 1, ma_phong_ban: 1 }, { unique: true, sparse: true });

const ChucDanhSchema = new Schema({
  cua_hang_id: { type: ObjectId, ref: 'CuaHang', required: true },
  ma_chuc_danh: { type: String },
  ten_chuc_danh: { type: String, required: true },
  mo_ta: { type: String },
  trang_thai: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active'
  }
}, {
  collection: 'chuc_danh',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});
ChucDanhSchema.index({ cua_hang_id: 1, ma_chuc_danh: 1 }, { unique: true, sparse: true });

const NhanVienSchema = new Schema({
  cua_hang_id: { type: ObjectId, ref: 'CuaHang', required: true },
  ma_nhan_vien: { type: String },
  ma_cham_cong: { type: String },
  ten_nhan_vien: { type: String, required: true },
  anh_dai_dien: { type: String },
  sdt: { type: String },
  email: { type: String },
  cccd: { type: String },
  ngay_sinh: { type: Date },
  gioi_tinh: { type: String, enum: ['nam', 'nu', 'khac'] },
  phong_ban_id: { type: ObjectId, ref: 'PhongBan' },
  chuc_danh_id: { type: ObjectId, ref: 'ChucDanh' },
  nguoi_dung_id: { type: ObjectId, ref: 'NguoiDung' },
  ngay_bat_dau_lam_viec: { type: Date },
  ngay_nghi_viec: { type: Date },
  tinh_thanh: { type: String },
  phuong_xa: { type: String },
  dia_chi_chi_tiet: { type: String },
  dia_chi_day_du: { type: String },
  facebook: { type: String },
  no_va_tam_ung: { type: Number, default: 0 },
  ghi_chu: { type: String },
  trang_thai: {
    type: String,
    enum: ['dang_lam_viec', 'da_nghi'],
    default: 'dang_lam_viec'
  }
}, {
  collection: 'nhan_vien',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});
NhanVienSchema.index({ cua_hang_id: 1, ma_nhan_vien: 1 }, { unique: true, sparse: true });

const PhongBan = mongoose.models.PhongBan || mongoose.model('PhongBan', PhongBanSchema);
const ChucDanh = mongoose.models.ChucDanh || mongoose.model('ChucDanh', ChucDanhSchema);
const NhanVien = mongoose.models.NhanVien || mongoose.model('NhanVien', NhanVienSchema);

module.exports = { PhongBan, ChucDanh, NhanVien };
