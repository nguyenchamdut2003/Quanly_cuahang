const { AsyncLocalStorage } = require('async_hooks');

const requestContext = new AsyncLocalStorage();

function nowText() {
  return new Date().toISOString();
}

function safeJson(value) {
  try {
    return JSON.stringify(value, function(_key, val) {
      if (val && val._bsontype === 'ObjectId') return String(val);
      return val;
    });
  } catch (_error) {
    return String(value);
  }
}

function modelLabel(ctx) {
  const modelName = ctx && ctx.constructor && ctx.constructor.modelName
    ? ctx.constructor.modelName
    : (ctx && ctx.model && ctx.model.modelName ? ctx.model.modelName : 'UnknownModel');
  const collectionName = ctx && ctx.collection && ctx.collection.name
    ? ctx.collection.name
    : (ctx && ctx.model && ctx.model.collection ? ctx.model.collection.name : 'unknown_collection');
  return `${modelName}/${collectionName}`;
}

function resultSummary(result) {
  if (!result) return '';
  if (Array.isArray(result)) return `docs=${result.length}`;
  const parts = [];
  ['acknowledged', 'matchedCount', 'modifiedCount', 'upsertedCount', 'deletedCount', 'insertedCount'].forEach(key => {
    if (result[key] != null) parts.push(`${key}=${result[key]}`);
  });
  if (result._id) parts.push(`_id=${result._id}`);
  return parts.join(' ');
}

function requestLabel() {
  const store = requestContext.getStore();
  if (!store) return '';
  return `${store.method} ${store.originalUrl}`;
}

function logOk(ctx, action, detail, result) {
  const summary = resultSummary(result);
  const request = requestLabel();
  console.log(`[DB_WRITE][OK] ${nowText()}${request ? ' [' + request + ']' : ''} ${modelLabel(ctx)} ${action}${detail ? ' ' + detail : ''}${summary ? ' => ' + summary : ''}`);
}

function logFail(ctx, action, detail, error) {
  const request = requestLabel();
  console.error(`[DB_WRITE][FAIL] ${nowText()}${request ? ' [' + request + ']' : ''} ${modelLabel(ctx)} ${action}${detail ? ' ' + detail : ''} => ${error && error.message ? error.message : error}`);
}

function getQueryDetail(query) {
  const filter = typeof query.getFilter === 'function' ? query.getFilter() : {};
  const update = typeof query.getUpdate === 'function' ? query.getUpdate() : undefined;
  return `filter=${safeJson(filter)}${update ? ' update=' + safeJson(update) : ''}`;
}

function dbWriteLoggerPlugin(schema) {
  schema.pre('save', function() {
    this.$locals = this.$locals || {};
    this.$locals.__dbWriteAction = this.isNew ? 'create' : 'save';
  });

  schema.post('save', function(doc) {
    const action = doc && doc.$locals && doc.$locals.__dbWriteAction ? doc.$locals.__dbWriteAction : 'save';
    logOk(doc, action, `_id=${doc && doc._id ? doc._id : ''}`, doc);
  });

  schema.post('save', function(error, doc, next) {
    const action = doc && doc.$locals && doc.$locals.__dbWriteAction ? doc.$locals.__dbWriteAction : 'save';
    logFail(doc || this, action, doc && doc._id ? `_id=${doc._id}` : '', error);
    next(error);
  });

  schema.pre('insertMany', function(docs) {
    this.__dbWriteDetail = `docs=${Array.isArray(docs) ? docs.length : 0}`;
  });

  schema.post('insertMany', function(docs) {
    logOk(this, 'insertMany', this.__dbWriteDetail || '', docs);
  });

  schema.post('insertMany', function(error, docs, next) {
    logFail(this, 'insertMany', `docs=${Array.isArray(docs) ? docs.length : 0}`, error);
    next(error);
  });

  const queryOps = [
    'updateOne',
    'updateMany',
    'findOneAndUpdate',
    'deleteOne',
    'deleteMany',
    'findOneAndDelete',
    'findOneAndRemove',
    'replaceOne'
  ];

  queryOps.forEach(function(op) {
    schema.pre(op, function() {
      this.__dbWriteDetail = getQueryDetail(this);
    });

    schema.post(op, function(result) {
      logOk(this, op, this.__dbWriteDetail || getQueryDetail(this), result);
    });

    schema.post(op, function(error, result, next) {
      logFail(this, op, this.__dbWriteDetail || getQueryDetail(this), error);
      next(error);
    });
  });
}

function dbWriteRequestContext(req, res, next) {
  requestContext.run({
    method: req.method,
    originalUrl: req.originalUrl || req.url || '/'
  }, next);
}

module.exports = {
  dbWriteRequestContext,
  dbWriteLoggerPlugin
};
