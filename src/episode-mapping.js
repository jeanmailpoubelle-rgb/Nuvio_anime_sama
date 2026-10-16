// Translate catalog organization into authoritative source labels/array slots.
// Source group IDs include films, so they must never act as TV season numbers.
function failure(code) { return Object.assign(new Error(code),{code}); }
function declaredRange(group) {
  const m = /\[?\s*[ÉE]pisodes?\s*(\d+)\s*(?:à|a|-)\s*(\d+|\.{3}|…)/i.exec(group.name);
  if (!m) return null;
  const first = Number(m[1]), last = /^\d+$/.test(m[2]) ? Number(m[2]) : Infinity;
  return Number.isSafeInteger(first) && first > 0 && (Number.isSafeInteger(last) || last === Infinity) && last >= first ? {first,last} : null;
}
function chooseCatalogEpisode(context,requested) {
  if (context.absolute) return {number:requested,position:requested-1};
  const episodes = context.episodes || [];
  // Catalogs can expose either continuous numbers or season-local positions.
  const exact = episodes.findIndex(e => e.episode_number === requested);
  const position = exact >= 0 ? exact : requested-1;
  if (!Number.isInteger(position) || !episodes[position]) throw failure('CATALOG_EPISODE_NOT_FOUND');
  return {number:episodes[position].episode_number,position,count:episodes.length,
    ...(context.absoluteOffset != null ? {absoluteNumber:context.absoluteOffset+position+1} : {})};
}
function regularSeason(group) {
  return /^saison([1-9]\d*)(?:p([1-9]\d*))?$/.exec(group.path.split('/').filter(Boolean).pop());
}
function ref(version,slot) {
  return slot?.servers.length ? [{path:version.path,index:slot.index,language:version.language,script:version.script}] : [];
}
async function flattenedReferences(provider,groups,ordinal) {
  let offset = 0, previousSeason = 0, previousPart = 0;
  for (const group of groups) {
    const match = regularSeason(group), season = Number(match[1]), part = Number(match[2] || 1);
    // Missing/reordered seasons or parts cannot supply trustworthy offsets.
    if (!(season === previousSeason+1 && part === 1) && !(season === previousSeason && part === previousPart+1)) throw failure('SOURCE_LAYOUT_AMBIGUOUS');
    previousSeason = season; previousPart = part;
    // VF may lag behind VOSTFR. Count canonical regular slots, including dead
    // players, independently of the selected playback edition. Stop as soon as
    // the requested episode is reached; don't fetch later seasons or any films.
    const canonical = await provider.version(group,'vostfr');
    if (!canonical) throw failure('SOURCE_LAYOUT_UNAVAILABLE');
    const rows = canonical.episodes.filter(e => Number.isSafeInteger(e.number) && e.number > 0);
    const first = rows[0]?.number;
    if (!rows.length || (first !== 1 && first !== offset+1) || rows.some((e,i) => e.number !== first+i)) throw failure('SOURCE_LAYOUT_AMBIGUOUS');
    if (ordinal > offset+rows.length) { offset += rows.length; continue; }
    const local = ordinal-offset-1;
    if (local < 0) break;
    const versions = await provider.versions(group,provider.config.version);
    const refs = versions.flatMap(v => {
      const numbered = v.episodes.filter(e => Number.isSafeInteger(e.number) && e.number > 0);
      // Some editions keep global labels; others restart numbering. Named
      // specials and absent slots never become an offset into another video.
      const start = numbered[0]?.number;
      if (start !== 1 && start !== offset+1) return [];
      const matches = numbered.filter(e => e.number === start+local);
      return matches.length === 1 ? ref(v,matches[0]) : [];
    });
    if (!refs.length) throw failure('SOURCE_EPISODE_UNAVAILABLE');
    return refs;
  }
  throw failure('SOURCE_EPISODE_UNAVAILABLE');
}
async function episodeReferences(provider,detail,context,season,episode) {
  const selected = chooseCatalogEpisode(context,episode);
  const regular = detail.groups.filter(regularSeason);
  // Only a complete single-season catalog (or an explicit absolute anime ID)
  // establishes flattened numbering. Ordinary seasonal catalogs keep their
  // direct mapping, and declared saga ranges always retain precedence.
  if (season === 1 && (context.singleSeason || context.absolute) && regular.length > 1 && !regular.some(declaredRange)) {
    return flattenedReferences(provider,regular,selected.number);
  }
  const direct = regular.find(g => g.path === detail.path+`saison${season}/`);
  const rangeNumber = context.singleSeason ? selected.number : selected.absoluteNumber || selected.number;
  const ranges = regular.filter(g => { const r = declaredRange(g); return r && rangeNumber >= r.first && rangeNumber <= r.last; });
  const useRange = context.absolute || context.singleSeason || rangeNumber > selected.position+1;
  if (useRange && ranges.length > 1) throw failure('SOURCE_SEASON_AMBIGUOUS');
  let group = ranges.length === 1 && useRange ? ranges[0] : direct;
  if (!group && regular.length === 1 && useRange) group = regular[0];
  if (!group) throw failure('SOURCE_SEASON_NOT_FOUND');
  const range = declaredRange(group);
  if (range && (rangeNumber < range.first || rangeNumber > range.last)) throw failure('SOURCE_EPISODE_UNAVAILABLE');
  const versions = await provider.versions(group,provider.config.version);
  if (!versions.length) throw failure('SOURCE_VERSION_UNAVAILABLE');
  const refs = versions.flatMap(v => {
    const first = v.episodes[0]?.number;
    const target = range || (regular.length === 1 && !direct) ? rangeNumber : selected.number;
    let slot = v.episodes.find(e => e.number === target);
    if (!slot && !range && first === 1 && group === direct) slot = v.episodes[selected.position];
    return ref(v,slot);
  });
  if (!refs.length) throw failure('SOURCE_EPISODE_UNAVAILABLE');
  return refs;
}
module.exports = {chooseCatalogEpisode,episodeReferences};
