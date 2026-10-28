/*
 * Used by 404.html. GitHub Pages serves 404.html for any unknown path such as /aZ3kQ;
 * this hands the code to the app as /#/aZ3kQ, where the hash table resolves it.
 * Older links of the form /hashlink/aZ3kQ keep working.
 */
(function () {
  'use strict';
  var parts = location.pathname.split('/').filter(Boolean);
  if (parts[0] === 'hashlink') parts.shift();
  var code = parts.length === 1 ? parts[0] : '';
  location.replace('/' + (/^[A-Za-z0-9_-]{1,24}$/.test(code) ? '#/' + code : ''));
})();
