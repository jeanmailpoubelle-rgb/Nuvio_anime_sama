const U = require('./url');
const { LANGUAGES } = require('./pages');
const PREFIX = 'as:ep:';
function encodeText(text) {
  return btoa(encodeURIComponent(text).replace(/%([0-9A-F]{2})/g, (_m, hex) => String.fromCharCode(parseInt(hex,16))))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decodeText(value) {
  return decodeURIComponent(Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')), c => '%' + c.charCodeAt(0).toString(16).padStart(2,'0')).join(''));
}
function validateRef(ref) {
  if (!ref || !LANGUAGES.includes(ref.language) || !Number.isInteger(ref.index) || ref.index < 0 || ref.index > 20000) throw new Error('Invalid episode reference.');
  if (U.sitePath(ref.path) !== ref.path || !ref.path.endsWith(`/${ref.language}/`)) throw new Error('Invalid language reference.');
  if (ref.script && (typeof ref.script !== 'string' || !ref.script.startsWith(ref.path) || !/^episodes\.js(?:\?[^#\r\n]*)?$/.test(ref.script.slice(ref.path.length)))) throw new Error('Invalid episode script.');
  return {path:ref.path, index:ref.index, language:ref.language, ...(ref.script ? {script:ref.script} : {})};
}
function encodeEpisode(refs, track = 'all') {
  if (!['all','vf','vostfr'].includes(track) || refs.length > 10) throw new Error('Invalid episode payload.');
  const filtered = refs.filter(r => accepts(track,r.language)).map(validateRef);
  return PREFIX + encodeText(JSON.stringify({v:1, track, refs:filtered}));
}
function accepts(track, language) {
  return track === 'all' || (track === 'vf' ? ['vf','vf1','vf2','vqc'].includes(language) : language === 'vostfr');
}
function decodeEpisode(id) {
  if (typeof id !== 'string' || !id.startsWith(PREFIX) || id.length > 12000 || !/^[A-Za-z0-9_-]+$/.test(id.slice(PREFIX.length))) throw new Error('Invalid episode ID.');
  const p = JSON.parse(decodeText(id.slice(PREFIX.length)));
  if (p.v !== 1 || !['all','vf','vostfr'].includes(p.track) || !Array.isArray(p.refs) || p.refs.length > 10) throw new Error('Invalid episode payload.');
  const refs = p.refs.map(validateRef);
  if (refs.some(r => !accepts(p.track,r.language))) throw new Error('Mixed version payload.');
  return refs;
}
function titleId(path, track = 'all') {
  const slug = U.rootPath(path).split('/')[2];
  return `as:${slug}${track === 'all' ? '' : ':' + track}`;
}
function decodeTitle(id) {
  const m = /^as:([A-Za-z0-9_%.-]+)(?::(vf|vostfr))?$/.exec(id);
  if (!m) throw new Error('Invalid title ID.');
  return {path:U.rootPath(`/catalogue/${m[1]}/`), track:m[2] || 'all'};
}
module.exports = { encodeEpisode, decodeEpisode, titleId, decodeTitle, accepts, validateRef };
