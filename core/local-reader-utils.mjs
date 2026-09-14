import { readdirSync, statSync, openSync, closeSync, readSync, fstatSync, realpathSync } from 'node:fs';
import { join, sep } from 'node:path';
import { execFileSync } from 'node:child_process';

export const short = (v, n = 180) => typeof v === 'string' ? v.slice(0, n) : '';
export const timestamp = v => typeof v === 'number' && Number.isFinite(v) ? (v < 1e12 ? v * 1000 : v) : Date.parse(v) || 0;
export function entries(path) { try { return readdirSync(path, { withFileTypes:true }); } catch { return []; } }
export function recentFiles(paths, limit = 80) {
  return paths.flatMap(path => { try { const s = statSync(path); return s.isFile() ? [{path,mtime:s.mtimeMs}] : []; } catch { return []; } })
    .sort((a,b) => b.mtime-a.mtime).slice(0,limit);
}
export function contained(path, root) {
  try { return realpathSync(path).startsWith(realpathSync(root)+sep); } catch { return false; }
}
export function readBounded(path, { root, maxBytes = 256 * 1024, tail = false } = {}) {
  if (root && !contained(path,root)) throw new Error('Outside source directory');
  const fd = openSync(path,'r');
  try {
    const s=fstatSync(fd); if(!s.isFile() || (!tail && s.size>maxBytes)) throw new Error('Unsupported record size');
    const size=Math.min(s.size,maxBytes),buf=Buffer.alloc(size);
    const count=readSync(fd,buf,0,size,tail?s.size-size:0);
    let value=buf.subarray(0,count).toString('utf8');
    if(tail && s.size>size)value=value.slice(value.indexOf('\n')+1);
    return value;
  } finally {closeSync(fd);}
}
export function readJson(path, root) { return JSON.parse(readBounded(path,{root})); }
export function jsonLines(path, root) {
  const lines=readBounded(path,{root,tail:true}).split('\n').filter(line=>line.trim());
  const rows=lines.flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}});
  rows.truncated = statSync(path).size > 256 * 1024 || rows.length !== lines.length;
  try{if(lines.length)JSON.parse(lines.at(-1));}catch{rows.incomplete=true;}
  return rows;
}
// Process metadata only: no command lines or environment contents are queried.
export function processInfo(pid) {
  if(!Number.isSafeInteger(pid)||pid<=0)return null;
  try {
    const start=execFileSync('ps',['-p',String(pid),'-o','lstart='],{encoding:'utf8',timeout:1000}).trim();
    const startUtc=execFileSync('ps',['-p',String(pid),'-o','lstart='],{encoding:'utf8',timeout:1000,env:{...process.env,TZ:'UTC',LC_ALL:'C'}}).trim();
    const tty=execFileSync('ps',['-p',String(pid),'-o','tty='],{encoding:'utf8',timeout:1000}).trim();
    return start && startUtc ? {start,startUtc,tty:/^(ttys\d+|pts\/\d+)$/.test(tty)?`/dev/${tty}`:null} : null;
  } catch {return null;}
}
export function directFiles(root, suffix) { return entries(root).filter(e=>e.isFile()&&e.name.endsWith(suffix)).map(e=>join(root,e.name)); }
