const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Js = require('../src/js-data');
const Pages = require('../src/pages');
const Id = require('../src/ids');
const U = require('../src/url');
const Player = require('../src/extractors/player-pages');
const Voe = require('../src/extractors/voe');
const Hls = require('../src/extractors/hls');
const Mp4 = require('../src/extractors/mp4');
const {configuration,normalizeBase} = require('../src/config');
const fixture = name => fs.readFileSync(path.join(__dirname,'fixtures',name),'utf8');
const base = 'https://domain-b.example';
test('literal data preserves holes, nulls, escapes, numeric player order and comments',() => {
  assert.deepEqual(Js.arrays(`// eps1=['ad']\nvar eps3=['third'];eps2=['a',,null,undefined,'b',];eps1=['\u0061',{'bad':1},'it\\\'s'];`),{1:['a',null,"it's"],2:['a',null,null,null,'b'],3:['third']});
  assert.deepEqual(Js.calls(`/*panneauAnime('fake','url')*/function panneauAnime(a,b){};panneauAnime('real','path');`,['panneauAnime']).map(c=>c.args.map(a=>a.text)),[['real','path']]);
  assert.throws(()=>Js.tokens('x'.repeat(4000001)));
});
test('catalog/search cards and pagination port CloudStream fixtures',() => {
  assert.equal(Pages.cards(fixture('catalog.html'),base+'/catalogue/').length,48);
  assert.equal(Pages.cards(fixture('catalog-vf.html'),base+'/catalogue/').length,48);
  assert.deepEqual(Pages.cards(fixture('search.html'),base+'/catalogue/').map(c=>c.path),['/catalogue/jujutsu-kaisen/']);
  assert.equal(Pages.hasNext(fixture('catalog.html'),base,1),true);
  assert.equal(Pages.hasNext(fixture('catalog.html'),base,100),false);
});
test('metadata and website group ordering retain films between seasons',() => {
  const d = Pages.detail(fixture('jujutsu.html'),base+'/catalogue/jujutsu-kaisen/');
  assert.equal(d.title,'Jujutsu Kaisen');assert.equal(d.year,2020);assert.ok(d.plot.includes('Yuji'));assert.ok(d.tags.includes('Action'));
  assert.deepEqual(d.groups.map(g=>g.name),['Saison 1','Film','Saison 2','Saison 3']);
  assert.deepEqual(d.groups.map(g=>g.id),[1,2,3,4]);
  const op=Pages.detail(fixture('one-piece.html'),base+'/catalogue/one-piece/');
  assert.equal(op.groups.length,27);assert.ok(op.groups.some(g=>g.path.endsWith('/kai/')));
  assert.equal(Pages.detail(fixture('film.html'),base+'/catalogue/your-name/').groups.length,1);
});
test('VF/VOSTFR have matching real positions; retained script remains relative',() => {
  for(const [name,lang] of [['jjk-season','vostfr'],['jjk-vf','vf']]) {
    const url=base+`/catalogue/jujutsu-kaisen/saison1/${lang}/`;
    const slots=Pages.episodeSlots(fixture(name+'.js'),fixture(name+'.html'),url);
    assert.equal(slots.length,24);assert.equal(slots[0].index,0);assert.equal(slots[23].number,24);assert.equal(slots[0].servers.length,3);
    const script=Pages.episodeScript(fixture(name+'.html'),url);
    assert.ok(script.startsWith(`/catalogue/jujutsu-kaisen/saison1/${lang}/episodes.js?filever=`));
  }
});
test('continuous saga numbering reads slot zero, named films keep titles',() => {
  const saga=Pages.episodeSlots(fixture('op-saga2.js'),fixture('op-saga2.html'),base+'/catalogue/one-piece/saison2/vostfr/');
  assert.equal(saga[0].number,62);assert.equal(saga[0].index,0);assert.equal(saga.at(-1).number,143);
  const film=Pages.episodeSlots(fixture('op-films.js'),fixture('op-films.html'),base+'/catalogue/one-piece/film/vostfr/');
  assert.equal(film.length,17);assert.equal(film[1].name,"L'Aventure de l'Île de l'Horloge");assert.equal(film.at(-1).name,'RED');
});
test('closed Sibnet, empty/invalid sources and Vidmoly migration match the source',() => {
  const slots=Pages.episodeSlots(`eps1=['https://video.sibnet.ru/shell.php?videoid=1',,'https://ansembed.net/embed-third.html'];eps2=[null,'https://smoothpre.com/embed/second',undefined];`,'<script>finirListe(1)</script>',base);
  assert.equal(slots.length,3);assert.deepEqual(slots[0].servers,[]);assert.equal(slots[1].index,1);assert.equal(slots[2].number,3);
  assert.equal(U.server('//vidmoly.net/embed-test.html',base),'https://vidmoly.biz/embed-test.html');
  for(const raw of ['javascript:alert(1)','https://SIBNET.ru/x','https://foo.sibnet.ru/x','https://user:pass@host.test/a',''])assert.equal(U.server(raw,base),null);
  assert.ok(U.server('https://not-sibnet.ru/test',base));
});
test('ordered row union retains missing language gaps without index collisions',() => {
  const group={path:'/catalogue/example/saison1/',name:'Saison 1',id:1,languages:['vostfr','vf']};
  const version=(language,numbers)=>({group,language,path:group.path+language+'/',script:group.path+language+'/episodes.js',episodes:numbers.map((number,index)=>({index,number,name:number===null?'Special':`Épisode ${number}`,servers:index===1?[]:['https://host.test/e']}))});
  const rows=Pages.orderedRows([group],[version('vf',[1,2]),version('vostfr',[1,2,null])]);
  assert.deepEqual(rows.map(r=>r.number),[1,2,3]);assert.deepEqual(rows[1].refs,[]);
  const vf=Id.decodeEpisode(Id.encodeEpisode(rows[2].refs,'vf'));assert.deepEqual(vf,[]);
});
test('IDs carry relative context and survive a single domain configuration change',() => {
  const ref={path:'/catalogue/test/saison1/vostfr/',index:4,language:'vostfr',script:'/catalogue/test/saison1/vostfr/episodes.js?filever=123'};
  const id=Id.encodeEpisode([ref]);assert.deepEqual(Id.decodeEpisode(id),[ref]);
  for(const origin of ['https://domain-a.example','https://domain-b.example'])assert.equal(configuration({animeSamaBaseUrl:origin}).animeSamaBaseUrl+Id.decodeEpisode(id)[0].script,origin+ref.script);
  assert.equal(Id.titleId('/catalogue/test/saison2/vf/'),'as:test');
  assert.deepEqual(Id.decodeTitle('as:test:vf'),{path:'/catalogue/test/',track:'vf'});
  for(const bad of ['https://host.test/path','ftp://host.test','https://user:pass@host.test','https://host.test?q=1'])assert.throws(()=>normalizeBase(bad));
  for(const bad of [{...ref,index:-1},{...ref,path:'/catalogue/../saison1/vostfr/'},{...ref,script:'https://old.example/episodes.js'},{...ref,language:'vf'}])assert.throws(()=>Id.encodeEpisode([bad]));
});
test('generic JWPlayer extraction ignores ads/thumbnails and preserves explicit quality/subtitle tracks',() => {
  const html=`<script>var ad='https://ads.test/clip.mp4';var adConfig={hls:'https://ads.test/ad.m3u8'};jwplayer('v').setup({sources:[{file:'/master.m3u8',label:'1080p'}],tracks:[{file:'/thumbs.vtt',kind:'thumbnails'},{file:'/sub.vtt',kind:'captions',label:'French',srclang:'fr'}]});</script>`;
  const p=Player.sources(html,'https://player.test/embed');assert.deepEqual(p.media,[{url:'https://player.test/master.m3u8',type:'hls',quality:'1080p'}]);
  assert.equal(p.subtitles.length,1);assert.equal(p.subtitles[0].language,'fr');
});
test('packed dictionaries and numbered HLS/master.txt sources decode without eval',() => {
  const packed=`<script>eval(function(p,a,c,k,e,d){return p;}('0("v").1({2:[{3:"https://cdn.test/master.m3u8"}]});',4,4,'jwplayer|setup|sources|file'.split('|'),0,{}))</script>`;
  assert.equal(Player.sources(packed,'https://player.test/embed').media[0].url,'https://cdn.test/master.m3u8');
  const html=`<script>var config={hls2:'https://cdn.test/master.txt',hls3:'/hls/master.m3u8'};jwplayer('v').setup({sources:[{file:config.hls3||config.hls2}]});</script>`;
  assert.equal(Player.sources(html,'https://player.test/e').media.length,2);
  assert.equal(Player.redirect(`<title>Advertisement</title><script>location.href='https://ad.test'</script>`,'https://player.test/e'),null);
  assert.equal(Player.redirect(`<title>Redirect</title><script>location.href='https://real.test/e'</script>`,'https://player.test/e'),'https://real.test/e');
});
test('VOE F7 decoder adapts the core extractor and handles malformed JSON',() => {
  const original={source:'https://cdn.test/master.m3u8',direct_access_url:'https://cdn.test/video.mp4'};
  const first=btoa(JSON.stringify(original)).split('').reverse().map(c=>String.fromCharCode(c.charCodeAt(0)+3)).join('');
  const encoded=btoa(first).replace(/[A-Za-z]/g,c=>String.fromCharCode(c.charCodeAt(0)+(c.toLowerCase()<='m'?13:-13)));
  assert.deepEqual(Voe.decryptF7(encoded),original);
  assert.equal(Voe.sources('<script type="application/json">'+JSON.stringify([encoded])+'</script>','https://voe.sx/e').length,2);
  assert.deepEqual(Voe.sources('<script type="application/json">invalid</script>','https://voe.sx/e'),[]);
});
test('HLS metadata comes from real manifest fields and retains alternate audio groups',() => {
  const parsed=Hls.parse('#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",LANGUAGE="ja",NAME="Japanese",URI="audio.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=1,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2",AUDIO="a",VIDEO-RANGE=SDR\nvideo.m3u8?fresh=1','https://cdn.test/path/master.m3u8?old=1');
  assert.equal(parsed.variants[0].quality,'1080p');assert.equal(parsed.variants[0].audioGroup,'a');assert.equal(parsed.tracks[0].language,'ja');
  assert.equal(parsed.variants[0].url,'https://cdn.test/path/video.m3u8?fresh=1');
  assert.throws(()=>Hls.parse('<html>#EXTM3U</html>','https://cdn.test'));assert.throws(()=>Hls.parse('#EXTM3U','https://cdn.test'));
});
function movieHeader(seconds) {
  const bytes=new Uint8Array(44),v=new DataView(bytes.buffer);v.setUint32(0,44);bytes.set([109,111,111,118],4);v.setUint32(8,36);bytes.set([109,118,104,100],12);v.setUint32(28,1000);v.setUint32(32,seconds*1000);return bytes;
}
test('Sendvid MP4 duration rejects the five-second unavailable clip without reading video',() => {
  assert.equal(Mp4.duration(movieHeader(5)),5);assert.equal(Mp4.duration(movieHeader(1460)),1460);
  assert.equal(Mp4.duration(new Uint8Array([1,2])),null);assert.equal(Mp4.duration(movieHeader(5).slice(0,32)),null);
});
module.exports={movieHeader};
test('known embed path normalizations adapt CloudStream host helpers without redirects',()=>{
  assert.equal(Player.normalizeEmbed('https://vidmoly.biz/w/abc?x=1'),'https://vidmoly.biz/embed-abc.html?x=1');
  assert.equal(Player.normalizeEmbed('https://streamwish.to/e/abc'),'https://streamwish.to/abc');
  assert.equal(Player.normalizeEmbed('https://smoothpre.com/download/abc'),'https://smoothpre.com/v/abc');
  assert.equal(Player.normalizeEmbed('https://ansembed.net/embed-abc.html'),'https://ansembed.net/embed-abc.html');
});
