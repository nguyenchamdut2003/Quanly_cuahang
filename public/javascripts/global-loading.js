(function initializeGlobalLoading() {
  var overlay = document.getElementById('globalLoadingOverlay');
  var loadingText = document.getElementById('globalLoadingText');
  var appRoot = document.getElementById('appRoot');
  var isProcessing = false;
  var previousFocus = null;

  if (!overlay || !loadingText) {
    window.showGlobalLoading = function() { return true; };
    window.hideGlobalLoading = function() {};
    window.isGlobalLoading = function() { return false; };
    return;
  }

  window.showGlobalLoading = function(message) {
    if (isProcessing) {
      return false;
    }

    isProcessing = true;
    previousFocus = document.activeElement;
    loadingText.textContent = message || 'Đang xử lý...';
    overlay.hidden = false;
    overlay.setAttribute('aria-hidden', 'false');

    if (appRoot) {
      appRoot.setAttribute('inert', '');
      appRoot.setAttribute('aria-busy', 'true');
    }

    document.body.classList.add('is-processing');
    overlay.focus();

    return true;
  };

  window.hideGlobalLoading = function() {
    isProcessing = false;
    overlay.hidden = true;
    overlay.setAttribute('aria-hidden', 'true');

    if (appRoot) {
      appRoot.removeAttribute('inert');
      appRoot.removeAttribute('aria-busy');
    }

    document.body.classList.remove('is-processing');

    if (previousFocus && typeof previousFocus.focus === 'function') {
      try {
        previousFocus.focus();
      } catch (error) {
        // Focus restore is best-effort because the previous node may be gone after navigation.
      }
    }
  };

  window.isGlobalLoading = function() {
    return isProcessing;
  };

  window.addEventListener('pageshow', function() {
    window.hideGlobalLoading();
  });
})();
