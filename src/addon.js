const Id = require('./ids');
const { HOME } = require('./provider');
const { addonStream } = require('./streams');
function manifest(version) {
  return {id:'fr.animesama.nuvio',name:'Anime-Sama',version,description:'Catalogue Anime-Sama, saisons, films, VF et VOSTFR.',
    resources:[{name:'catalog',types:['series'],idPrefixes:['as:']},{name:'meta',types:['series','movie'],idPrefixes:['as:']},{name:'stream',types:['series','movie'],idPrefixes:['as:']}],
    types:['series','movie'],idPrefixes:['as:'],
    catalogs:Object.entries(HOME).map(([id,item]) => ({type:'series',id:'as-'+id,name:'Anime-Sama · '+item.name,
      extra:[{name:'search',isRequired:false},{name:'skip',isRequired:false}]})),
    behaviorHints:{configurable:false,configurationRequired:false}};
}
function preview(card,track = 'all') {
  return {id:Id.titleId(card.path,track),type:'series',name:card.title,poster:card.poster,background:card.poster,posterShape:'landscape'};
}
async function catalog(provider,type,id,extra = {}) {
  if (type !== 'series' || !id.startsWith('as-')) return {metas:[]};
  const group = id.slice(3);
  const skip = Math.max(0,Number(extra.skip) || 0);
  const size = ['all','vf'].includes(group) || extra.search ? 48 : 24;
  // Respect arbitrary skip values, not only page-size multiples.
  const page = Math.floor(skip/size)+1, within = skip%size;
  const data = extra.search ? await provider.search(extra.search,page) : await provider.catalog(group,page);
  const track = group === 'vf' ? 'vf' : provider.config.version;
  return {metas:data.items.slice(within).map(c => preview(c,track))};
}
async function meta(provider,type,id) {
  const selection = Id.decodeTitle(id), track = selection.track === 'all' ? provider.config.version : selection.track;
  const result = await provider.episodes(selection.path,track), d = result.detail;
  // Catalogue cards use series even for single films so no extra per-card request
  // is needed. A film remains a named, selectable video in that series.
  const videos = result.episodes.map(e => ({id:e.id,title:e.title,season:e.season,episode:e.episode,
    thumbnail:d.poster,overview:e.available ? e.versions.join(' / ') : 'Version indisponible'}));
  return {meta:{id,type,name:d.title,description:d.plot,poster:d.poster,background:d.poster,posterShape:'landscape',
    ...(d.year ? {releaseInfo:String(d.year),year:d.year} : {}),genres:d.tags,videos,
    behaviorHints:{hasScheduledVideos:false,...(videos.length === 1 ? {defaultVideoId:videos[0].id} : {})}}};
}
async function stream(provider,_type,id) {
  const result = await provider.streams(id);
  return {streams:result.streams.map(addonStream)};
}
module.exports = {manifest,catalog,meta,stream,preview};
