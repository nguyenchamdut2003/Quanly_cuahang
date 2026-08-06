const {
  DiaChiNhaCungCap,
  mongoose,
  normalizeIdParam,
  normalizeSupplierAddressPayload,
} = require("./helpers/common.helper");
const { buildSupplierReturnUrl } = require("./helpers/detail.helper");
const { makeSupplierAddressCode } = require("./helpers/excel.helper");

exports.listAddresses = async function (req, res, next) {
  try {
    var supplierId = normalizeIdParam(req?.params?.id);
    if (!supplierId || !mongoose.Types.ObjectId.isValid(supplierId)) {
      return res
        .status(400)
        .json({ success: false, message: "invalid_supplier" });
    }

    var addresses = await DiaChiNhaCungCap.find({ nha_cung_cap_id: supplierId })
      .sort({ created_at: -1 })
      .lean();
    res.json({ success: true, data: addresses });
  } catch (error) {
    next(error);
  }
};

exports.addAddress = async function (req, res, next) {
  try {
    var supplierId = normalizeIdParam(req?.params?.id);
    if (!supplierId || !mongoose.Types.ObjectId.isValid(supplierId)) {
      return res.redirect("/nha-cung-cap?error=invalid_supplier");
    }

    var payload = normalizeSupplierAddressPayload(req?.body);
    if (
      !payload.ten_nguoi_nhan &&
      !payload.sdt_nguoi_nhan &&
      !payload.dia_chi_day_du
    ) {
      return res.redirect(
        buildSupplierReturnUrl(supplierId, req?.body?.returnQuery, {
          error: "missing_address_data",
        }),
      );
    }

    if (!payload.ma_dia_chi)
      payload.ma_dia_chi = await makeSupplierAddressCode();
    if (!payload.loai_dia_chi) payload.loai_dia_chi = "khac";
    payload.nha_cung_cap_id = supplierId;

    if (payload.mac_dinh) {
      await DiaChiNhaCungCap.updateMany(
        { nha_cung_cap_id: supplierId },
        { $set: { mac_dinh: false } },
      );
    }

    await DiaChiNhaCungCap.create(payload);
    res.redirect(
      buildSupplierReturnUrl(supplierId, req?.body?.returnQuery, {
        success: "created_address",
      }),
    );
  } catch (error) {
    if (error && error.code === 11000) {
      return res.redirect(
        "/nha-cung-cap?error=duplicate_address_code#s-" +
          normalizeIdParam(req?.params?.id),
      );
    }
    next(error);
  }
};

exports.updateAddress = async function (req, res, next) {
  try {
    var addressId = normalizeIdParam(req?.params?.addressId);
    if (!addressId || !mongoose.Types.ObjectId.isValid(addressId)) {
      return res.redirect("/nha-cung-cap?error=invalid_address");
    }

    var existingAddress = await DiaChiNhaCungCap.findById(addressId).lean();
    if (!existingAddress)
      return res.redirect("/nha-cung-cap?error=invalid_address");
    var supplierId = String(existingAddress.nha_cung_cap_id || "");

    var payload = normalizeSupplierAddressPayload(req?.body);
    if (
      !payload.ten_nguoi_nhan &&
      !payload.sdt_nguoi_nhan &&
      !payload.dia_chi_day_du
    ) {
      return res.redirect(
        buildSupplierReturnUrl(supplierId, req?.body?.returnQuery, {
          error: "missing_address_data",
        }),
      );
    }

    if (!payload.ma_dia_chi) delete payload.ma_dia_chi;
    if (!payload.loai_dia_chi) payload.loai_dia_chi = "khac";

    if (payload.mac_dinh) {
      await DiaChiNhaCungCap.updateMany(
        { nha_cung_cap_id: supplierId, _id: { $ne: addressId } },
        { $set: { mac_dinh: false } },
      );
    }

    await DiaChiNhaCungCap.findByIdAndUpdate(addressId, payload, {
      runValidators: true,
    });
    res.redirect(
      buildSupplierReturnUrl(supplierId, req?.body?.returnQuery, {
        success: "updated_address",
      }),
    );
  } catch (error) {
    if (error && error.code === 11000) {
      return res.redirect("/nha-cung-cap?error=duplicate_address_code");
    }
    next(error);
  }
};

exports.removeAddress = async function (req, res, next) {
  try {
    var addressId = normalizeIdParam(req?.params?.addressId);
    if (!addressId || !mongoose.Types.ObjectId.isValid(addressId)) {
      return res.redirect("/nha-cung-cap?error=invalid_address");
    }

    var existingAddress = await DiaChiNhaCungCap.findById(addressId).lean();
    if (!existingAddress)
      return res.redirect("/nha-cung-cap?error=invalid_address");
    var supplierId = String(existingAddress.nha_cung_cap_id || "");

    await DiaChiNhaCungCap.findByIdAndDelete(addressId);
    res.redirect(
      buildSupplierReturnUrl(supplierId, req?.body?.returnQuery, {
        success: "deleted_address",
      }),
    );
  } catch (error) {
    next(error);
  }
};
