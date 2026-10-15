const { AnimeSamaProvider } = require('./provider');
const { defaults } = require('./config');
const Id = require('./ids');
function clean(value) { return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim(); }
function nativeProvider(settings) {
  return new AnimeSamaProvider({animeSamaBaseUrl:settings.animeSamaBaseUrl || defaults.animeSamaBaseUrl,version:settings.version || defaults.version});
}
async function tmdb(provider,path,key) {
  const auth = key.includes('.') ? {Authorization:`Bearer ${key}`} : {};
  const url = 'https://api.themoviedb.org/3'+path+(path.includes('?') ? '&':'?')+(key.includes('.') ? '' : 'api_key='+encodeURIComponent(key));
  const result = await provider.http.request(url,{headers:auth,category:'mapping'});
  return JSON.parse(result.body);
}
async function resolveSelection(provider,id,type,season,episode,settings,key) {
  let map = {};
  if (settings.sourceMap) {
    map = JSON.parse(settings.sourceMap);
    if (!map || typeof map !== 'object' || Array.isArray(map)) throw new Error('Invalid source map.');
  }
  const binding = map[`${type}:${id}`];
  if (binding) {
    // An explicit binding is retained provider context: no search/details/language
    // discovery on this path, and no TMDB credential is needed.
    const selected = type === 'tv' ? binding.seasons?.[String(season)] : {path:binding.group,index:binding.index};
    if (!selected?.path) return [];
    const index = type === 'movie' ? Number(selected.index || 0) : Number(episode)-1+Number(selected.indexOffset || 0);
    const languages = selected.languages || binding.languages || ['vostfr','vf'];
    if (!Array.isArray(languages)) return [];
    return languages.filter(l => Id.accepts(provider.config.version,l)).map(language => {
      const path = selected.path.replace(/\/+$/, '')+'/'+language+'/';
      return Id.validateRef({path,index,language,script:path+'episodes.js'});
    });
  }
  let path, metadata;
  {
    if (!key) throw new Error('Nuvio TMDB key unavailable; configure a source map or use the Anime-Sama addon.');
    metadata = await tmdb(provider,`/${type}/${encodeURIComponent(id)}?append_to_response=translations`,key);
    if (!metadata.genres?.some(g => g.id === 16)) return [];
    const titles = [...new Set([metadata.name,metadata.title,metadata.original_name,metadata.original_title,
      ...(metadata.translations?.translations || []).filter(t => ['en','fr','ja'].includes(t.iso_639_1)).map(t => t.data?.title || t.data?.name)].filter(Boolean))];
    const names = new Set(titles.map(clean).filter(Boolean));
    const matches = new Map();
    // Stop at a unique exact source title; do not scrape every detail page.
    for (const title of titles.slice(0,3)) {
      const search = await provider.search(title);
      for (const card of search.items) if (names.has(clean(card.title))) matches.set(card.path,card);
      if (matches.size) break;
    }
    if (matches.size !== 1) return [];
    path = [...matches.keys()][0];
  }
  const detail = await provider.details(path);
  if (metadata) {
    const year = Number((metadata.first_air_date || metadata.release_date || '').slice(0,4));
    if (detail.year && year && Math.abs(detail.year-year)>1) return [];
  }
  let group;
  if (type === 'movie') {
    group = detail.groups.length === 1 && /\/films?\/$/.test(detail.groups[0].path) ? detail.groups[0] : null;
    if (!group) return [];
  } else {
    group = detail.groups.find(g => g.path === path+`saison${season}/`);
    if (!group) return [];
  }
  const versions = await provider.versions(group,provider.config.version);
  let target = Number(episode || 1), explicitIndex;
  if (type === 'movie') {
    explicitIndex = 0;
    if (versions.some(v => v.episodes.length !== 1)) return [];
  } else {
    {
      // TMDB seasons and website sagas can have different numbering. Validate count
      // and a first episode numbered 1 instead of silently playing the wrong episode.
      const tmdbSeason = await tmdb(provider,`/tv/${encodeURIComponent(id)}/season/${Number(season)}`,key);
      if (!tmdbSeason.episodes?.length || versions.some(v => v.episodes.length !== tmdbSeason.episodes.length || v.episodes[0].number !== 1)) return [];
    }
  }
  return versions.flatMap(v => {
    const slot = explicitIndex != null ? v.episodes[explicitIndex] : v.episodes.find(e => e.number === target);
    return slot?.servers.length ? [{path:v.path,index:slot.index,language:v.language,script:v.script}] : [];
  });
}
async function getStreams(tmdbId,mediaType,season,episode) {
  try {
    const settings = typeof SCRAPER_SETTINGS === 'undefined' ? {} : SCRAPER_SETTINGS;
    const provider = nativeProvider(settings);
    if (String(tmdbId).startsWith('as:ep:')) return (await provider.streams(tmdbId)).streams;
    const id = String(tmdbId).replace(/^tmdb[:/]/,'');
    if (!/^\d+$/.test(id) || !['tv','movie'].includes(mediaType)) return [];
    const key = typeof TMDB_API_KEY === 'undefined' ? '' : TMDB_API_KEY;
    const refs = await resolveSelection(provider,id,mediaType,season,episode,settings,key);
    return refs.length ? (await provider.streams(Id.encodeEpisode(refs),{reuseDiscovery:true})).streams : [];
  } catch (error) { console.warn('[Anime-Sama]',error.status ? `HTTP ${error.status}` : 'Source unavailable or mapping uncertain.'); return []; }
}
function onSettings() {
  return [
    {type:'text',key:'animeSamaBaseUrl',label:'Adresse du site Anime-Sama',placeholder:defaults.animeSamaBaseUrl,description:'Laisser vide pour utiliser la configuration du plugin.'},
    {type:'select',key:'version',label:'Version',defaultValue:defaults.version,options:[{label:'Toutes les versions',value:'all'},{label:'VOSTFR',value:'vostfr'},{label:'VF',value:'vf'}]},
    {type:'text',key:'sourceMap',label:'Correspondances TMDB (JSON)',description:'Pour les saisons/sagas qui ne correspondent pas à TMDB. Voir le README.'}
  ];
}
module.exports = { getStreams, onSettings, resolveSelection, clean };
