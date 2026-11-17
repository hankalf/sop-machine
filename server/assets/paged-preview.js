// Screen-only helpers for live previews: paper look, scale-to-fit, scroll requests,
// and telling the parent window when pagination is done.
// (Styles are injected after Paged.js runs because it drops @media screen rules.)
(function () {
  var root = document.documentElement;
  root.style.background = '#525659';
  root.style.visibility = 'hidden';

  function fit() {
    var container = document.querySelector('.pagedjs_pages');
    var first = document.querySelector('.pagedjs_page');
    if (!container || !first) return;
    var zoom = parseFloat(container.style.zoom) || 1;
    var pageWidth = first.getBoundingClientRect().width / zoom;
    var available = root.clientWidth - 32;
    container.style.zoom = String(Math.min(1, available / pageWidth));
  }

  window.addEventListener('sop:paged', function (e) {
    var style = document.createElement('style');
    style.textContent =
      'body{margin:0}' +
      '.pagedjs_pages{display:flex;flex-direction:column;align-items:center;padding:16px 0 24px}' +
      '.pagedjs_page{background:#fff;box-shadow:0 4px 18px rgba(0,0,0,.35);margin-bottom:18px}';
    document.head.appendChild(style);
    fit();
    root.style.visibility = '';
    try {
      window.parent.postMessage({ type: 'sop-preview-rendered', pages: e.detail.pages }, '*');
    } catch (_) {}
  });
  window.addEventListener('resize', fit);
  window.addEventListener('message', function (e) {
    if (!e.data || e.data.type !== 'sop-preview-scroll') return;
    var el = document.getElementById(e.data.target);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
})();
