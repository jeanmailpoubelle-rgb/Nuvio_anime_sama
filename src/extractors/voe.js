// CloudStream core Voe.decryptF7, adapted as a pure decoder with no page execution.
const cheerio = require('cheerio');
const U = require('../url');
function decryptF7(encoded) {
  const rotated = encoded.replace(/[A-Za-z]/g, c => String.fromCharCode(c.charCodeAt(0)+(c.toLowerCase() <= 'm' ? 13 : -13)));
  const clean = rotated.replace(/@\$|\^\^|~@|%\?|\*~|!!|#&/g,'_').replace(/_/g,'');
  const shifted = Array.from(atob(clean), c => String.fromCharCode(c.charCodeAt(0)-3)).reverse().join('');
  return JSON.parse(atob(shifted));
}
function sources(html,base) {
  const $ = cheerio.load(html), out = [];
  $('script[type="application/json"]').each((_i,el) => {
    try {
      const data = JSON.parse($(el).html());
      if (!Array.isArray(data) || typeof data[0] !== 'string') return;
      const decoded = decryptF7(data[0]);
      for (const [key,type] of [['source','hls'],['direct_access_url','video']]) {
        const url = U.absolute(decoded[key],base);
        if (url) out.push({url,type});
      }
    } catch (_error) { /* malformed/irrelevant JSON does not fail other hosts */ }
  });
  return out;
}
module.exports = { decryptF7, sources };
