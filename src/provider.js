const { configuration } = require('./config');
const { Cache } = require('./cache');
const { HttpClient } = require('./http');
const { Dispatcher } = require('./extractors/dispatcher');
const { mapLimit, deadline } = require('./concurrency');
const Pages = require('./pages');
const Id = require('./ids');
const U = require('./url');
const { streamObject, deduplicate } = require('./streams');
const HOME = {
  latest:{name:'Derniers épisodes',selector:'#containerSorties'},
  added:{name:'Animes récemment ajoutés',selector:'#containerAjoutsAnimes'},
  classics:{name:'Classiques',selector:'#containerClassiques'},
  favorites:{name:'Pépites',selector:'#containerPepites'},
  all:{name:'Tous les animes'}, vf:{name:'Catalogue VF'}, today:{name:'Planning du jour'}
};
function missing(error) { return [404,410].includes(error.status); }
class AnimeSamaProvider {
  constructor(overrides = {}, dependencies = {}) {
    this.config = configuration(overrides);
    this.http = new HttpClient(this.config,dependencies.fetch || fetch);
    this.cache = new Cache(200);
    this.dispatcher = new Dispatcher(this.http,this.config);
    this.onMetrics = dependencies.onMetrics;
  }
  get base() { return this.config.animeSamaBaseUrl; }
  async page(path,referer = this.base+'/',ttl = this.config.metadataCacheMs,metrics,signal) {
    const key = `${ttl ? 'cached' : 'fresh'}:${this.base}${path}`;
    return this.cache.get(key,ttl,async sharedSignal => {
      try {
        const result = await this.http.request(this.base+path,{headers:{Referer:referer,...(!ttl ? {'Cache-Control':'no-cache'} : {})},signal:sharedSignal,category:'discovery'},metrics);
        return {...result,fetchedAt:Date.now()};
      }
      catch (error) { if (missing(error)) return null; throw error; }
    },signal);
  }
  async search(query,page = 1) {
    if (!String(query || '').trim()) return {items:[],hasNext:false};
    const path = '/catalogue/?type%5B%5D=Anime&search='+encodeURIComponent(query.trim())+'&page='+Math.max(1,page);
    const response = await this.page(path);
    if (!response) return {items:[],hasNext:false};
    return {items:Pages.cards(response.body,this.base+path),hasNext:Pages.hasNext(response.body,this.base+path,page)};
  }
  async catalog(id = 'all',page = 1) {
    if (!HOME[id]) throw new Error('Unknown catalog.');
    if (id === 'all' || id === 'vf') {
      const path = '/catalogue/?type%5B%5D=Anime'+(id === 'vf' ? '&langue%5B%5D=VF':'')+'&page='+Math.max(1,page);
      const r = await this.page(path);
      return r ? {items:Pages.cards(r.body,this.base+path),hasNext:Pages.hasNext(r.body,this.base+path,page)} : {items:[],hasNext:false};
    }
    const r = await this.page('/');
    if (!r) return {items:[],hasNext:false};
    let selector = HOME[id].selector;
    if (id === 'today') {
      // Europe/Paris Intl is available in Node, but not all native plugin engines.
      // Home is served by the companion Node addon, not getStreams.
      const day = new Intl.DateTimeFormat('en-US',{timeZone:'Europe/Paris',weekday:'long'}).format(new Date());
      selector = '#container'+({Sunday:'Dimanche',Monday:'Lundi',Tuesday:'Mardi',Wednesday:'Mercredi',Thursday:'Jeudi',Friday:'Vendredi',Saturday:'Samedi'}[day]);
    }
    const all = Pages.cards(r.body,this.base+'/',selector), offset = (Math.max(1,page)-1)*24;
    return {items:all.slice(offset,offset+24),hasNext:offset+24<all.length};
  }
  async details(path) {
    path = U.rootPath(path);
    const r = await this.page(path);
    if (!r) throw new Error('Title unavailable.');
    const result = Pages.detail(r.body,this.base+path);
    // Images hosted on the same Anime-Sama origin also follow a domain change.
    if (result.poster && new URL(result.poster).pathname.startsWith('/catalogue/')) result.poster = U.onSite(result.poster,this.base);
    return result;
  }
  async version(group,language) {
    const path = group.path+language+'/';
    return this.cache.get(`version:${this.base}${path}`,this.config.episodeCacheMs,async () => {
      const page = await this.page(path);
      if (!page) return null;
      const script = Pages.episodeScript(page.body,this.base+path);
      if (!script) return null;
      const data = await this.page(script,this.base+path,this.config.episodeCacheMs);
      if (!data) return null;
      const episodes = Pages.episodeSlots(data.body,page.body,this.base+path);
      return episodes.length ? {group,language,path,script,episodes} : null;
    });
  }
  async versions(group,track = 'all') {
    const languages = [...new Set(['vostfr','vf',...group.languages])].filter(l => Id.accepts(track,l));
    const attempt = async l => { try { return await this.version(group,l); } catch (_error) { return null; } };
    const primary = (await mapLimit(languages,2,attempt)).filter(Boolean);
    if (track !== 'vostfr' && !primary.some(v => v.language.startsWith('vf'))) {
      primary.push(...(await mapLimit(['vf1','vf2'].filter(l => !languages.includes(l)),2,attempt)).filter(Boolean));
    }
    return primary;
  }
  async episodes(path,track = this.config.version) {
    const detail = await this.details(path);
    const versions = (await mapLimit(detail.groups,this.config.metadataConcurrency,g => this.versions(g,'all'))).flat();
    const rows = Pages.orderedRows(detail.groups,versions);
    return {detail,versions,episodes:rows.map(row => {
      const refs = row.refs.filter(ref => Id.accepts(track,ref.language));
      return {
        id:Id.encodeEpisode(refs,track), title:`${row.group.name} · ${row.name}`,
        season:row.group.id, episode:row.number, group:row.group.name, name:row.name,
        versions:refs.map(r => r.language.toUpperCase()), available:refs.length>0, refs
      };
    })};
  }

