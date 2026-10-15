const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { AnimeSamaProvider } = require('./provider');
const { defaults } = require('./config');
const Addon = require('./addon');
const pkg = require('../package.json');
function createServer(options = {}) {
  const provider = options.provider || new AnimeSamaProvider({
    ...defaults,...(process.env.ANIME_SAMA_BASE_URL ? {animeSamaBaseUrl:process.env.ANIME_SAMA_BASE_URL} : {}),...options.config
  },{onMetrics:options.onMetrics});
  const addonManifest = Addon.manifest(pkg.version);
  return http.createServer(async (req,res) => {
    const headers = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, OPTIONS','Access-Control-Allow-Headers':'Content-Type','X-Content-Type-Options':'nosniff'};
    function send(status,data,cache = 'no-store') {
      res.writeHead(status,{...headers,'Content-Type':'application/json; charset=utf-8','Cache-Control':cache}); res.end(JSON.stringify(data));
    }
    if (req.method === 'OPTIONS') { res.writeHead(204,headers); res.end(); return; }
    if (req.method !== 'GET') { send(405,{error:'Method not allowed'}); return; }
    try {
      const url = new URL(req.url,'http://local.invalid');
      if (url.pathname === '/manifest.json') { send(200,addonManifest,'public, max-age=300'); return; }
      if (url.pathname === '/health') { send(200,{ok:true,version:pkg.version}); return; }
      if (url.pathname === '/plugin/manifest.json' || url.pathname === '/plugin/providers/anime-sama.js') {
        const file = url.pathname.endsWith('/manifest.json') ? 'manifest.json' : 'providers/anime-sama.js';
        const content = await fs.readFile(path.join(__dirname,'..',file));
        res.writeHead(200,{...headers,'Content-Type':file.endsWith('.js') ? 'application/javascript':'application/json','Cache-Control':'public, max-age=60'}); res.end(content); return;
      }
      if (req.url.length > 20000) { send(414,{error:'URL too long'}); return; }
      const match = /^\/(catalog|meta|stream)\/([^/]+)\/([^/]+?)(?:\/([^/]*))?\.json$/.exec(url.pathname);
      if (!match) { send(404,{error:'Not found'}); return; }
      const [,resource,typeRaw,idRaw,extraRaw] = match;
      const type = decodeURIComponent(typeRaw), id = decodeURIComponent(idRaw);
      const extra = Object.fromEntries(new URLSearchParams(extraRaw || url.search.slice(1)));
      const data = resource === 'catalog' ? await Addon.catalog(provider,type,id,extra)
        : resource === 'meta' ? await Addon.meta(provider,type,id) : await Addon.stream(provider,type,id);
      send(200,data,resource === 'stream' ? 'no-store' : 'public, max-age=60');
    } catch (_error) { send(200,req.url.startsWith('/stream/') ? {streams:[]} : req.url.startsWith('/catalog/') ? {metas:[]} : {meta:null}); }
  });
}
if (require.main === module) {
  const port = Number(process.env.PORT || 3000), host = process.env.HOST || '0.0.0.0';
  const server = createServer({onMetrics:m => console.log(JSON.stringify({event:'resolution',...m}))});
  server.listen(port,host,() => console.log(`Anime-Sama addon listening on port ${port}`));
  for (const signal of ['SIGINT','SIGTERM']) process.on(signal,() => server.close(() => process.exit(0)));
}
module.exports = { createServer };
