import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('first-party source and documentation contain no concrete user-home paths',()=>{
  const root=fileURLToPath(new URL('../',import.meta.url));
  const excluded=new Set(['node_modules','.git','build','dist','release','qa']);
  const textFile=/\.(?:[cm]?[jt]sx?|json|md|txt|html|css|py|ya?ml|toml|sh)$/;
  const privateHome=/(?:\/(?:Users|home)\/[^\s/<"']+|[A-Za-z]:\\Users\\[^\s\\<"']+)/;
  const failures=[];
  function scan(dir){
    for(const entry of readdirSync(join(root,dir),{withFileTypes:true})){
      if(excluded.has(entry.name))continue;
      const path=join(dir,entry.name);
      if(entry.isDirectory())scan(path);
      else if(entry.isFile()&&textFile.test(entry.name)&&privateHome.test(readFileSync(join(root,path),'utf8')))failures.push(path);
    }
  }
  scan('');
  // Report file locations only, never echo potentially private matched content.
  assert.deepEqual(failures,[],'Use runtime home-directory resolution or generic path placeholders.');
});
