var db = require('./db.model');
const mongoose = db.mongoose;
const Schema = mongoose.Schema;
const ObjectId = Schema.Types.ObjectId;

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

  dia_chi_ncc_id: {
    type: ObjectId,
    ref: 'DiaChiNcc'
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
    enum: ['', 'tien_mat', 'chuyen_khoan', 'cong_no'],
    default: ''
  },

  // Container selection is retained on drafts without creating stock or cash.
  vat_chua_config: { type: Schema.Types.Mixed, default: undefined },
  vat_chua_request_key: { type: String, trim: true, maxlength: 120 },

  trang_thai: {
    type: String,
    enum: ['draft', 'completed', 'cancelled', 'merged'],
    default: 'draft'
  },

  trang_thai_du_lieu: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active'
  },

  is_merged_purchase: {
    type: Boolean,
    default: false
  },
  merged_to_phieu_nhap_id: {
    type: ObjectId,
    ref: 'PhieuNhap',
    default: null
  },
  merged_to_ma_phieu_nhap: {
    type: String,
    default: ''
  },
  merged_from_phieu_nhap_ids: [{
    type: ObjectId,
    ref: 'PhieuNhap'
  }],
  merged_from_ma_phieu_nhaps: [{
    type: String
  }],
  merged_at: {
    type: Date
  },
  merged_by: {
    type: ObjectId,
    ref: 'NguoiDung'
  },
  merge_note: {
    type: String
  },

  /** Hạn trả hàng nhập tuyệt đối (cuối ngày được tính khi kiểm tra) */
  han_tra_hang_nhap: {
    type: Date
  },

  /** Số ngày được trả kể từ ngày nhập (ưu tiên thấp hơn han_tra_hang_nhap); mặc định hệ thống nếu bỏ trống */
  so_ngay_duoc_tra_hang_nhap: {
    type: Number,
    min: 0
  },

  ghi_chu: {
    type: String
  },
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
  gia_tri_thuoc_tinh_id: {
    type: ObjectId,
    ref: 'GiaTriThuocTinh'
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
  },
  lot_info: {
    type: Schema.Types.Mixed
  }
}, {
  collection: 'ct_phieu_nhap',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});
CtPhieuNhapSchema.index(
  { phieu_nhap_id: 1, hang_hoa_id: 1 }
);
const GopPhieuNhapSchema = new Schema({
  ma_gop_phieu_nhap: {
    type: String,
    unique: true
  },
  cua_hang_id: {
    type: ObjectId,
    ref: 'CuaHang',
    required: true,
    index: true
  },
  phieu_nhan_id: {
    type: ObjectId,
    ref: 'PhieuNhap',
    required: true,
    index: true
  },
  ma_phieu_nhan: {
    type: String
  },
  nha_cung_cap_id: {
    type: ObjectId,
    ref: 'NhaCungCap',
    index: true
  },
  phieu_nguon_ids: [{
    type: ObjectId,
    ref: 'PhieuNhap'
  }],
  ma_phieu_nguon: [{
    type: String
  }],
  tong_tien_hang_truoc_gop: {
    type: Number,
    default: 0
  },
  tong_da_tra_truoc_gop: {
    type: Number,
    default: 0
  },
  tong_tien_hang_sau_gop: {
    type: Number,
    default: 0
  },
  tong_da_tra_sau_gop: {
    type: Number,
    default: 0
  },
  so_luong_phieu_gop: {
    type: Number,
    default: 0
  },
  ghi_chu: {
    type: String
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
  ngay_gop: {
    type: Date,
    default: Date.now
  }
}, {
  collection: 'gop_phieu_nhap',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});
GopPhieuNhapSchema.index({ cua_hang_id: 1, ma_gop_phieu_nhap: 1 }, { unique: true });
GopPhieuNhapSchema.index({ cua_hang_id: 1, nha_cung_cap_id: 1, ngay_gop: -1 });
GopPhieuNhapSchema.index({ phieu_nhan_id: 1 });
GopPhieuNhapSchema.index({ phieu_nguon_ids: 1 });

// Historical receiving-purchase merge fields above are retained for reconciliation.
// New groups reference source purchases and never create purchase/stock/debt rows.
const PhieuNhapTongHopSchema = new Schema({
  ma_phieu_tong_hop: { type: String, required: true, trim: true, unique: true },
  cua_hang_id: { type: ObjectId, ref: 'CuaHang', required: true },
  kho_id: { type: ObjectId, ref: 'Kho', required: true },
  nha_cung_cap_id: { type: ObjectId, ref: 'NhaCungCap', required: true },
  phieu_nguon_ids: {
    type: [{ type: ObjectId, ref: 'PhieuNhap' }],
    required: true,
    validate: {
      validator: function(ids) {
        return Array.isArray(ids) && ids.length >= 2
          && new Set(ids.map(function(id) { return String(id); })).size === ids.length;
      },
      message: 'Phiếu tổng hợp phải có ít nhất hai phiếu nguồn khác nhau.'
    }
  },
  ngay_gop: { type: Date, default: Date.now },
  nguoi_tao_id: { type: ObjectId, ref: 'NguoiDung', required: true },
  ghi_chu: { type: String, trim: true, default: '' },
  trang_thai: { type: String, enum: ['active', 'cancelled'], default: 'active', required: true },
  nguoi_huy_id: { type: ObjectId, ref: 'NguoiDung' },
  ngay_huy: { type: Date },
  ly_do_huy: { type: String, trim: true }
}, {
  collection: 'phieu_nhap_tong_hop',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});
PhieuNhapTongHopSchema.index(
  { cua_hang_id: 1, phieu_nguon_ids: 1 },
  { unique: true, name: 'uq_purchase_group_active_source', partialFilterExpression: { trang_thai: 'active' } }
);
PhieuNhapTongHopSchema.index({ cua_hang_id: 1, ngay_gop: -1 });

const PhieuNhap = mongoose.models.PhieuNhap || mongoose.model("PhieuNhap", PhieuNhapSchema);
const CTPhieuNhap = mongoose.models.CTPhieuNhap || mongoose.model("CTPhieuNhap", CtPhieuNhapSchema);
const GopPhieuNhap = mongoose.models.GopPhieuNhap || mongoose.model("GopPhieuNhap", GopPhieuNhapSchema);
const PhieuNhapTongHop = mongoose.models.PhieuNhapTongHop || mongoose.model('PhieuNhapTongHop', PhieuNhapTongHopSchema);

module.exports = { 
    PhieuNhap, CTPhieuNhap, GopPhieuNhap, PhieuNhapTongHop
};
