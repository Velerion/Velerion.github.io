/* 32 sample URLs for the console demo (cli/demo.js). Short codes come from a fixed PRNG seed,
 * so every run gets the same codes and the same collisions. */
(function (global) {
  'use strict';

  const SEED_URLS = [
    'https://en.wikipedia.org/wiki/Hash_table',
    'https://en.wikipedia.org/wiki/Linked_list',
    'https://en.wikipedia.org/wiki/Open_addressing',
    'https://en.wikipedia.org/wiki/Linear_probing',
    'https://en.wikipedia.org/wiki/Hash_function',
    'https://en.wikipedia.org/wiki/Stack_(abstract_data_type)',
    'https://en.wikipedia.org/wiki/Queue_(abstract_data_type)',
    'https://en.wikipedia.org/wiki/Circular_buffer',
    'https://en.wikipedia.org/wiki/Linear_search',
    'https://en.wikipedia.org/wiki/Binary_search',
    'https://en.wikipedia.org/wiki/Big_O_notation',
    'https://en.wikipedia.org/wiki/URL_shortening',
    'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map',
    'https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage',
    'https://developer.mozilla.org/en-US/docs/Web/API/URL/URL',
    'https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/301',
    'https://developer.mozilla.org/en-US/docs/Web/API/History_API',
    'https://github.com/trekhleb/javascript-algorithms/tree/master/src/data-structures/hash-table',
    'https://github.com/trekhleb/javascript-algorithms/tree/master/src/data-structures/linked-list',
    'https://github.com/TheAlgorithms/JavaScript',
    'https://visualgo.net/en/hashtable',
    'https://visualgo.net/en/list',
    'https://www.geeksforgeeks.org/hashing-data-structure/',
    'https://www.geeksforgeeks.org/separate-chaining-collision-handling-technique-in-hashing/',
    'https://www.cs.usfca.edu/~galles/visualization/OpenHash.html',
    'https://www.cs.usfca.edu/~galles/visualization/ClosedHash.html',
    'https://ocw.mit.edu/courses/6-006-introduction-to-algorithms-spring-2020/',
    'https://cp-algorithms.com/string/string-hashing.html',
    'https://pages.github.com/',
    'https://docs.netlify.com/',
    'https://nodejs.org/en/docs',
    'https://www.w3.org/Addressing/URL/url-spec.txt',
  ];

  const api = { SEED_URLS, SEED_RNG: 20261027 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.SEED = api;
})(typeof window !== 'undefined' ? window : globalThis);
