/* BF.log: ring buffer + console + optional POST to BF_BUILD.debugUrl. Redacts t=, p=, sig=, tokens. */
(function (root) {
  'use strict';
  var BF = root.BF = root.BF || {};
  var buf = [], out = [], url = (root.BF_BUILD && root.BF_BUILD.debugUrl) || '';
  function redact(s) {
    return String(s).replace(/([?&](t|p|sig)=)[^&"'\s]+/g, '$1***').replace(/(Bearer\s+)[A-Za-z0-9._-]+/g, '$1***')
      .replace(/("?(X-Profile|Authorization|token|ticket)"?\s*[:=]\s*"?)[^",}\s]+/gi, '$1***');
  }
  function log(tag, msg, data) {
    var line = new Date().toISOString().slice(11, 23) + ' [' + tag + '] ' + msg + (data !== undefined ? ' ' + (typeof data === 'string' ? data : JSON.stringify(data)) : '');
    line = redact(line);
    buf.push(line); if (buf.length > 300) buf.shift();
    if (url) out.push(line);
    try { console.log(line); } catch (e) { /* */ }
  }
  log.redact = redact;
  log.dump = function (n) { return buf.slice(-(n || 300)); };
  if (url) setInterval(function () {
    if (!out.length) return;
    var b = out.splice(0, out.length);
    try { fetch(url, { method: 'POST', body: JSON.stringify(b) }).catch(function () {}); } catch (e) { /* */ }
  }, 1000);
  if (root.addEventListener) {
    root.addEventListener('error', function (e) { log('err', e.message + ' @' + (e.filename || '').split('/').pop() + ':' + e.lineno); });
    root.addEventListener('unhandledrejection', function (e) { log('err', 'unhandled ' + (e.reason && (e.reason.stack || e.reason.message) || e.reason)); });
  }
  BF.log = log;
  if (typeof module !== 'undefined') module.exports = log;
})(typeof window !== 'undefined' ? window : global);
