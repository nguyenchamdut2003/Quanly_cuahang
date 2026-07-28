document.addEventListener('DOMContentLoaded', function() {
  document.querySelectorAll('[data-auth-form]').forEach(function(form) {
    form.addEventListener('submit', function() {
      var button = form.querySelector('button[type="submit"]');
      if (!button) return;
      button.disabled = true;
      button.textContent = button.getAttribute('data-submit-text') || 'Đang xử lý...';
    });
  });

  document.querySelectorAll('[data-password-toggle]').forEach(function(button) {
    button.addEventListener('click', function() {
      var field = button.closest('.auth-password-field');
      var input = field && field.querySelector('[data-password-input]');
      var icon = button.querySelector('i');
      if (!input) return;

      var shouldShow = input.type === 'password';
      input.type = shouldShow ? 'text' : 'password';
      button.setAttribute('aria-label', shouldShow ? 'Ẩn mật khẩu' : 'Hiện mật khẩu');
      if (icon) {
        icon.classList.toggle('fa-eye', !shouldShow);
        icon.classList.toggle('fa-eye-slash', shouldShow);
      }
    });
  });

  document.querySelectorAll('[data-otp-input]').forEach(function(input) {
    input.addEventListener('input', function() {
      input.value = String(input.value || '').replace(/\D/g, '').slice(0, 6);
    });
    var form = input.closest('form');
    if (form) {
      form.addEventListener('submit', function() {
        input.value = String(input.value || '').replace(/\D/g, '').slice(0, 6);
      });
    }
  });

  document.querySelectorAll('[data-resend-button]').forEach(function(button) {
    var countdown = document.querySelector('[data-resend-countdown]');
    var resendAfter = button.getAttribute('data-resend-after');
    if (!resendAfter) return;

    function tick() {
      var remaining = Math.ceil((new Date(resendAfter).getTime() - Date.now()) / 1000);
      if (remaining > 0) {
        button.disabled = true;
        if (countdown) countdown.textContent = '(' + remaining + 's)';
        window.setTimeout(tick, 1000);
        return;
      }
      button.disabled = false;
      if (countdown) countdown.textContent = '';
    }

    tick();
  });
});
