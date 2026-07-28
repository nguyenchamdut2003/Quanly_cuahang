var db = require('./db.model');
var mongoose = db.mongoose;
var Schema = mongoose.Schema;
var ObjectId = Schema.Types.ObjectId;

var PasswordResetRequestSchema = new Schema({
  user_id: { type: ObjectId, ref: 'NguoiDung', default: null, index: true },
  email_normalized: { type: String, required: true, trim: true, lowercase: true, index: true },
  code_hash: { type: String, required: true, select: false },
  expires_at: { type: Date, required: true, index: true },
  resend_after: { type: Date, required: true },
  attempts: { type: Number, default: 0 },
  max_attempts: { type: Number, default: 5 },
  verified_at: { type: Date, default: null },
  used_at: { type: Date, default: null },
  created_at: { type: Date, default: Date.now }
}, {
  collection: 'password_reset_requests'
});

PasswordResetRequestSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });
PasswordResetRequestSchema.index({ user_id: 1, used_at: 1, expires_at: 1 });

module.exports = mongoose.models.PasswordResetRequest
  || mongoose.model('PasswordResetRequest', PasswordResetRequestSchema);
