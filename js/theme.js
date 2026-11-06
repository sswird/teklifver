// Tema sayfa çizilmeden önce uygulanır; böylece siyah temada beyaz bir an parlamaz.
(function () {
  var saved = null;
  try { saved = localStorage.getItem('theme'); } catch (err) { /* depolama kapalı olabilir */ }
  document.documentElement.dataset.theme = saved === 'dark' ? 'dark' : 'light';
})();
