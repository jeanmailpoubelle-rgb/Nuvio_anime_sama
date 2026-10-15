function streamObject(media) {
  const bits = ['Anime-Sama',media.source];
  if (media.quality) bits.push(media.adaptive ? `${media.quality} max · Auto` : media.quality);
  bits.push(media.version);
  const codecs = media.codecs?.join(', ');
  const title = [...bits,...(codecs ? [codecs] : []),...(media.videoRange ? [media.videoRange] : [])].join(' • ');
  return {name:title, title, url:media.url, provider:media.source, source:media.source,
    ...(media.quality ? {quality:media.quality} : {}), version:media.version,
    language:media.version, type:media.type,
    ...(media.audioLanguages?.length ? {audioLanguages:media.audioLanguages} : {}),
    ...(media.subtitleLanguages?.length ? {subtitleLanguages:media.subtitleLanguages} : {}),
    ...(media.codecs ? {codecs:media.codecs} : {}), ...(media.videoRange ? {videoRange:media.videoRange} : {}),
    ...(media.qualities ? {qualities:media.qualities} : {}), ...(media.adaptive ? {adaptive:true} : {}),
    headers:media.headers, ...(media.subtitles?.length ? {subtitles:media.subtitles} : {})};
}
function deduplicate(streams) {
  const seen = new Set();
  return streams.filter(s => {
    // Different versions and playback-header requirements are distinct choices.
    const key = JSON.stringify([s.url,s.version,Object.entries(s.headers || {}).sort(([a],[b]) => a.localeCompare(b))]);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}
function addonStream(stream) {
  return {...stream, behaviorHints:{notWebReady:true,bingeGroup:`anime-sama:${stream.version}:${stream.source}`,
    proxyHeaders:{request:stream.headers}}};
}
module.exports = { streamObject, deduplicate, addonStream };
