const { NhaCungCap, PhieuNhap, PhieuTraHangNhap } = require('../../../models/kiot.model');
const { buildProfitBySupplierReport } = require('../../../services/profitReport.service');
const { getSalesRange } = require('../helpers/date.helper');

async function buildSupplierReport(query = {}) {
    if (query.focus === 'loi-nhuan') {
        const range = getSalesRange(query);
        return buildProfitBySupplierReport(Object.assign({}, query, { range }));
    }
    const range = getSalesRange(query);
    const supplierSearch = query.supplier?.trim();
    const supplierFilter = {};

    if (supplierSearch) {
        supplierFilter.$or = [
            { ma_ncc: { $regex: supplierSearch, $options: 'i' } },
            { ten_ncc: { $regex: supplierSearch, $options: 'i' } },
            { sdt: { $regex: supplierSearch, $options: 'i' } }
        ];
    }

    const suppliers = await NhaCungCap.find(supplierFilter).sort({ ma_ncc: 1 });
    const supplierIds = suppliers.map(item => item._id);
    const purchaseFilter = {
        ngay_nhap: { $gte: range.start, $lt: range.end },
        nha_cung_cap_id: { $in: supplierIds }
    };
    const returnFilter = {
        ngay_tra: { $gte: range.start, $lt: range.end },
        nha_cung_cap_id: { $in: supplierIds },
        trang_thai: 'completed'
    };
    if (query.status) purchaseFilter.trang_thai = query.status;

    const [purchases, returns] = await Promise.all([
        PhieuNhap.find(purchaseFilter),
        PhieuTraHangNhap.find(returnFilter)
    ]);

    const purchaseMap = new Map();
    purchases.forEach(item => {
        const key = String(item.nha_cung_cap_id || '');
        const current = purchaseMap.get(key) || { value: 0, count: 0 };
        current.value += Number(item.tong_tien || 0);
        current.count += 1;
        purchaseMap.set(key, current);
    });

    const returnMap = new Map();
    returns.forEach(item => {
        const key = String(item.nha_cung_cap_id || '');
        const current = returnMap.get(key) || { value: 0, count: 0 };
        current.value += Number(item.tong_tien_tra || 0);
        current.count += 1;
        returnMap.set(key, current);
    });

    const rows = suppliers.map(supplier => {
        const key = String(supplier._id);
        const purchase = purchaseMap.get(key) || {};
        const returned = returnMap.get(key) || {};
        const importValue = purchase.value || 0;
        const returnValue = returned.value || 0;
        return {
            id: key,
            code: supplier.ma_ncc || '',
            name: supplier.ten_ncc || '',
            phone: supplier.sdt || '',
            importValue,
            returnValue,
            netValue: importValue - returnValue,
            purchaseCount: purchase.count || 0,
            returnCount: returned.count || 0
        };
    }).sort((a, b) => b.netValue - a.netValue || a.code.localeCompare(b.code));

    const totals = rows.reduce((acc, row) => {
        acc.supplierCount += 1;
        acc.importValue += row.importValue;
        acc.returnValue += row.returnValue;
        acc.netValue += row.netValue;
        acc.purchaseCount += row.purchaseCount;
        acc.returnCount += row.returnCount;
        return acc;
    }, { supplierCount: 0, importValue: 0, returnValue: 0, netValue: 0, purchaseCount: 0, returnCount: 0 });

    return {
        generatedAt: new Date(),
        branchName: 'Cửa hàng trung tâm',
        range,
        rows,
        topSuppliers: rows.slice(0, 10),
        totals,
        filters: query,
        viewMode: query.view === 'report' ? 'report' : 'chart',
        focus: query.focus || 'nhap-hang'
    };
}

module.exports = {
    buildSupplierReport
};

