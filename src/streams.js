function streamObject(media) {
  const bits = ['Anime-Sama',media.version,media.quality].filter(Boolean);
  const codecs = media.codecs?.join(', ');
  const title = bits.join(' • ');
  const format = {hls:'HLS',dash:'DASH',video:'Vidéo'}[media.type];
  const description = [media.source,format,media.adaptive ? 'Auto (qualité max)' : null,codecs,media.videoRange].filter(Boolean).join(' • ');
  return {name:title, title, description, url:media.url, provider:media.source, source:media.source,
    ...(media.quality ? {quality:media.quality} : {}), version:media.version,
    language:media.version, type:media.type,
    ...(media.audioLanguages?.length ? {audioLanguages:media.audioLanguages} : {}),
    ...(media.subtitleLanguages?.length ? {subtitleLanguages:media.subtitleLanguages} : {}),
    ...(media.codecs ? {codecs:media.codecs} : {}), ...(media.videoRange ? {videoRange:media.videoRange} : {}),
    ...(media.qualities ? {qualities:media.qualities} : {}), ...(media.adaptive ? {adaptive:true} : {}),
    headers:media.headers, ...(media.subtitles?.length ? {subtitles:media.subtitles} : {})};
}
function nativeStream(stream) {
  // Nuvio 0.5.9/0.5.10 builds its small caption from quality + size + language;
  // it ignores description. The string-valued size slot is display-only in that
  // native mapping. Supply real technical text there, without inventing a file
  // size or changing the structured quality/language fields. Keep this adaptation
  // out of addon responses and the shared stream metadata.
  return {...stream,...(stream.description ? {size:stream.description} : {})};
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
  return {...stream, title:stream.description, behaviorHints:{notWebReady:true,bingeGroup:`anime-sama:${stream.version}:${stream.source}`,
    proxyHeaders:{request:stream.headers}}};
}
module.exports = { streamObject, nativeStream, deduplicate, addonStream };
