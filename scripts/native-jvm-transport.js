// Local transport for the optional JVM test. Signed links stay in memory only.
const http=require('node:http');
const {ProxyAgent,setGlobalDispatcher}=require('undici');
const {bridgeFetch,sample}=require('./native-transport');
const proxy=process.env.HTTPS_PROXY||process.env.HTTP_PROXY;
if(proxy)setGlobalDispatcher(new ProxyAgent(proxy));
const server=http.createServer(async(req,res)=>{
  try {
    let body='';for await(const part of req){body+=part;if(body.length>65536)throw new Error('Input too large');}
    const input=JSON.parse(body);
    const result=req.url==='/sample' ? await sample(input) : await bridgeFetch(input[0],input[1],JSON.parse(input[2]));
    res.end(JSON.stringify(result));
  } catch (_error) {res.end(JSON.stringify({ok:false,status:0,body:'',bodyBase64:'',headers:{},error:'HTTP transport/sample failed'}));}
});
server.listen(0,'127.0.0.1',()=>console.log(server.address().port));
