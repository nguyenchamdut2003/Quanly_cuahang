var crypto = require('crypto');

function parseCloudinaryUrl() {
  var raw = String(process.env.CLOUDINARY_URL || '').trim();
  if (!raw) return {};
  try {
    var parsed = new URL(raw);
    return {
      cloudName: parsed.hostname,
      apiKey: decodeURIComponent(parsed.username || ''),
      apiSecret: decodeURIComponent(parsed.password || '')
    };
  } catch (error) {
    return {};
  }
}

function cloudinaryConfig() {
  var fromUrl = parseCloudinaryUrl();
  return {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME || process.env.CLOUD_NAME || fromUrl.cloudName,
    apiKey: process.env.CLOUDINARY_API_KEY || fromUrl.apiKey,
    apiSecret: process.env.CLOUDINARY_API_SECRET || fromUrl.apiSecret
  };
}

function signParams(params, apiSecret) {
  var payload = Object.keys(params)
    .filter(function(key) { return params[key] !== undefined && params[key] !== null && params[key] !== ''; })
    .sort()
    .map(function(key) { return key + '=' + params[key]; })
    .join('&');
  return crypto.createHash('sha1').update(payload + apiSecret).digest('hex');
}

async function uploadImageBuffer(file, options) {
  if (!file || !file.buffer || !file.buffer.length) return null;
  if (!/^image\//i.test(String(file.mimetype || ''))) {
    var typeError = new Error('File tải lên phải là ảnh.');
    typeError.statusCode = 400;
    throw typeError;
  }

  var config = cloudinaryConfig();
  if (!config.cloudName || !config.apiKey || !config.apiSecret) {
    var configError = new Error('Chưa cấu hình Cloudinary trong .env.');
    configError.statusCode = 500;
    throw configError;
  }

  var params = {
    folder: options && options.folder ? options.folder : 'quanly-cuahang',
    timestamp: Math.floor(Date.now() / 1000)
  };
  var form = new FormData();
  Object.keys(params).forEach(function(key) {
    form.append(key, String(params[key]));
  });
  form.append('api_key', config.apiKey);
  form.append('signature', signParams(params, config.apiSecret));
  form.append('file', new Blob([file.buffer], { type: file.mimetype || 'application/octet-stream' }), file.originalname || 'upload');

  var response = await fetch('https://api.cloudinary.com/v1_1/' + encodeURIComponent(config.cloudName) + '/image/upload', {
    method: 'POST',
    body: form
  });
  var data = await response.json().catch(function() { return {}; });
  if (!response.ok) {
    var uploadError = new Error(data.error && data.error.message ? data.error.message : 'Không tải được ảnh lên Cloudinary.');
    uploadError.statusCode = response.status >= 400 && response.status < 500 ? 400 : 502;
    throw uploadError;
  }
  return {
    url: data.secure_url || data.url || '',
    public_id: data.public_id || ''
  };
}

module.exports = {
  uploadImageBuffer
};
