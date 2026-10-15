try {
  var saved = JSON.parse(localStorage.getItem('fern.settings') || 'null');
  if (saved && typeof saved.theme === 'string') document.documentElement.dataset.theme = saved.theme;
} catch (e) {
  /* storage unavailable: keep the default theme */
}
