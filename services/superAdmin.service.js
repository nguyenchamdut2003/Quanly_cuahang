var bcrypt = require('bcrypt');
var { CuaHang, NguoiDung } = require('../models/kiot.model');
var {
  DanhMucKhoanNop,
  NoiNopKhoanNop
} = require('../models/chamcong.model');

var SUPER_ADMIN_USERNAME = 'tuananhadmin';
var SUPER_ADMIN_LOGIN = 'Tuananhadmin';
var SUPER_ADMIN_PASSWORD = 'admin';
var SALT_ROUNDS = 12;

var DEFAULT_CONTRIBUTION_PLACES = {
  bao_hiem: {
    ma_noi_nop: 'BH',
    ten_noi_nop: 'Bảo hiểm'
  },
  cong_doan: {
    ma_noi_nop: 'CD',
    ten_noi_nop: 'Công đoàn'
  }
};

var DEFAULT_CONTRIBUTIONS = [
  {
    ma_khoan: 'BHXH',
    ten_khoan: 'Bảo hiểm xã hội',
    place: 'bao_hiem',
    ti_le_nld: 8,
    ti_le_nsdld: 17.5
  },
  {
    ma_khoan: 'BHYT',
    ten_khoan: 'Bảo hiểm y tế',
    place: 'bao_hiem',
    ti_le_nld: 1.5,
    ti_le_nsdld: 3
  },
  {
    ma_khoan: 'BHTN',
    ten_khoan: 'Bảo hiểm thất nghiệp',
    place: 'bao_hiem',
    ti_le_nld: 1,
    ti_le_nsdld: 1
  },
  {
    ma_khoan: 'CONGDOAN',
    ten_khoan: 'Công đoàn',
    place: 'cong_doan',
    ti_le_nld: 1,
    ti_le_nsdld: 2
  }
];

async function ensureContributionPlace(storeId, placeKey) {
  var place = DEFAULT_CONTRIBUTION_PLACES[placeKey] || DEFAULT_CONTRIBUTION_PLACES.bao_hiem;
  var existing = await NoiNopKhoanNop.findOne({
    cua_hang_id: storeId,
    ma_noi_nop: place.ma_noi_nop
  });
  if (existing) {
    var changed = false;
    if (!existing.ten_noi_nop) {
      existing.ten_noi_nop = place.ten_noi_nop;
      changed = true;
    }
    if (existing.trang_thai !== 'active') {
      existing.trang_thai = 'active';
      changed = true;
    }
    if (changed) await existing.save();
    return existing;
  }

  return NoiNopKhoanNop.create({
    cua_hang_id: storeId,
    ma_noi_nop: place.ma_noi_nop,
    ten_noi_nop: place.ten_noi_nop,
    trang_thai: 'active'
  });
}

async function seedDefaultContributionsForStore(storeId) {
  var placeCache = {};
  for (var i = 0; i < DEFAULT_CONTRIBUTIONS.length; i += 1) {
    var item = DEFAULT_CONTRIBUTIONS[i];
    if (!placeCache[item.place]) {
      placeCache[item.place] = await ensureContributionPlace(storeId, item.place);
    }

    await DanhMucKhoanNop.updateOne(
      {
        cua_hang_id: storeId,
        ma_khoan: item.ma_khoan
      },
      {
        $setOnInsert: {
          cua_hang_id: storeId,
          ma_khoan: item.ma_khoan,
          ten_khoan: item.ten_khoan,
          noi_nop_id: placeCache[item.place]._id,
          ti_le_nld: item.ti_le_nld,
          ti_le_nsdld: item.ti_le_nsdld,
          ti_le: item.ti_le_nld,
          trang_thai: 'active'
        }
      },
      { upsert: true, runValidators: true }
    );
  }
}

async function seedDefaultContributions() {
  var stores = await CuaHang.find({}).select('_id').lean();
  for (var i = 0; i < stores.length; i += 1) {
    await seedDefaultContributionsForStore(stores[i]._id);
  }
}

async function ensureSuperAdminAccount() {
  var user = await NguoiDung.findOne({ email: SUPER_ADMIN_USERNAME }).select('+password_hash');
  if (user) {
    var changed = false;
    if (user.vai_tro !== 'super_admin') {
      user.vai_tro = 'super_admin';
      changed = true;
    }
    if (user.trang_thai !== 'active') {
      user.trang_thai = 'active';
      changed = true;
    }
    if (!user.password_hash) {
      user.password_hash = await bcrypt.hash(SUPER_ADMIN_PASSWORD, SALT_ROUNDS);
      user.must_change_password = true;
      changed = true;
    }
    if (changed) await user.save();
    return user;
  }

  var passwordHash = await bcrypt.hash(SUPER_ADMIN_PASSWORD, SALT_ROUNDS);
  var createdUser = await NguoiDung.create({
    cua_hang_id: null,
    email: SUPER_ADMIN_USERNAME,
    password_hash: passwordHash,
    ho_ten: SUPER_ADMIN_LOGIN,
    vai_tro: 'super_admin',
    trang_thai: 'active',
    must_change_password: true
  });
  await seedDefaultContributions();
  return createdUser;
}

function isSuperAdminLogin(value) {
  return String(value || '').trim().toLowerCase() === SUPER_ADMIN_USERNAME;
}

module.exports = {
  SUPER_ADMIN_LOGIN: SUPER_ADMIN_LOGIN,
  SUPER_ADMIN_PASSWORD: SUPER_ADMIN_PASSWORD,
  ensureSuperAdminAccount: ensureSuperAdminAccount,
  isSuperAdminLogin: isSuperAdminLogin
};
