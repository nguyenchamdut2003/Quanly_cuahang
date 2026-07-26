var db = require('../models/db.model');

exports.resetData = async function(req, res, next) {
  try {
    if (typeof req.isAuthenticated !== 'function' || !req.isAuthenticated()) {
      return res.status(401).json({ success: false, message: 'Vui lòng đăng nhập.' });
    }

    await db.connectDB();
    if (!db.mongoose.connection.db) {
      return res.status(500).json({ success: false, message: 'Chưa kết nối cơ sở dữ liệu.' });
    }

    await db.mongoose.connection.db.dropDatabase();

    if (req.session) {
      return req.session.destroy(function(error) {
        if (error) return next(error);
        res.clearCookie('connect.sid');
        return res.json({ success: true, redirect: '/' });
      });
    }

    return res.json({ success: true, redirect: '/' });
  } catch (error) {
    next(error);
  }
};
