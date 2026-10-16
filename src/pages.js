const cheerio = require('cheerio');
const Js = require('./js-data');
const U = require('./url');
const LANGUAGES = ['vostfr','vf','vf1','vf2','vqc'];
const unique = values => [...new Set(values)];
function inlineScripts($) {
  const result = [];
  $('script:not([src])').each((_i, el) => result.push($(el).html() || ''));
  return result;
}
function cards(html, base, selector) {
  const $ = cheerio.load(html), out = [];
  const container = selector ? $(selector) : $.root ? $.root() : $('html');
  container.find('a[href]').each((_i, el) => {
    const a = $(el), href = U.absolute(a.attr('href'), base);
    if (!href || /\/scan/i.test(new URL(href).pathname)) return;
    let path;
    try { path = U.rootPath(href); } catch (_error) { return; }
    const title = a.find('.card-title, h1, h2, h3').first().text().trim();
    const image = a.find('img.card-image, img:not(.flag-icon)').first();
    if (!title || !image.length) return;
    const raw = image.attr('data-src') || image.attr('src');
    out.push({ path, title, aliases:unique(a.find('.card-text, .card-alters, .card-title-alt').first().text().split(',').map(s => s.trim()).filter(Boolean)), poster: U.absolute(raw, base) });
  });
  return out.filter((item, i) => out.findIndex(other => other.path === item.path) === i);
}
function hasNext(html, base, page) {
  const $ = cheerio.load(html);
  let found = false;
  $('a[href*="page="]').each((_i, el) => {
    const match = /[?&]page=(\d+)/.exec(U.absolute($(el).attr('href'), base) || '');
    if (match && Number(match[1]) > page) found = true;
  });
  return found;
}
function detail(html, base) {
  const $ = cheerio.load(html), title = $('h1').first().text().trim();
  if (!title) throw new Error('Anime-Sama detail page unavailable.');
  const root = U.rootPath(base), grouped = new Map();
  for (const script of inlineScripts($)) {
    for (const { args } of Js.calls(script, ['panneauAnime'])) {
      if (args.length !== 2 || args.some(a => a.kind !== 's') || args[0].text === 'nom') continue;
      const resolved = U.absolute(args[1].text, new URL(root, base).href);
      if (!resolved) continue;
      const path = new URL(resolved).pathname.replace(/\/+$/, '');
      const language = path.split('/').pop(), groupPath = path.slice(0, path.lastIndexOf('/') + 1);
      if (!path.startsWith(root) || /\/scan/i.test(path) || !LANGUAGES.includes(language)) continue;
      try { U.sitePath(groupPath + language + '/'); } catch (_error) { continue; }
      if (!grouped.has(groupPath)) grouped.set(groupPath, { path: groupPath, name: args[0].text, id: grouped.size + 1, languages: [] });
      const g = grouped.get(groupPath);
      if (!g.languages.includes(language)) g.languages.push(language);
    }
  }
  let year, status;
  $('.info-lbl').each((_i, el) => {
    const label = $(el).text().trim(), value = $(el).next().text().trim();
    if (label === 'Année' && /^\d{4}$/.test(value)) year = Number(value);
    if (label === 'État') status = value;
  });
  const tags = [];
  $('.oeuvre-section').each((_i, el) => {
    const section = $(el);
    if (section.find('h2').first().text().trim() === 'Genres') {
      section.find('a, span').each((_j, tag) => { const v = $(tag).text().trim(); if (v && v.length < 50) tags.push(v); });
    }
  });
  return { path: root, title, aliases:unique($('#titreAlter').text().split(',').map(s => s.trim()).filter(Boolean)), poster: U.absolute($('meta[property="og:image"]').attr('content'), base),
    plot: $('#synopsisText').text().trim() || $('meta[name="description"]').attr('content'),
    year, status, tags: unique(tags), groups: [...grouped.values()] };
}
function episodeScript(html, base) {
  const $ = cheerio.load(html);
  return U.relativeSiteUrl($('script[src*="episodes.js"]').first().attr('src'), base);
}
function episodeLabels(html, count) {
  const $ = cheerio.load(html);
  const labels = [];
  let specials = 0;
  for (const script of inlineScripts($)) {
    for (const { name, args } of Js.calls(script, ['resetListe','creerListe','newSP','newSPF','finirListe','finirListeOP'])) {
      if (name === 'resetListe') { labels.length = 0; specials = 0; }
      else if (name === 'newSP' || name === 'newSPF') {
        if (args.length === 1 && args[0].kind === 's' && labels.length < count) { labels.push((name === 'newSP' ? 'Épisode ' : '') + args[0].text); specials++; }
      } else if (name === 'creerListe') {
        if (args.length !== 2 || args.some(a => !/^\d+$/.test(a.text))) continue;
        const start = Number(args[0].text), end = Number(args[1].text);
        if (end < start || end - start > 20000) continue;
        for (let n = start; n <= end && labels.length < count; n++) labels.push(`Épisode ${n}`);
      } else if (name === 'finirListe' && args.length === 1 && /^\d+$/.test(args[0].text)) {
        for (let n = Number(args[0].text); n <= count - specials && labels.length < count; n++) labels.push(`Épisode ${n}`);
      } else if (name === 'finirListeOP' && args.length === 1 && /^[1-9]\d*$/.test(args[0].text)) {
        // The site's ongoing One Piece helper numbers the remaining real slots
        // from its literal start. Read the call, never evaluate the page function
        // or hardcode the current saga/episode count: new releases extend naturally.
        for (let n = Number(args[0].text); labels.length < count; n++) labels.push(`Épisode ${n}`);
      }
    }
  }
  while (labels.length < count) labels.push(`Épisode ${labels.length + 1}`);
  return labels.slice(0, count);
}
function episodeSlots(script, html, base) {
  const values = Object.values(Js.arrays(script));
  const count = Math.max(0, ...values.map(a => a.length));
  const labels = episodeLabels(html, count);
  return labels.map((name, index) => ({ index, name, number: /^Épisode (\d+)$/.test(name) ? Number(/^Épisode (\d+)$/.exec(name)[1]) : null,
    servers: unique(values.map(a => U.server(a[index], base)).filter(Boolean)) }));
}
function orderedRows(groups, versions) {
  const out = [];
  for (const group of groups) {
    const choices = new Map();
    const rows = versions.filter(v => v.group.path === group.path).sort((a,b) => LANGUAGES.indexOf(a.language) - LANGUAGES.indexOf(b.language));
    for (const version of rows) for (const slot of version.episodes) {
      const key = slot.number != null ? `number:${slot.number}` : `title:${slot.name.trim()}`;
      if (!choices.has(key)) choices.set(key, []);
      choices.get(key).push({version,slot});
    }
    const sorted = [...choices.values()].sort((a,b) => (a[0].slot.number ?? a[0].slot.index+1) - (b[0].slot.number ?? b[0].slot.index+1) || a[0].slot.index-b[0].slot.index);
    const reserved = new Set(sorted.map(a => a[0].slot.number).filter(n => n != null));
    for (const entries of sorted) {
      const slot = entries[0].slot;
      let number = slot.number;
      if (number == null) { number = slot.index+1; if (reserved.has(number)) number = Math.max(0, ...reserved)+1; reserved.add(number); }
      out.push({group, name: slot.name, number, refs: entries.filter(e => e.slot.servers.length).map(({version,slot}) => ({
        path: version.path, index: slot.index, language: version.language, script: version.script
      }))});
    }
  }
  return out;
}
module.exports = { LANGUAGES, inlineScripts, cards, hasNext, detail, episodeScript, episodeLabels, episodeSlots, orderedRows };
