// CloudStream Mp4Duration.kt: read only moov/mvhd from the bounded prefix.
function duration(bytes) {
  const view = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  function uint(offset,count,end) {
    if (offset < 0 || offset > end-count) return null;
    let value = 0;
    for (let i = offset; i < offset+count; i++) { value = value*256+view.getUint8(i); if (!Number.isSafeInteger(value)) return null; }
    return value;
  }
  function scan(start,end,movie) {
    let offset = start;
    while (offset <= end-8) {
      const size = uint(offset,4,end);
      if (size == null) return null;
      const type = String.fromCharCode(...bytes.subarray(offset+4,offset+8));
      const header = size === 1 ? 16 : 8;
      const length = size === 0 ? end-offset : size === 1 ? uint(offset+8,8,end) : size;
      if (length == null || length < header) return null;
      const boxEnd = Math.min(offset+length,end), data = offset+header;
      if (!movie && type === 'moov') return scan(data,boxEnd,true);
      if (movie && type === 'mvhd') {
        const version = uint(data,1,boxEnd);
        if (![0,1].includes(version)) return null;
        const scaleOffset = data+(version === 0 ? 12 : 20), scale = uint(scaleOffset,4,boxEnd), ticks = uint(scaleOffset+4,version === 1 ? 8 : 4,boxEnd);
        if (!scale || !ticks || (version === 0 && ticks === 0xffffffff)) return null;
        return ticks/scale;
      }
      if (length > end-offset) return null;
      offset += length;
    }
    return null;
  }
  return scan(0,bytes.length,false);
}
module.exports = { duration };
