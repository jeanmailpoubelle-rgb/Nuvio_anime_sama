function absolute(raw, base) {
  try {
    let value = String(raw || '').trim().replace(/&amp;/g, '&');
    if (!value || /@/.test(value.split('/').slice(0,3).join('/'))) return null;
    // Nuvio's older URL shim does not resolve protocol-relative URLs correctly.
    if (value.startsWith('//')) value = new URL(base).protocol + value;
    const u = new URL(value, base);
    if (!/^https?:$/.test(u.protocol) || !u.hostname || u.username || u.password || /[\r\n]/.test(value)) return null;
    return u.href;
  } catch (_error) { return null; }
}
function rootPath(value) {
  const path = new URL(value, 'https://relative.invalid').pathname;
  const m = path.match(/^\/catalogue\/([a-zA-Z0-9_%.-]+)(?:\/.*)?$/);
  if (!m || /^(\.|\.\.)$|%2e|%2f|%5c/i.test(m[1])) throw new Error('Invalid Anime-Sama path.');
  return `/catalogue/${m[1]}/`;
}
function sitePath(value) {
  const path = new URL(value, 'https://relative.invalid').pathname;
  if (!/^\/catalogue\/[A-Za-z0-9_%.-]+\/[A-Za-z0-9_-]+\/(vostfr|vf|vf1|vf2|vqc)\/$/.test(path) || /%2e|%2f|%5c|\/\.\.?\//i.test(path)) {
    throw new Error('Invalid episode path.');
  }
  return path;
}
function server(raw, base) {
  const url = absolute(raw, base);
  if (!url) return null;
  const host = new URL(url).hostname.toLowerCase();
  if (host === 'sibnet.ru' || host.endsWith('.sibnet.ru')) return null;
  return url.replace(/^(https?:\/\/(?:www\.)?)vidmoly\.(?:to|net)(?=\/|:|$)/i, '$1vidmoly.biz');
}
function relativeSiteUrl(raw, base) {
  const url = absolute(raw, base);
  if (!url) return null;
  const u = new URL(url);
  return u.pathname + (u.search === '?' ? '' : u.search);
}
function onSite(raw, base) {
  // Site-owned links follow the configured origin even if HTML contains an old one.
  const path = relativeSiteUrl(raw, base);
  return path ? base + path : null;
}
module.exports = { absolute, rootPath, sitePath, server, relativeSiteUrl, onSite };
