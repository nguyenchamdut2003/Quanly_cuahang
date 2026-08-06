const {
  DiaChiNhaCungCap,
  LoaiDiaChiKhachHang,
  loadAddressTypes,
  makeAddressTypeCode,
  mongoose,
  normalizeAddressTypeCode,
  normalizeIdParam,
  respondAddressTypeError,
  shouldRespondJson,
} = require("./helpers/common.helper");

exports.addAddressType = async function (req, res, next) {
  try {
    if (!LoaiDiaChiKhachHang)
      return respondAddressTypeError(
        req,
        res,
        500,
        "Chưa cấu hình model loại địa chỉ.",
      );
    var tenLoai = String(req?.body?.ten_loai || "").trim();
    var maLoai = normalizeAddressTypeCode(req?.body?.ma_loai || tenLoai);
    if (!tenLoai)
      return respondAddressTypeError(
        req,
        res,
        400,
        "Vui lòng nhập tên loại địa chỉ.",
      );
    if (!maLoai) maLoai = await makeAddressTypeCode(tenLoai);
    if (await LoaiDiaChiKhachHang.exists({ ma_loai: maLoai }))
      maLoai = await makeAddressTypeCode(tenLoai);

    var created = await LoaiDiaChiKhachHang.create({
      ma_loai: maLoai,
      ten_loai: tenLoai,
      trang_thai: "active",
    });

    if (shouldRespondJson(req)) {
      return res.json({
        success: true,
        message: "Đã thêm loại địa chỉ.",
        data: created,
        selectedCode: created.ma_loai,
        addressTypes: await loadAddressTypes(),
      });
    }

    res.redirect("/nha-cung-cap?success=created_address_type");
  } catch (error) {
    console.error(
      "[AddressType] add failed:",
      error && error.message ? error.message : error,
    );
    if (error && error.code === 11000)
      return respondAddressTypeError(req, res, 409, "Loại địa chỉ đã tồn tại.");
    if (shouldRespondJson(req)) {
      return res
        .status(500)
        .json({
          success: false,
          message:
            error && error.message
              ? error.message
              : "Có lỗi khi xử lý loại địa chỉ.",
        });
    }
    next(error);
  }
};

exports.updateAddressType = async function (req, res, next) {
  try {
    if (!LoaiDiaChiKhachHang)
      return respondAddressTypeError(
        req,
        res,
        500,
        "Chưa cấu hình model loại địa chỉ.",
      );
    var typeId = normalizeIdParam(req?.params?.typeId);
    if (!typeId || !mongoose.Types.ObjectId.isValid(typeId)) {
      return respondAddressTypeError(
        req,
        res,
        400,
        "Loại địa chỉ không hợp lệ.",
      );
    }

    var tenLoai = String(req?.body?.ten_loai || "").trim();
    if (!tenLoai)
      return respondAddressTypeError(
        req,
        res,
        400,
        "Vui lòng nhập tên loại địa chỉ.",
      );

    var updated = await LoaiDiaChiKhachHang.findByIdAndUpdate(
      typeId,
      { ten_loai: tenLoai, trang_thai: "active" },
      { runValidators: true, new: true },
    );
    if (!updated)
      return respondAddressTypeError(
        req,
        res,
        404,
        "Không tìm thấy loại địa chỉ.",
      );

    if (shouldRespondJson(req)) {
      return res.json({
        success: true,
        message: "Đã cập nhật loại địa chỉ.",
        data: updated,
        selectedCode: updated.ma_loai,
        addressTypes: await loadAddressTypes(),
      });
    }

    res.redirect("/nha-cung-cap?success=updated_address_type");
  } catch (error) {
    console.error(
      "[AddressType] update failed:",
      error && error.message ? error.message : error,
    );
    if (error && error.code === 11000)
      return respondAddressTypeError(
        req,
        res,
        409,
        "Tên loại địa chỉ đã tồn tại.",
      );
    if (shouldRespondJson(req)) {
      return res
        .status(500)
        .json({
          success: false,
          message:
            error && error.message
              ? error.message
              : "Có lỗi khi xử lý loại địa chỉ.",
        });
    }
    next(error);
  }
};

exports.removeAddressType = async function (req, res, next) {
  try {
    if (!LoaiDiaChiKhachHang)
      return respondAddressTypeError(
        req,
        res,
        500,
        "Chưa cấu hình model loại địa chỉ.",
      );
    var typeId = normalizeIdParam(req?.params?.typeId);
    if (!typeId || !mongoose.Types.ObjectId.isValid(typeId)) {
      return respondAddressTypeError(
        req,
        res,
        400,
        "Loại địa chỉ không hợp lệ.",
      );
    }

    var type = await LoaiDiaChiKhachHang.findById(typeId).lean();
    if (!type)
      return respondAddressTypeError(
        req,
        res,
        404,
        "Không tìm thấy loại địa chỉ.",
      );
    if (String(type.ma_loai || "") === "khac") {
      return respondAddressTypeError(
        req,
        res,
        400,
        "Không thể xóa loại địa chỉ mặc định.",
      );
    }

    await DiaChiNhaCungCap.updateMany(
      { loai_dia_chi: type.ma_loai },
      { $set: { loai_dia_chi: "khac" } },
    );
    await LoaiDiaChiKhachHang.findByIdAndDelete(typeId);

    if (shouldRespondJson(req)) {
      return res.json({
        success: true,
        message: "Đã xóa loại địa chỉ.",
        selectedCode: "khac",
        addressTypes: await loadAddressTypes(),
      });
    }

    res.redirect("/nha-cung-cap?success=deleted_address_type");
  } catch (error) {
    console.error(
      "[AddressType] delete failed:",
      error && error.message ? error.message : error,
    );
    if (shouldRespondJson(req)) {
      return res
        .status(500)
        .json({
          success: false,
          message:
            error && error.message
              ? error.message
              : "Có lỗi khi xử lý loại địa chỉ.",
        });
    }
    next(error);
  }
};