  async streams(id,options = {}) {
    const refs = (typeof id === 'string' ? Id.decodeEpisode(id) : id.map(Id.validateRef))
      .filter(r => Id.accepts(options.track || this.config.version,r.language));
    const metrics = {elapsedMs:0,discoveryMs:0,requests:0,requestCategories:{},networkMs:0,players:0,streams:0,hosts:[]};
    const started = Date.now();
    if (!refs.length) { this.onMetrics?.(metrics); return {streams:[],metrics}; }
    const scope = deadline(this.config.resolutionTimeoutMs,options.signal);
    try {
      const lists = await mapLimit(refs,3,async ref => {
        try {
          if (scope.signal.aborted) return [];
          let script = ref.script;
          if (!script) {
            const page = await this.page(ref.path,this.base+'/',0,metrics,scope.signal);
            if (!page) return [];
            script = Pages.episodeScript(page.body,this.base+ref.path);
          }
          if (!script) return [];
          // Native automatic mapping has just fetched this script in the same
          // invocation. Reuse that public player data once rather than fetching it twice.
          const recent = options.reuseDiscovery ? this.cache.entries.get(`cached:${this.base}${script}`)?.value : null;
          const data = recent && Date.now()-recent.fetchedAt < 5000 ? recent
            : await this.page(script,this.base+ref.path,0,metrics,scope.signal);
          if (!data) return [];
          const servers = Object.values(require('./js-data').arrays(data.body)).map(a => U.server(a[ref.index],this.base+ref.path)).filter(Boolean);
          return [...new Set(servers)].map(embed => ({embed,ref}));
        } catch (_error) { return []; }
      });
      const unique = new Map();
      for (const item of lists.flat()) unique.set(item.ref.language+'|'+item.embed,item);
      const priority = url => /ansembed/i.test(url) ? 0 : /vidmoly/i.test(url) ? 1 : /smoothpre/i.test(url) ? 2 : 3;
      const players = [...unique.values()].sort((a,b) => priority(a.embed)-priority(b.embed));
      metrics.discoveryMs = Date.now()-started; metrics.players = players.length;
      const collected = [];
      let graceTimer, signalReady;
      const ready = new Promise(resolve => { signalReady = resolve; });
      const work = mapLimit(players,this.config.extractorConcurrency,async ({embed,ref}) => {
        if (scope.signal.aborted) return;
        const media = await this.dispatcher.extract(embed,this.base+ref.path,ref.language,metrics,scope.signal);
        if (media.length) {
          collected.push(...media);
          if (!graceTimer) graceTimer = setTimeout(signalReady,this.config.successGraceMs);
        }
      });
      try {
        await Promise.race([work,ready]);
        // Cancel unfinished network work and let reports settle before returning.
        scope.cancel();
        await work;
      } finally { if (graceTimer) clearTimeout(graceTimer); }
      const streams = deduplicate(collected.map(streamObject));
      metrics.streams = streams.length;
      return {streams,metrics};
    } finally { scope.close(); metrics.elapsedMs = Date.now()-started; this.onMetrics?.(metrics); }
  }
}
module.exports = { AnimeSamaProvider, HOME };
