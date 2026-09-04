var db = require('./db.model');

const mongoose = db.mongoose;
const Schema = mongoose.Schema;
const ObjectId = Schema.Types.ObjectId;

const PhieuTamUngSchema = new Schema({
  ma_phieu: {
    type: String,
    trim: true,
    uppercase: true,
    required: true
  },

  cua_hang_id: {
    type: ObjectId,
    ref: 'CuaHang',
    required: true,
    index: true
  },

  loai_doi_tuong: {
    type: String,
    enum: ['khach_hang', 'nha_cung_cap'],
    required: true,
    index: true
  },

  khach_hang_id: {
    type: ObjectId,
    ref: 'KhachHang',
    default: null,
    index: true
  },

  nha_cung_cap_id: {
    type: ObjectId,
    ref: 'NhaCungCap',
    default: null,
    index: true
  },

  ngay_lap: {
    type: Date,
    default: Date.now,
    index: true
  },

  so_tien: {
    type: Number,
    required: true,
    min: 0,
    default: 0
  },

  da_can_tru: {
    type: Number,
    min: 0,
    default: 0
  },

  da_hoan: {
    type: Number,
    min: 0,
    default: 0
  },

  con_lai: {
    type: Number,
    min: 0,
    default: 0
  },

  phuong_thuc_thanh_toan: {
    type: String,
    enum: ['tien_mat', 'chuyen_khoan', 'vi_dien_tu', 'khac'],
    default: 'tien_mat'
  },

  // Phiếu thu (KH ứng) / phiếu chi (ứng NCC) khi tạo tạm ứng
  phieu_thu_chi_id: {
    type: ObjectId,
    ref: 'PhieuThuChi',
    default: null,
    index: true
  },

  trang_thai: {
    type: String,
    enum: ['active', 'da_dung_het', 'da_hoan', 'huy'],
    default: 'active',
    index: true
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
  },

  nguoi_huy_id: {
    type: ObjectId,
    ref: 'NguoiDung'
  },

  ngay_huy: {
    type: Date
  },

  ly_do_huy: {
    type: String,
    trim: true
  },

  trang_thai_du_lieu: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active',
    index: true
  }
}, {
  collection: 'phieu_tam_ung',
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  }
});

PhieuTamUngSchema.index(
  { cua_hang_id: 1, ma_phieu: 1 },
  { unique: true }
);

PhieuTamUngSchema.index({
  cua_hang_id: 1,
  loai_doi_tuong: 1,
  khach_hang_id: 1,
  ngay_lap: -1
});

PhieuTamUngSchema.index({
  cua_hang_id: 1,
  loai_doi_tuong: 1,
  nha_cung_cap_id: 1,
  ngay_lap: -1
});

PhieuTamUngSchema.index({
  cua_hang_id: 1,
  trang_thai: 1,
  con_lai: 1
});

PhieuTamUngSchema.pre('validate', function() {
  const loai = this.loai_doi_tuong;
  if (loai === 'khach_hang' && !this.khach_hang_id) {
    throw new Error('khach_hang_id là bắt buộc khi loai_doi_tuong = khach_hang');
  }
  if (loai === 'nha_cung_cap' && !this.nha_cung_cap_id) {
    throw new Error('nha_cung_cap_id là bắt buộc khi loai_doi_tuong = nha_cung_cap');
  }

  const soTien = Number(this.so_tien || 0);
  const daCanTru = Number(this.da_can_tru || 0);
  const daHoan = Number(this.da_hoan || 0);
  this.con_lai = Math.max(0, soTien - daCanTru - daHoan);

  if (this.trang_thai !== 'huy' && this.trang_thai !== 'da_hoan') {
    this.trang_thai = this.con_lai <= 0 ? 'da_dung_het' : 'active';
  }
});

const PhieuThanhToanTamUngSchema = new Schema({
  cua_hang_id: {
    type: ObjectId,
    ref: 'CuaHang',
    required: true,
    index: true
  },

  phieu_tam_ung_id: {
    type: ObjectId,
    ref: 'PhieuTamUng',
    required: true,
    index: true
  },

  // Phiếu thanh toán (PhieuThuChi) nhận phần trừ từ tạm ứng
  phieu_thanh_toan_id: {
    type: ObjectId,
    ref: 'PhieuThuChi',
    required: true,
    index: true
  },

  so_tien: {
    type: Number,
    required: true,
    min: [0.0001, 'so_tien phải lớn hơn 0']
  },

  ngay_giao_dich: {
    type: Date,
    default: Date.now,
    index: true
  },

  hoa_don_id: {
    type: ObjectId,
    ref: 'HoaDonBanHang',
    default: null
  },

  phieu_nhap_id: {
    type: ObjectId,
    ref: 'PhieuNhap',
    default: null
  },

  no_truoc_tam_ung: {
    type: Number,
    default: 0
  },

  no_sau_tam_ung: {
    type: Number,
    default: 0
  },

  ghi_chu: {
    type: String,
    trim: true
  },

  trang_thai: {
    type: String,
    enum: ['active', 'cancelled'],
    default: 'active',
    index: true
  },

  nguoi_tao_id: {
    type: ObjectId,
    ref: 'NguoiDung'
  },

  nguoi_huy_id: {
    type: ObjectId,
    ref: 'NguoiDung'
  },

  ngay_huy: {
    type: Date
  },

  ly_do_huy: {
    type: String,
    trim: true
  },

  trang_thai_du_lieu: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active',
    index: true
  }
}, {
  collection: 'phieu_thanh_toan_tam_ung',
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  }
});

PhieuThanhToanTamUngSchema.index({
  phieu_tam_ung_id: 1,
  ngay_giao_dich: -1
});

PhieuThanhToanTamUngSchema.index({
  phieu_thanh_toan_id: 1
});

PhieuThanhToanTamUngSchema.index({
  cua_hang_id: 1,
  ngay_giao_dich: -1
});

PhieuThanhToanTamUngSchema.index({
  hoa_don_id: 1
});

PhieuThanhToanTamUngSchema.index({
  phieu_nhap_id: 1
});

const PhieuTamUng =
  mongoose.models.PhieuTamUng ||
  mongoose.model('PhieuTamUng', PhieuTamUngSchema);

const PhieuThanhToanTamUng =
  mongoose.models.PhieuThanhToanTamUng ||
  mongoose.model('PhieuThanhToanTamUng', PhieuThanhToanTamUngSchema);

module.exports = {
  PhieuTamUng,
  PhieuThanhToanTamUng,
  PhieuTamUngSchema,
  PhieuThanhToanTamUngSchema
};
