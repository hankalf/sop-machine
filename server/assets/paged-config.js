// Runs before Paged.js. Waits for fonts and images so page breaks are computed correctly.
(function () {
  var meta = document.querySelector('meta[name="sop-fonts"]');
  var fonts = meta ? meta.getAttribute('content').split('|').filter(Boolean) : [];

  function imagesLoaded() {
    var imgs = Array.prototype.slice.call(document.images);
    return Promise.all(
      imgs.map(function (img) {
        if (img.complete) return null;
        return new Promise(function (resolve) {
          img.addEventListener('load', resolve, { once: true });
          img.addEventListener('error', resolve, { once: true });
        });
      }),
    );
  }

  window.PagedConfig = {
    auto: true,
    before: function () {
      var loads = fonts.map(function (f) {
        return document.fonts.load(f).catch(function () {});
      });
      return Promise.all(loads)
        .then(function () {
          return document.fonts.ready;
        })
        .then(imagesLoaded);
    },
    after: function (flow) {
      var pages = flow && flow.total;
      document.documentElement.classList.add('paged-done');
      window.__pagedPages = pages;
      window.__pagedDone = true;
      window.dispatchEvent(new CustomEvent('sop:paged', { detail: { pages: pages } }));
    },
  };
})();
