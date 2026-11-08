// Applies the saved setting (Matinée or Evening) before the first paint, so the page never flashes the other one.
// Loaded as a plain script from the head; the CSP allows scripts from this site only, so it cannot be inline.
(function () {
  try {
    var saved = localStorage.getItem('rw-theme');
    if (saved === 'light' || saved === 'dark') document.documentElement.setAttribute('data-theme', saved);
  } catch (e) { /* no storage: the system setting decides */ }
})();
