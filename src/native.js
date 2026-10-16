const { AnimeSamaProvider } = require('./provider');
const { defaults } = require('./config');
const Id = require('./ids');
const Catalog = require('./catalog-context');
const {nativeStream} = require('./streams');
const {version:pluginVersion} = require('../package.json');
function clean(value) { return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim(); }
function failure(code) { return Object.assign(new Error(code),{code}); }
function nativeProvider(settings) {
  return new AnimeSamaProvider({animeSamaBaseUrl:settings.animeSamaBaseUrl || defaults.animeSamaBaseUrl,version:settings.version || defaults.version},
    settings.diagnostics ? {onMetrics:metrics => console.log('[Anime-Sama] resolution',JSON.stringify(metrics))} : {});
}
function diagnostic(settings,stage,data) {
  if (settings.diagnostics) console.log('[Anime-Sama]',stage,JSON.stringify(data));
}
function titleNames(metadata) {
  return [...new Set([metadata.name,metadata.title,metadata.original_name,metadata.original_title,...(metadata.aliases || []),
    ...(metadata.alternative_titles?.titles || metadata.alternative_titles?.results || []).map(t => t.title),
    ...(metadata.translations?.translations || []).filter(t => ['en','fr','ja'].includes(t.iso_639_1)).map(t => t.data?.title || t.data?.name)].filter(v => typeof v === 'string' && clean(v)))];
}
function exactTitle(names,card) { return [card.title,...(card.aliases || [])].some(n => names.has(clean(n))); }
function compatibleYear(detail,metadata,type) {
  const year = Number(String((type === 'movie' ? metadata.release_date : metadata.first_air_date) || '').slice(0,4));
  return !detail.year || !year || Math.abs(detail.year-year) <= 1 || (metadata.sourceSeason > 1 && detail.year <= year);
}
async function sourceTitle(provider,metadata,type) {
  const titles = titleNames(metadata), names = new Set(titles.map(clean)), candidates = new Map();
  for (const title of titles.slice(0,3)) {
    const search = await provider.search(title);
    for (const card of search.items) candidates.set(card.path,card);
    const exact = search.items.filter(c => exactTitle(names,c));
    if (exact.length === 1) {
      const detail = await provider.details(exact[0].path);
      if (compatibleYear(detail,metadata,type)) return detail;
    }
    // The website indexes translated/original aliases. Check actual detail aliases,
    // rather than rejecting a card whose primary title uses another language.
    if (search.items.length && search.items.length <= 4) {
      const matched = [];
      for (const card of search.items) {
        const detail = await provider.details(card.path);
        if (exactTitle(names,detail) && compatibleYear(detail,metadata,type)) matched.push(detail);
      }
      if (matched.length === 1) return matched[0];
      if (matched.length > 1) throw failure('AMBIGUOUS_SOURCE_TITLE');
    }
  }
  if (candidates.size) throw failure('NO_EXACT_SOURCE_ALIAS');
  throw failure('SOURCE_TITLE_NOT_FOUND');
}
function declaredRange(group) {
  // Ongoing sagas publish "Episode 1156 à ..." (or a Unicode ellipsis).
  // This selects a group only; the actual numbered source slot must still exist.
  const m = /\[?\s*[ÉE]pisodes?\s*(\d+)\s*(?:à|a|-)\s*(\d+|\.{3}|…)/i.exec(group.name);
  if (!m) return null;
  const first = Number(m[1]), last = /^\d+$/.test(m[2]) ? Number(m[2]) : Infinity;
  return first > 0 && last >= first ? {first,last} : null;
}
function chooseCatalogEpisode(context,requested) {
  if (context.absolute) return {number:requested,position:requested-1};
  const episodes = context.episodes || [];
  // Some anime catalogs number seasons continuously (e.g. One Piece S2 starts
  // at 62), while others send a season-local episode 1. Preserve an exact number;
  // use its explicit catalog position only when that number is absent.
  const exact = episodes.findIndex(e => e.episode_number === requested);
  const position = exact >= 0 ? exact : requested-1;
  if (!Number.isInteger(position) || !episodes[position]) throw failure('CATALOG_EPISODE_NOT_FOUND');
  return {number:episodes[position].episode_number,position,count:episodes.length,
    ...(context.absoluteOffset != null ? {absoluteNumber:context.absoluteOffset+position+1} : {})};
}
async function episodeReferences(provider,detail,context,season,episode) {
  const selected = chooseCatalogEpisode(context,episode);
  const regular = detail.groups.filter(g => /^saison\d+(?:p\d+)?$/.test(g.path.split('/').filter(Boolean).pop()));
  const direct = regular.find(g => g.path === detail.path+`saison${season}/`);
  const rangeNumber = selected.absoluteNumber || selected.number;
  const ranges = regular.filter(g => { const r = declaredRange(g); return r && rangeNumber >= r.first && rangeNumber <= r.last; });
  const useRange = context.absolute || rangeNumber > selected.position+1;
  if (useRange && ranges.length > 1) throw failure('SOURCE_SEASON_AMBIGUOUS');
  let group = ranges.length === 1 && useRange ? ranges[0] : direct;
  // A single source season can contain a show's complete continuous episode list.
  if (!group && regular.length === 1 && (context.absolute || rangeNumber > selected.position+1)) group = regular[0];
  if (!group) throw failure('SOURCE_SEASON_NOT_FOUND');
  const range = declaredRange(group);
  if (range && (rangeNumber < range.first || rangeNumber > range.last)) throw failure('SOURCE_EPISODE_UNAVAILABLE');
  const versions = await provider.versions(group,provider.config.version);
  if (!versions.length) throw failure('SOURCE_VERSION_UNAVAILABLE');
  const refs = versions.flatMap(v => {
    const first = v.episodes[0]?.number;
    const target = range || (regular.length === 1 && !direct) ? rangeNumber : selected.number;
    let slot = v.episodes.find(e => e.number === target);
    // Index fallback is safe only for an unnumbered ordinary season. Never hide
    // a disagreement with a declared saga range by returning a different video.
    if (!slot && !range && first === 1 && group === direct) slot = v.episodes[selected.position];
    return slot?.servers.length ? [{path:v.path,index:slot.index,language:v.language,script:v.script}] : [];
  });
  if (!refs.length) throw failure('SOURCE_EPISODE_UNAVAILABLE');
  return refs;
}
async function resolveSelection(provider,id,type,season,episode,settings,key) {
  let map = {};
  if (settings.sourceMap) {
    map = JSON.parse(settings.sourceMap);
    if (!map || typeof map !== 'object' || Array.isArray(map)) throw failure('INVALID_SOURCE_MAP');
  }
  const binding = map[`${type}:${id}`];
  if (binding) {
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
  const metadata = await Catalog.titleContext(provider,id,type,key,season);
  type = metadata.kind || type;
  season = metadata.sourceSeason || season;
  diagnostic(settings,'catalog',{id,type,name:metadata.name || metadata.title,season,episode});
  if (!metadata.genres?.some(g => g.id === 16)) return [];
  const detail = await sourceTitle(provider,metadata,type);
  diagnostic(settings,'source',{title:detail.title,path:detail.path});
  if (type === 'movie') {
    if (detail.groups.length !== 1 || !/\/films?\/$/.test(detail.groups[0].path)) throw failure('MOVIE_GROUP_AMBIGUOUS');
    const versions = await provider.versions(detail.groups[0],provider.config.version);
    if (versions.some(v => v.episodes.length !== 1)) throw failure('MOVIE_GROUP_AMBIGUOUS');
    return versions.filter(v => v.episodes[0]?.servers.length).map(v => ({path:v.path,index:0,language:v.language,script:v.script}));
  }
  const context = await Catalog.seasonContext(provider,id,season,key,metadata);
  const refs = await episodeReferences(provider,detail,context,season,episode);
  diagnostic(settings,'episode',{count:context.episodes?.length,refs:refs.map(r => ({path:r.path,index:r.index,language:r.language}))});
  return refs;
}
async function getStreams(tmdbId,mediaType,season,episode) {
  try {
    const settings = typeof SCRAPER_SETTINGS === 'undefined' ? {} : SCRAPER_SETTINGS;
    console.info('[Anime-Sama]',pluginVersion,'getStreams',Catalog.nativeId(tmdbId) || 'source/unsupported ID',mediaType,season,episode);
    const provider = nativeProvider(settings);
    if (String(tmdbId).startsWith('as:ep:')) return (await provider.streams(tmdbId)).streams.map(nativeStream);
    const id = Catalog.nativeId(tmdbId), type = ['tv','series','show','anime'].includes(mediaType) ? 'tv' : mediaType;
    if (!id || !['tv','movie'].includes(type)) {
      diagnostic(settings,'unsupported catalog ID',{prefix:String(tmdbId).split(':')[0],mediaType});
      return [];
    }
    season = season == null ? 1 : Number(season); episode = episode == null ? 1 : Number(episode);
    if (type === 'tv' && (!Number.isInteger(season) || season < 1 || !Number.isInteger(episode) || episode < 1)) return [];
    const key = typeof TMDB_API_KEY === 'string' ? TMDB_API_KEY.trim() : '';
    const refs = await resolveSelection(provider,id,type,season,episode,settings,key);
    return refs.length ? (await provider.streams(Id.encodeEpisode(refs),{reuseDiscovery:true})).streams.map(nativeStream) : [];
  } catch (error) { console.warn('[Anime-Sama]',error.code || (error.status ? `HTTP ${error.status}` : 'Source unavailable.')); return []; }
}
function onSettings() {
  return [
    {type:'info',label:`Anime-Sama ${pluginVersion} · Métadonnées Nuvio Catalog. Le test de fournisseur Nuvio utilise Matrix (non disponible sur Anime-Sama) : tester avec un véritable épisode animé.`},
    {type:'text',key:'animeSamaBaseUrl',label:'Adresse du site Anime-Sama',placeholder:defaults.animeSamaBaseUrl,description:'Laisser vide pour utiliser la configuration du plugin.'},
    {type:'select',key:'version',label:'Version',defaultValue:defaults.version,options:[{label:'Toutes les versions',value:'all'},{label:'VOSTFR',value:'vostfr'},{label:'VF',value:'vf'}]},
    {type:'text',key:'sourceMap',label:'Correspondances TMDB (JSON)',description:'Correspondances personnalisées facultatives pour des cas ambigus. Voir le README.'},
    {type:'toggle',key:'diagnostics',label:'Diagnostic',defaultValue:false,description:'Journaliser les étapes et les causes des liens manquants, sans URL signée ni clé API.'}
  ];
}
module.exports = { getStreams, onSettings, resolveSelection, clean, sourceTitle, chooseCatalogEpisode, episodeReferences };
