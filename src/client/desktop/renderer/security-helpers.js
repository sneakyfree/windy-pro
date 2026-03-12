/**
 * SEC-08: Global HTML escaping helper — sanitizes strings for safe innerHTML insertion.
 * Loaded before all other renderer scripts.
 */
function _esc(str) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(String(str)));
  return div.innerHTML;
}
