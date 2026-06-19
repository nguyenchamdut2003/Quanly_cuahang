const mongoose = require('mongoose');
const { Schema, ObjectId } = mongoose;

const ThungRacItemSchema = new Schema({
  entity_type: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  entity_id: {
    type: ObjectId,
    required: true,
    index: true
  },
  ma_chung_tu: {
    type: String,
    default: '',
    trim: true
  },
  ten_hien_thi: {
    type: String,
    default: '',
    trim: true
  },
  mo_ta_phu: {
    type: String,
    default: '',
    trim: true
  },
  cua_hang_id: {
    type: ObjectId,
    ref: 'CuaHang',
    index: true
  },
  deleted_at: {
    type: Date,
    default: Date.now,
    index: true
  },
  deleted_by: {
    type: ObjectId,
    ref: 'NguoiDung',
    default: null
  },
  is_trash_root: {
    type: Boolean,
    default: true,
    index: true
  },
  trash_group_id: {
    type: ObjectId,
    ref: 'ThungRacItem',
    default: null,
    index: true
  },
  restored_at: {
    type: Date,
    default: null,
    index: true
  },
  sort_order: {
    type: Number,
    default: 0
  }
}, {
  collection: 'thung_rac',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

ThungRacItemSchema.index({ cua_hang_id: 1, restored_at: 1, deleted_at: -1 });
ThungRacItemSchema.index({ entity_type: 1, entity_id: 1 });

const ThungRacItem = mongoose.models.ThungRacItem || mongoose.model('ThungRacItem', ThungRacItemSchema);

module.exports = {
  ThungRacItem
};
