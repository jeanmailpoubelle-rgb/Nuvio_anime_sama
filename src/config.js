const defaults = require('../config.json');

function normalizeBase(value) {
  const input = String(value).trim();
  if (input.includes('@')) throw new Error('Website login details are not allowed.');
  const u = new URL(input.includes('://') ? input : `https://${input}`);
  // Nuvio's Ktor URL bridge emits bare '?' / '#' for empty query/fragment.
  // Validate the supplied address itself; keep rejecting real query/fragment
  // values and credentials even when a runtime shim omits URL.username.
  if (!/^https?:$/.test(u.protocol) || !u.hostname || u.username || u.password || /[?#]/.test(input) || !/^\/*$/.test(u.pathname)) {
    throw new Error('Use the website home address, without a path, login, query or fragment.');
  }
  return u.origin.toLowerCase();
}
function configuration(overrides = {}) {
  const c = { ...defaults, ...overrides };
  c.animeSamaBaseUrl = normalizeBase(c.animeSamaBaseUrl);
  for (const key of ['requestTimeoutMs','hostTimeoutMs','resolutionTimeoutMs','extractorConcurrency','metadataConcurrency','metadataCacheMs','episodeCacheMs','successGraceMs']) {
    if (!Number.isFinite(c[key]) || c[key] < 1) throw new Error(`Invalid configuration: ${key}`);
  }
  if (!['all','vostfr','vf'].includes(c.version)) throw new Error('Invalid version preference.');
  return Object.freeze(c);
}
module.exports = { defaults, normalizeBase, configuration };
