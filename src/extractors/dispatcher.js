const cheerio = require('cheerio');
const Player = require('./player-pages');
const Voe = require('./voe');
const Hls = require('./hls');
const Mp4 = require('./mp4');
const U = require('../url');
const { USER_AGENT } = require('../http');
const { mapLimit, deadline } = require('../concurrency');
class Dispatcher {
  constructor(http,config) { this.http = http; this.config = config; }
  async extract(embed,referer,language,metrics,parent) {
    const started = Date.now(), scope = deadline(this.config.hostTimeoutMs,parent);
    const report = {host:new URL(embed).hostname, source:Player.hostName(embed), ms:0, streams:0};
    metrics.hosts.push(report);
    try {
      let url = Player.normalizeEmbed(embed), html = '';
      // One HTTP fetch per player, including generic fallback. Never refetch an embed
      // simply because the first parser did not recognize its host.
      for (let attempt = 0; attempt <= 2; attempt++) {
        const page = await this.http.request(url,{headers:{Referer:referer,'Sec-Fetch-Dest':'iframe'}, category:'embed',signal:scope.signal},metrics);
        url = page.url; html = page.body;
        const next = Player.redirect(html,url);
        if (!next) break;
        if (next === url || attempt === 2) throw new Error('Redirect loop.');
        url = next;
      }
      report.source = Player.hostName(url,html);
      const headers = {'User-Agent':USER_AGENT, Referer:url, Origin:new URL(url).origin};
      const parsed = Player.sources(html,url);
      if (!parsed.media.length) {
        parsed.media.push(...Voe.sources(html,url));
        if (report.source === 'Sendvid') {
          const $ = cheerio.load(html), raw = $('meta[property="og:video:secure_url"]').attr('content');
          const direct = U.absolute(raw,url);
          if (direct && /\.(m3u8|mp4)(?:\?|$)/i.test(direct)) parsed.media.push({url:direct,type:/\.m3u8/i.test(direct) ? 'hls':'video'});
        }
      }
      if (!parsed.media.length) { report.reason = 'No supported player source'; return []; }
      const candidates = [...new Map(parsed.media.map(m => [m.url,m])).values()];
      const streams = [];
      // Mirrors of one HLS are fallback routes, not separate quality choices.
      // One preferred route costs one master + one healthy variant request.
      const groups = new Map();
      for (const media of candidates) {
        if (!groups.has(media.type)) groups.set(media.type,[]);
        groups.get(media.type).push(media);
      }
      await mapLimit([...groups.values()],2,async list => {
        for (const media of list) {
          if (scope.signal.aborted) break;
          try {
            const enriched = await this.validate(media,headers,report.source,scope.signal,metrics);
            streams.push({ ...media, source:report.source, version:language.toUpperCase(), headers,
              subtitles:parsed.subtitles.map(s => ({...s,headers})),
              ...(['vf','vf1','vf2','vqc'].includes(language) ? {audioLanguages:['fr']} : {}),
              ...(language === 'vostfr' ? {subtitleLanguages:['fr']} : {}), ...enriched });
            break;
          } catch (e) { report.reason = e.code || e.message; }
        }
      });
      report.streams = streams.length;
      return streams;
    } catch (error) { report.reason = error.code || error.message; return []; }
    finally { report.ms = Date.now()-started; scope.close(); }
  }
  async validate(media,headers,source,signal,metrics) {
    const options = {headers,signal,category:'validation'};
    if (media.type === 'hls') {
      const master = await this.http.request(media.url,options,metrics);
      const hls = Hls.parse(master.body,master.url);
      if (!hls.variants.length) return {type:'hls',url:master.url};
      const best = hls.variants.slice().sort((a,b) => (b.height || 0)-(a.height || 0)).slice(0,2);
      let highest;
      for (const variant of best) {
        try {
          const r = await this.http.request(variant.url,options,metrics);
          Hls.parse(r.body,r.url); highest = variant; break;
        } catch (_error) { if (signal.aborted) break; }
      }
      if (!highest) throw new Error('HLS variants unavailable.');
      const audio = hls.tracks.filter(t => t.type === 'AUDIO' && t.language && (!highest.audioGroup || t.group === highest.audioGroup)).map(t => t.language);
      const subtitles = hls.tracks.filter(t => t.type === 'SUBTITLES' && t.language && (!highest.subtitleGroup || t.group === highest.subtitleGroup)).map(t => t.language);
      const directFallback = highest !== best[0] && !hls.tracks.length && !highest.audioGroup && !highest.subtitleGroup;
      return {type:'hls',url:directFallback ? highest.url : master.url, adaptive:!directFallback, ...(highest.quality ? {quality:highest.quality} : {}),
        qualities:directFallback ? [highest.quality].filter(Boolean) : [...new Set(hls.variants.map(v => v.quality).filter(Boolean))],
        ...(highest.codecs ? {codecs:highest.codecs} : {}), ...(highest.videoRange ? {videoRange:highest.videoRange} : {}),
        ...(audio.length ? {audioLanguages:[...new Set(audio)]} : {}), ...(subtitles.length ? {subtitleLanguages:[...new Set(subtitles)]} : {})};
    }
    if (media.type === 'dash') {
      const r = await this.http.request(media.url,options,metrics);
      if (!/<MPD(?:\s|>)/.test(r.body.slice(0,100000))) throw new Error('Invalid DASH manifest.');
      return {};
    }
    if (source === 'Sendvid') {
      const r = await this.http.request(media.url,{...options,headers:{...headers,Range:'bytes=0-65535'},binary:true,prefix:true,maxBytes:65536},metrics);
      if (/text\/html/i.test(r.headers.get('content-type') || '') || !r.body.length) throw new Error('Invalid Sendvid media.');
      const seconds = Mp4.duration(r.body);
      if (seconds != null && seconds <= 10) throw new Error('Sendvid unavailable-video placeholder');
      return {};
    }
    try {
      const r = await this.http.request(media.url,{...options,method:'HEAD'},metrics);
      if (/text\/html/i.test(r.headers.get('content-type') || '')) throw new Error('HTML instead of video.');
    } catch (e) { if (e.status !== 405) throw e; }
    return {};
  }
}
module.exports = { Dispatcher };
