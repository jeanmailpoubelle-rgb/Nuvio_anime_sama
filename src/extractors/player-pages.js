const cheerio = require('cheerio');
const Js = require('../js-data');
const U = require('../url');
const { inlineScripts } = require('../pages');
function quality(value) {
  const match = /^(\d{3,4})p?$/i.exec(String(value || '').trim());
  return match ? `${Number(match[1])}p` : undefined;
}
function sources(html, base) {
  const $ = cheerio.load(html), found = new Map(), subtitles = [];
  const add = (raw, hint, q) => {
    const url = U.absolute(raw,base);
    if (!url) return;
    const ext = /\.(m3u8|mpd|mp4)(?:$|\/)/i.exec(new URL(url).pathname)?.[1]?.toLowerCase();
    const type = /^(hls|application\/.*mpegurl)/i.test(hint || '') || ext === 'm3u8' ? 'hls' : ext === 'mpd' || hint === 'dash' ? 'dash' : ext === 'mp4' ? 'video' : null;
    if (type) found.set(url,{url,type,...(quality(q) ? {quality:quality(q)} : {})});
  };
  $('video[src], video source[src]').each((_i,el) => add($(el).attr('src'),$(el).attr('type'),$(el).attr('label')));
  for (const script of inlineScripts($)) for (const text of [script,...Js.unpack(script)]) {
    const t = Js.tokens(text);
    for (let i = 0; i < t.length-2; i++) {
      const key = t[i].text;
      if (!['sources','tracks'].includes(key) || ![':', '='].includes(t[i+1].text) || t[i+2].text !== '[') continue;
      let depth = 1, objectDepth = 0, entry = {};
      const emit = () => {
        if (key === 'sources') add(entry.file || entry.src,entry.type,entry.label || entry.res);
        else if (['captions','subtitles'].includes(entry.kind)) {
          const url = U.absolute(entry.file || entry.src,base);
          if (url) subtitles.push({url,language:entry.srclang || entry.language || entry.label || 'Unknown',...(entry.label ? {name:entry.label} : {})});
        }
      };
      for (let j = i+3; j < t.length && depth > 0; j++) {
        const v = t[j];
        if (v.kind !== 's' && v.text === '[') depth++;
        if (v.kind !== 's' && v.text === ']') depth--;
        if (v.kind !== 's' && v.text === '{') { if (!objectDepth) entry = {}; objectDepth++; }
        if (v.kind !== 's' && v.text === '}') { objectDepth--; if (!objectDepth) emit(); }
        if (t[j+1]?.text === ':' && t[j+2]?.kind === 's') entry[v.text] = t[j+2].text;
        if (key === 'sources' && v.kind === 's' && objectDepth === 0) add(v.text);
      }
    }
    const refs = [...text.matchAll(/\bfile\s*:\s*(\w+)\.(?:file|hls\d*|mp4)/g)].map(m => m[1]);
    for (const ref of new Set(refs)) {
      const start = t.findIndex((v,i) => v.text === ref && t[i+1]?.text === '=' && t[i+2]?.text === '{');
      if (start < 0) continue;
      for (let j = start+3; j < t.length-2 && t[j].text !== '}'; j++) {
        if (/^(file|hls\d*|mp4)$/.test(t[j].text) && t[j+1].text === ':' && t[j+2].kind === 's') add(t[j+2].text,t[j].text);
      }
    }
  }
  return {media:[...found.values()],subtitles};
}
function redirect(html,base) {
  const $ = cheerio.load(html);
  if (!/Redirect/i.test($('title').text())) return null;
  for (const script of inlineScripts($)) {
    const t = Js.tokens(script);
    for (let i = 0; i < t.length-4; i++) if (t[i].text === 'location' && t[i+1].text === '.' && t[i+2].text === 'href' && t[i+3].text === '=' && t[i+4].kind === 's') return U.absolute(t[i+4].text,base);
  }
  return null;
}
function hostName(url,html = '') {
  const host = new URL(url).hostname.toLowerCase().replace(/^www\./,'');
  if (/ansembed/.test(host)) return 'ANSEmbed';
  if (/smoothpre/.test(host)) return 'Smoothpre';
  if (/vidmoly/.test(host)) return 'Vidmoly';
  if (/^(?:.*\.)?sendvid\.com$/.test(host)) return 'Sendvid';
  if (/voe\.sx|<title>\s*VOE/i.test(html) || /^(?:.*\.)?voe\.sx$/.test(host)) return 'Voe';
  if (/streamwish|strwish|embedwish|wishfast|sfastwish|playerwish|hlswish|swhoi|swdyu/.test(host)) return 'StreamWish';
  return host;
}
function normalizeEmbed(url) {
  const u = new URL(url), label = hostName(url);
  let path = u.pathname;
  if (label === 'Vidmoly' && path.startsWith('/w/')) path = '/embed-'+path.slice(3)+'.html';
  else if (label === 'StreamWish') path = path.replace(/^\/(?:e|f)\//,'/');
  else if (label === 'Smoothpre') path = path.replace(/^\/(?:d|download|file|f)\//,'/v/');
  return u.origin+path+(u.search === '?' ? '' : u.search);
}
module.exports = { sources, redirect, hostName, quality, normalizeEmbed };
