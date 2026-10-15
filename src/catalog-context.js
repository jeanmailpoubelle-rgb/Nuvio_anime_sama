const cheerio = require('cheerio');
const NUVIO_CATALOG_URL = 'https://catalog.nuvio.tv';
function nativeId(value) {
  const kitsu = /^(?:kitsu|kitsu-anime)[:/](\d+)(?=[:/]|$)/i.exec(String(value || '').trim());
  if (kitsu) return 'kitsu:'+kitsu[1];
  const id = String(value || '').trim().replace(/^(?:tmdb|movie|series|tv)[:/]/i,'').split(/[:/]/)[0];
  return /^(?:\d+|tt\d+)$/i.test(id) ? id.toLowerCase() : null;
}
function jsonLd(html,type) {
  const $ = cheerio.load(html), found = [];
  $('script[type="application/ld+json"]').each((_i,el) => {
    try {
      const raw = $(el).html() || '';
      const data = JSON.parse(raw.slice(raw.indexOf('{'),raw.lastIndexOf('}')+1));
      const entries = data['@graph'] || [data];
      for (const entry of entries) if ([].concat(entry['@type'] || []).includes(type === 'tv' ? 'TVSeries' : 'Movie')) found.push(entry);
    } catch (_error) { /* An unrelated/invalid schema block is not catalog metadata. */ }
  });
  if (found.length !== 1) throw Object.assign(new Error('Public title metadata unavailable.'),{code:'METADATA_UNAVAILABLE'});
  return {data:found[0],$};
}
function publicTitle(html,type) {
  const {data,$} = jsonLd(html,type);
  const names = [data.name,...[].concat(data.alternateName || [])].filter(v => typeof v === 'string' && v.trim());
  const genres = [].concat(data.genre || []).filter(v => typeof v === 'string');
  let original;
  $('.facts p').each((_i,el) => {
    const text = $(el).text().trim();
    const m = /^Original (?:Name|Title)\s+(.+)$/.exec(text);
    if (m) original = m[1].trim();
  });
  if (!names.length) throw Object.assign(new Error('Public title name unavailable.'),{code:'METADATA_UNAVAILABLE'});
  const date = type === 'tv' ? data.startDate : data.datePublished;
  return {name:names[0],original_name:original,aliases:names.slice(1),
    genres:genres.map(name => ({name,id:/^animation$/i.test(name) ? 16 : undefined})),
    ...(type === 'tv' ? {first_air_date:date} : {title:names[0],release_date:date})};
}
function publicSeason(html) {
  const $ = cheerio.load(html), episodes = [];
  $('.episode_list .episode').each((_i,el) => {
    const row = $(el), raw = row.find('.episode_number').first().text().trim();
    if (!/^\d+$/.test(raw)) return;
    const episode_number = Number(raw);
    if (episodes.some(e => e.episode_number === episode_number)) return;
    episodes.push({episode_number,name:row.find('.episode_title a').first().text().trim()});
  });
  if (!episodes.length) throw Object.assign(new Error('Public season episodes unavailable.'),{code:'SEASON_UNAVAILABLE'});
  return {episodes};
}
async function api(provider,path,key) {
  const auth = key.includes('.') ? {Authorization:`Bearer ${key}`} : {};
  const url = 'https://api.themoviedb.org/3'+path+(path.includes('?') ? '&':'?')+(key.includes('.') ? '' : 'api_key='+encodeURIComponent(key));
  const r = await provider.http.request(url,{headers:auth,category:'mapping'});
  return JSON.parse(r.body);
}
// Cinemeta's long-running shows can exceed Nuvio's 1 MiB response cap. Read the
// complete identity header and complete video entries only through the requested
// season, instead of parsing an oversized/truncated whole-show response.
function cinemetaMeta(raw,season) {
  const start = /^\s*\{\s*"meta"\s*:\s*\{/.exec(raw);
  if (!start) throw Object.assign(new Error('Invalid catalog metadata.'),{code:'METADATA_UNAVAILABLE'});
  let depth=2,quote=false,escaped=false,videos=-1,header;
  for(let i=start[0].length;i<raw.length;i++) {
    const ch=raw[i];
    if(quote) {if(escaped)escaped=false;else if(ch==='\\')escaped=true;else if(ch==='"')quote=false;continue;}
    if(ch==='"') {
      if(depth===2 && raw.startsWith('"videos"',i)) {
        let j=i+8;while(/\s/.test(raw[j] || '') && j<raw.length)j++;
        if(raw[j]===':') {
          j++;while(/\s/.test(raw[j] || '') && j<raw.length)j++;
          if(raw[j]==='[') {header=JSON.parse(raw.slice(0,i).replace(/,\s*$/,'')+'}}').meta;videos=j+1;break;}
        }
      }
      quote=true;
    } else if(ch==='{' || ch==='[')depth++;
    else if(ch==='}' || ch===']')depth--;
  }
  if(videos<0)return JSON.parse(raw).meta;
  const selected=[];let offset=0,objectStart=-1;depth=0;quote=false;escaped=false;
  for(let i=videos;i<raw.length;i++) {
    const ch=raw[i];
    if(quote) {if(escaped)escaped=false;else if(ch==='\\')escaped=true;else if(ch==='"')quote=false;continue;}
    if(ch==='"'){quote=true;continue;}
    if(ch==='{'){if(depth===0)objectStart=i;depth++;}
    else if(ch==='}') {
      depth--;
      if(depth===0 && objectStart>=0) {
        const v=JSON.parse(raw.slice(objectStart,i+1)),number=Number(v.episode),group=Number(v.season);
        if(group>season)break;
        if(Number.isInteger(number) && number>0) {
          if(group>0 && group<season)offset++;
          else if(group===season)selected.push({episode_number:number,name:v.title});
        }
      }
    } else if(ch===']' && depth===0)break;
  }
  return {...header,catalogEpisodes:selected,absoluteOffset:offset};
}
async function titleContext(provider,id,type,key = '',season = 1) {
  if (id.startsWith('kitsu:')) {
    const r = await provider.http.request(`https://kitsu.io/api/edge/anime/${id.slice(6)}`,{category:'mapping'});
    const attributes = JSON.parse(r.body)?.data?.attributes;
    if (!attributes?.canonicalTitle) throw Object.assign(new Error('Kitsu catalog metadata unavailable.'),{code:'METADATA_UNAVAILABLE'});
    const aliases = [...Object.values(attributes.titles || {}),...(attributes.abbreviatedTitles || [])].filter(v => typeof v === 'string');
    const seasonName = [attributes.canonicalTitle,...aliases].map(v => /\b(?:season\s+(\d+)|(\d+)(?:nd|rd|th)\s+season)\b/i.exec(v)).find(Boolean);
    return {name:attributes.canonicalTitle,title:attributes.canonicalTitle,aliases,genres:[{id:16,name:'Animation'}],
      first_air_date:attributes.startDate,release_date:attributes.startDate,kind:attributes.subtype === 'movie' ? 'movie':'tv',
      sourceSeason:seasonName ? Number(seasonName[1] || seasonName[2]):undefined,absolute:true};
  }
  // Resolve against the same public metadata used by Nuvio Catalog. One request
  // supplies both identity and episode numbers, without app keys or HTML scraping.
  try {
    const catalogId = id.startsWith('tt') ? id : 'tmdb:'+id;
    const r = await provider.http.request(`${NUVIO_CATALOG_URL}/meta/${type === 'tv' ? 'series':'movie'}/${catalogId}.json`,{category:'mapping'});
    const meta = cinemetaMeta(r.body,season);
    if (!meta?.name || !Array.isArray(meta.genres) || (type === 'tv' && !meta.catalogEpisodes?.length)) throw new Error('Incomplete catalog metadata.');
    return {name:meta.name,title:meta.name,aliases:meta.aliases || [],
      genres:meta.genres.map(name => ({name,id:/^animation$/i.test(name)?16:undefined})),
      first_air_date:meta.released || meta.releaseInfo,release_date:meta.released || meta.releaseInfo,
      catalogEpisodes:meta.catalogEpisodes,absoluteOffset:meta.absoluteOffset};
  } catch (_error) { /* Isolated fallback for catalog outages or unsupported identities. */ }
  if (id.startsWith('tt')) {
    const r = await provider.http.request(`https://v3-cinemeta.strem.io/meta/${type === 'tv' ? 'series':'movie'}/${id}.json`,{category:'mapping'});
    const meta = cinemetaMeta(r.body,season);
    if (!meta?.name) throw Object.assign(new Error('IMDb catalog metadata unavailable.'),{code:'METADATA_UNAVAILABLE'});
    return {name:meta.name,title:meta.name,aliases:meta.aliases || [],genres:(meta.genres || []).map(name => ({name,id:/^animation$/i.test(name)?16:undefined})),
      first_air_date:meta.year || meta.releaseInfo,release_date:meta.year || meta.releaseInfo,catalogEpisodes:meta.catalogEpisodes,absoluteOffset:meta.absoluteOffset};
  }
  if (key) {
    try { return await api(provider,`/${type}/${id}?append_to_response=translations,alternative_titles`,key); }
    catch (_error) { /* The plugin must not stop at a missing, rejected or unavailable app key. */ }
  }
  const r = await provider.http.request(`https://www.themoviedb.org/${type}/${id}`,{category:'mapping'});
  return publicTitle(r.body,type);
}
async function seasonContext(provider,id,season,key = '',metadata) {
  if (id.startsWith('kitsu:')) return {absolute:true};
  if (metadata?.catalogEpisodes?.length) return {episodes:metadata.catalogEpisodes,absoluteOffset:metadata.absoluteOffset};
  if (id.startsWith('tt')) {
    const episodes = metadata?.catalogEpisodes || [];
    if (!episodes.length) throw Object.assign(new Error('IMDb catalog season unavailable.'),{code:'SEASON_UNAVAILABLE'});
    return {episodes,absoluteOffset:metadata.absoluteOffset};
  }
  if (key) {
    try { return await api(provider,`/tv/${id}/season/${season}`,key); }
    catch (_error) { /* Public TMDB episode lists require no credentials. */ }
  }
  const r = await provider.http.request(`https://www.themoviedb.org/tv/${id}/season/${season}`,{category:'mapping'});
  return publicSeason(r.body);
}
module.exports = {cinemetaMeta,nativeId,publicTitle,publicSeason,titleContext,seasonContext};
