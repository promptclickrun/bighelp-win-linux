import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {boundedHttp} from '../packages/platform/http-transport.ts';

test('bounded local HTTP rejects redirects, ambiguous JSON, oversize and cancellation; omits cookies', async () => {
 let cookie;
 const server=createServer((req,res)=>{cookie=req.headers.cookie;
  if(req.url==='/redirect'){res.writeHead(302,{location:'/ok'});res.end();}
  else if(req.url==='/large'){res.writeHead(200);res.end(' '.repeat(1000));}
  else if(req.url==='/duplicate')res.end('{"a":1,"a":2}');
  else if(req.url==='/slow'){} else {res.setHeader('set-cookie','secret=1');res.end('{\n"ok":true\n}');}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${server.address().port}`;
 const plan=path=>({url:origin+path,method:'GET',headers:{},redirect:'error',credentials:'omit',maxResponseBytes:128});
 try {
  assert.equal((await boundedHttp(plan('/ok'),new AbortController().signal)).body.ok,true);
  await boundedHttp(plan('/ok'),new AbortController().signal);assert.equal(cookie,undefined);
  for(const path of ['/redirect','/large','/duplicate'])await assert.rejects(boundedHttp(plan(path),new AbortController().signal),/Host request failed/);
  const abort=new AbortController();const request=boundedHttp(plan('/slow'),abort.signal);abort.abort();await assert.rejects(request,/Host request failed/);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
