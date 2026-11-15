(function () {
  'use strict';
  var KEY = 'metka-theme';
  function get() {
    try { return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light'; } catch (e) { return 'light'; }
  }
  function apply(t) {
    document.documentElement.setAttribute('data-theme', t);
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', t === 'dark' ? '#0d1411' : '#ffffff');
  }
  window.metkaTheme = {
    get: get,
    set: function (t) {
      t = t === 'dark' ? 'dark' : 'light';
      try { localStorage.setItem(KEY, t); } catch (e) { /* pamięć niedostępna */ }
      apply(t);
    }
  };
  apply(get());
})();
