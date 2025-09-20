(function() {
  try {
    let savedTheme = null;

    // Only attempt localStorage when not on scorm-app: (opaque origin)
    if (typeof window !== 'undefined' && window.location && window.location.protocol !== 'scorm-app:' && typeof localStorage !== 'undefined') {
      try {
        savedTheme = localStorage.getItem('scorm-tester-theme');
      } catch (_) {}
    }

    const systemTheme = (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
      ? 'dark'
      : 'default';

    const theme = savedTheme || systemTheme;
    if (typeof document !== 'undefined' && document.documentElement) {
      document.documentElement.setAttribute('data-theme', theme);
      document.documentElement.classList.add(`theme-${theme}`);
    }
  } catch (_) {}
})();

