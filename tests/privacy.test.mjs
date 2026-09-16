import test from 'node:test';
import assert from 'node:assert/strict';
import { privacyIssues } from '../scripts/check-privacy.mjs';
const options={names:['private-fixture-account'],personalHome:''};
const slash=String.fromCharCode(47);
test('privacy guard rejects personal directories and literal filesystem locations without echoing values',()=>{
  for(const segments of [['Users','fixture','workspace'],['home','fixture','code'],['private','var','folders','sample'],['usr','bin','tool']]){
    const value=JSON.stringify(slash+segments.join(slash));
    const result=privacyIssues(value,options);assert.ok(result.length);assert.ok(result.every(rule=>!rule.includes('fixture')));
  }
  assert.deepEqual(privacyIssues('private-fixture-account',options),['personal-identifier']);
});
test('runtime paths, relative examples and route identifiers are portable',()=>{
  for(const text of ["join(homedir(), '.codex')",'node ./scripts/aster-run.mjs',"fetch('/api/tasks')","uri.path === '/open-session'",'process.execPath','app.getPath("userData")'])assert.deepEqual(privacyIssues(text,options),[]);
});
