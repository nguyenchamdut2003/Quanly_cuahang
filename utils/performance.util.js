function isPerformanceEnabled() {
  return process.env.PERF_LOG_ENABLED === 'true';
}

async function measureAsync(label, callback) {
  if (!isPerformanceEnabled()) {
    return callback();
  }

  var startedAt = process.hrtime.bigint();

  try {
    return await callback();
  } finally {
    var durationMs = Number(process.hrtime.bigint() - startedAt) / 1000000;

    console.log(
      '[PERF] ' + label + ': ' + durationMs.toFixed(2) + ' ms'
    );
  }
}

function measureSync(label, callback) {
  if (!isPerformanceEnabled()) {
    return callback();
  }

  var startedAt = process.hrtime.bigint();

  try {
    return callback();
  } finally {
    var durationMs = Number(process.hrtime.bigint() - startedAt) / 1000000;

    console.log(
      '[PERF] ' + label + ': ' + durationMs.toFixed(2) + ' ms'
    );
  }
}

module.exports = {
  isPerformanceEnabled: isPerformanceEnabled,
  measureAsync: measureAsync,
  measureSync: measureSync
};
