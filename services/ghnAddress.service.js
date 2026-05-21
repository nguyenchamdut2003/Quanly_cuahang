const BASE_URL = String(process.env.GHN_BASE_URL || '').replace(/\/+$/, '');
const TOKEN = String(process.env.GHN_TOKEN || '').trim();
const MOCK_MODE = String(process.env.GHN_MOCK_MODE || '').toLowerCase() === 'true';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

const cache = new Map();

const mockProvinces = [
  { province_id: 201, province_name: 'Hà Nội' },
  { province_id: 202, province_name: 'Hồ Chí Minh' },
  { province_id: 203, province_name: 'Đà Nẵng' }
];

const mockDistricts = {
  201: [
    { district_id: 1442, district_name: 'Quận Thanh Xuân', province_id: 201 },
    { district_id: 1482, district_name: 'Quận Cầu Giấy', province_id: 201 }
  ],
  202: [
    { district_id: 1444, district_name: 'Quận 1', province_id: 202 },
    { district_id: 1451, district_name: 'Thành phố Thủ Đức', province_id: 202 }
  ],
  203: [
    { district_id: 1526, district_name: 'Quận Hải Châu', province_id: 203 }
  ]
};

const mockWards = {
  1442: [
    { ward_code: '1A0101', ward_name: 'Phường Thượng Đình', district_id: 1442, district_name: 'Quận Thanh Xuân', province_id: 201 },
    { ward_code: '1A0102', ward_name: 'Phường Thanh Xuân Trung', district_id: 1442, district_name: 'Quận Thanh Xuân', province_id: 201 }
  ],
  1482: [
    { ward_code: '1A0201', ward_name: 'Phường Dịch Vọng', district_id: 1482, district_name: 'Quận Cầu Giấy', province_id: 201 }
  ],
  1444: [
    { ward_code: '2A0101', ward_name: 'Phường Bến Nghé', district_id: 1444, district_name: 'Quận 1', province_id: 202 }
  ],
  1451: [
    { ward_code: '2A0201', ward_name: 'Phường Linh Trung', district_id: 1451, district_name: 'Thành phố Thủ Đức', province_id: 202 }
  ],
  1526: [
    { ward_code: '3A0101', ward_name: 'Phường Thạch Thang', district_id: 1526, district_name: 'Quận Hải Châu', province_id: 203 }
  ]
};

function sortVi(a, b, key) {
  return String(a[key] || '').localeCompare(String(b[key] || ''), 'vi');
}

function getCached(key) {
  const item = cache.get(key);
  if (!item) return null;
  if (Date.now() - item.createdAt > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return item.value;
}

function setCached(key, value) {
  cache.set(key, { createdAt: Date.now(), value });
  return value;
}

function ensureConfig() {
  if (MOCK_MODE) return;
  if (!BASE_URL) throw new Error('Thiếu GHN_BASE_URL trong .env.');
  if (!TOKEN) throw new Error('Thiếu GHN_TOKEN trong .env.');
}

async function requestGhn(path, params) {
  ensureConfig();

  const url = new URL(BASE_URL + path);
  Object.keys(params || {}).forEach(function(key) {
    if (params[key] !== undefined && params[key] !== null && params[key] !== '') {
      url.searchParams.set(key, params[key]);
    }
  });

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Token: TOKEN,
      Accept: 'application/json'
    }
  });

  const data = await response.json().catch(function() {
    return null;
  });

  if (!response.ok || !data || data.code !== 200) {
    const message = data && data.message ? data.message : ('GHN trả lỗi HTTP ' + response.status);
    throw new Error(message);
  }

  return Array.isArray(data.data) ? data.data : [];
}

function normalizeProvince(item) {
  return {
    province_id: Number(item.ProvinceID || item.province_id || item.ProvinceId || 0),
    province_name: String(item.ProvinceName || item.province_name || '').trim()
  };
}

function normalizeDistrict(item, provinceId) {
  return {
    district_id: Number(item.DistrictID || item.district_id || item.DistrictId || 0),
    district_name: String(item.DistrictName || item.district_name || '').trim(),
    province_id: Number(item.ProvinceID || item.province_id || provinceId || 0)
  };
}

function normalizeWard(item, district) {
  return {
    ward_code: String(item.WardCode || item.ward_code || '').trim(),
    ward_name: String(item.WardName || item.ward_name || '').trim(),
    district_id: Number(item.DistrictID || item.district_id || (district && district.district_id) || 0),
    district_name: String((district && district.district_name) || item.DistrictName || item.district_name || '').trim(),
    province_id: Number((district && district.province_id) || item.ProvinceID || item.province_id || 0)
  };
}

async function getProvinces() {
  const cached = getCached('provinces');
  if (cached) return cached;
  if (MOCK_MODE) return setCached('provinces', mockProvinces.slice().sort(function(a, b) { return sortVi(a, b, 'province_name'); }));

  const rows = await requestGhn('/master-data/province');
  const items = rows.map(normalizeProvince)
    .filter(function(item) { return item.province_id && item.province_name; })
    .sort(function(a, b) { return sortVi(a, b, 'province_name'); });
  return setCached('provinces', items);
}

async function getDistricts(provinceId) {
  provinceId = Number(provinceId || 0);
  if (!provinceId) throw new Error('Thiếu province_id.');

  const cacheKey = 'districts:' + provinceId;
  const cached = getCached(cacheKey);
  if (cached) return cached;
  if (MOCK_MODE) return setCached(cacheKey, (mockDistricts[provinceId] || []).slice().sort(function(a, b) { return sortVi(a, b, 'district_name'); }));

  const rows = await requestGhn('/master-data/district', { province_id: provinceId });
  const items = rows.map(function(row) { return normalizeDistrict(row, provinceId); })
    .filter(function(item) { return item.district_id && item.district_name; })
    .sort(function(a, b) { return sortVi(a, b, 'district_name'); });
  return setCached(cacheKey, items);
}

async function getWards(districtId) {
  districtId = Number(districtId || 0);
  if (!districtId) throw new Error('Thiếu district_id.');

  const cacheKey = 'wards:' + districtId;
  const cached = getCached(cacheKey);
  if (cached) return cached;
  if (MOCK_MODE) return setCached(cacheKey, (mockWards[districtId] || []).slice().sort(function(a, b) { return sortVi(a, b, 'ward_name'); }));

  const rows = await requestGhn('/master-data/ward', { district_id: districtId });
  const items = rows.map(function(row) { return normalizeWard(row, { district_id: districtId }); })
    .filter(function(item) { return item.ward_code && item.ward_name; })
    .sort(function(a, b) { return sortVi(a, b, 'ward_name'); });
  return setCached(cacheKey, items);
}

async function getWardsByProvince(provinceId) {
  provinceId = Number(provinceId || 0);
  if (!provinceId) throw new Error('Thiếu province_id.');

  const cacheKey = 'wardsByProvince:' + provinceId;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const districts = await getDistricts(provinceId);
  const wardGroups = await Promise.all(districts.map(async function(district) {
    const wards = await getWards(district.district_id);
    return wards.map(function(ward) {
      return Object.assign({}, ward, {
        district_id: district.district_id,
        district_name: district.district_name,
        province_id: district.province_id || provinceId
      });
    });
  }));

  const items = wardGroups.reduce(function(all, group) {
    return all.concat(group);
  }, []).sort(function(a, b) {
    return sortVi(a, b, 'ward_name') || sortVi(a, b, 'district_name');
  });

  return setCached(cacheKey, items);
}

module.exports = {
  getProvinces,
  getDistricts,
  getWards,
  getWardsByProvince
};
