exports.status = async function(req, res, next) {
  try {
    res.status(200).json({ status: 'ok' });
  } catch (error) {
    next(error);
  }
};
