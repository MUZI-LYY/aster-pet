const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

function startWindowBridge({ provider, workspace, roots, windowHint, openTask }) {
  const directory = path.join(os.homedir(), `.${provider}`, 'aster-window-bridge');
  const discovery = path.join(directory, `${process.pid}.json`);
  const token = crypto.randomBytes(32).toString('hex');
  let heartbeat;
  const respond=(response,status,value)=>{const body=JSON.stringify(value);response.writeHead(status,{'content-type':'application/json','content-length':Buffer.byteLength(body)});response.end(body);};
  const server=http.createServer((request,response)=>{
    if(request.method!=='POST'||request.url!=='/open-task'||request.headers.authorization!==`Bearer ${token}`){respond(response,404,{ok:false});return;}
    const chunks=[];let length=0;
    request.on('data',chunk=>{length+=chunk.length;if(length>1024)request.destroy();else chunks.push(chunk);});
    request.on('end',async()=>{try{const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));await openTask(value.id);respond(response,200,{ok:true});}catch{respond(response,409,{ok:false});}});
  });
  const publish=()=>{const address=server.address();if(!address||typeof address==='string')return;fs.mkdirSync(directory,{recursive:true,mode:0o700});const temporary=`${discovery}.tmp`;fs.writeFileSync(temporary,JSON.stringify({protocol:1,provider,pid:process.pid,port:address.port,token,workspace,roots,windowHint:typeof windowHint==='function'?windowHint():'',updatedAt:Date.now()}),{mode:0o600});fs.renameSync(temporary,discovery);};
  server.listen(0,'127.0.0.1',()=>{publish();heartbeat=setInterval(publish,30000);heartbeat.unref();});
  return {publish,dispose(){clearInterval(heartbeat);server.close();try{fs.unlinkSync(discovery);}catch{}}};
}
module.exports = { startWindowBridge };
