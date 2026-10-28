/*
 * Applies the saved colour theme before the page is drawn, so there is no flash of the
 * wrong theme. "violet" is the default; "red" is the white-and-red theme (data-skin="red").
 * The toggle button itself is wired up in app.js.
 */
(function () {
  'use strict';
  try {
    if (localStorage.getItem('velerion-skin') === 'red') {
      document.documentElement.setAttribute('data-skin', 'red');
      var meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', '#FFFFFF');
    }
  } catch (_) {
    /* storage blocked: keep the default theme */
  }
})();
