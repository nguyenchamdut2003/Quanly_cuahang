require('dotenv').config();

const { mongoose } = require('../models/db.model');
const { KhachHang, DiaChiKhachHang, NhaCungCap } = require('../models/kiot.model');

function isMissing(value) {
  return value == null || String(value).trim() === '';
}

function customerAddressNote(customer) {
  if (customer.loai_khach_hang === 'cong_ty' || customer.ten_cong_ty) {
    return 'Địa chỉ giao hàng';
  }
  return 'Địa chỉ nhà';
}

function supplierAddressNote(supplier) {
  const text = [
    supplier.ten_ncc,
    supplier.nhom_ncc,
    supplier.dia_chi_day_du,
    supplier.ghi_chu
  ].filter(Boolean).join(' ').toLowerCase();

  if (/vườn|vuon|farm|trại|trai|nông|nong|rau|thực phẩm|thuc pham|food/.test(text)) {
    return 'Địa chỉ vườn';
  }
  if (/kho|cơ sở|co so|đại lý|dai ly|cửa hàng|cua hang/.test(text)) {
    return 'Địa chỉ kho/cửa hàng';
  }
  return 'Địa chỉ giao hàng';
}

async function main() {
  const [customers, suppliers] = await Promise.all([
    KhachHang.find({
      $or: [
        { ghi_chu_dia_chi: { $exists: false } },
        { ghi_chu_dia_chi: null },
        { ghi_chu_dia_chi: '' }
      ]
    }),
    NhaCungCap.find({
      $or: [
        { ghi_chu_dia_chi: { $exists: false } },
        { ghi_chu_dia_chi: null },
        { ghi_chu_dia_chi: '' }
      ]
    })
  ]);

  let customerUpdated = 0;
  let addressUpdated = 0;
  let supplierUpdated = 0;

  for (const customer of customers) {
    const note = customerAddressNote(customer);
    customer.ghi_chu_dia_chi = note;
    await customer.save();
    customerUpdated += 1;

    const result = await DiaChiKhachHang.updateMany(
      {
        khach_hang_id: customer._id,
        $or: [
          { ghi_chu_dia_chi: { $exists: false } },
          { ghi_chu_dia_chi: null },
          { ghi_chu_dia_chi: '' }
        ]
      },
      { $set: { ghi_chu_dia_chi: note } }
    );
    addressUpdated += result.modifiedCount || 0;
  }

  const orphanAddressResult = await DiaChiKhachHang.updateMany(
    {
      $or: [
        { ghi_chu_dia_chi: { $exists: false } },
        { ghi_chu_dia_chi: null },
        { ghi_chu_dia_chi: '' }
      ]
    },
    { $set: { ghi_chu_dia_chi: 'Địa chỉ giao hàng' } }
  );
  addressUpdated += orphanAddressResult.modifiedCount || 0;

  for (const supplier of suppliers) {
    supplier.ghi_chu_dia_chi = supplierAddressNote(supplier);
    await supplier.save();
    supplierUpdated += 1;
  }

  console.log(JSON.stringify({
    customerUpdated,
    customerAddressUpdated: addressUpdated,
    supplierUpdated
  }, null, 2));
}

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
