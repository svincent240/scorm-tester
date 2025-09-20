(function() {
  try {
    const appElement = document.getElementById('app');
    if (appElement) {
      // Prepare initial layout state before app.js runs
      appElement.classList.remove('initialized');
      if (document && document.body && document.documentElement) {
        document.body.style.overflow = 'hidden';
        document.documentElement.style.overflow = 'hidden';
      }
    }
  } catch (_) {}
})();

