const U = require('../url');
function attributes(line) {
  const out = {};
  for (const m of line.matchAll(/([A-Z0-9-]+)=("(?:[^"\\]|\\.)*"|[^,]*)/g)) out[m[1]] = m[2].replace(/^"|"$/g,'');
  return out;
}
function parse(body,base) {
  if (!body.replace(/^[\uFEFF\s]+/,'').startsWith('#EXTM3U')) throw new Error('Invalid HLS playlist.');
  const lines = body.split(/\r?\n/).map(s => s.trim()), variants = [], tracks = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('#EXT-X-STREAM-INF:')) {
      const a = attributes(lines[i]);
      const raw = lines.slice(i+1).find(s => s && !s.startsWith('#'));
      const url = U.absolute(raw,base), resolution = /^\d+x(\d+)$/.exec(a.RESOLUTION || '');
      if (url) variants.push({url,...(resolution ? {quality:`${Number(resolution[1])}p`,height:Number(resolution[1])} : {}),
        ...(a.CODECS ? {codecs:a.CODECS.split(',')} : {}), ...(a['VIDEO-RANGE'] ? {videoRange:a['VIDEO-RANGE']} : {}),
        ...(a.AUDIO ? {audioGroup:a.AUDIO} : {}), ...(a.SUBTITLES ? {subtitleGroup:a.SUBTITLES} : {})});
    } else if (lines[i].startsWith('#EXT-X-MEDIA:')) {
      const a = attributes(lines[i]);
      if (['AUDIO','SUBTITLES'].includes(a.TYPE)) tracks.push({type:a.TYPE,group:a['GROUP-ID'],language:a.LANGUAGE,name:a.NAME,url:U.absolute(a.URI,base)});
    }
  }
  const segments = variants.length ? [] : lines.filter(s => s && !s.startsWith('#')).map(s => U.absolute(s,base)).filter(Boolean);
  if (!variants.length && !segments.length) throw new Error('Empty HLS playlist.');
  return {variants,tracks,segments};
}
module.exports = { attributes, parse };
