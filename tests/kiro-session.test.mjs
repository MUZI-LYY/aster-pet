import test from 'node:test';
import assert from 'node:assert/strict';
import { isKiroSessionId } from '../core/kiro-session.mjs';

test('Kiro location accepts only known local session ID formats',()=>{
  for(const id of ['sess_1234567890abcdef','12345678-1234-1234-1234-123456789abc'])assert.equal(isKiroSessionId(id),true);
  for(const id of ['', '../session', 'sess_bad?command=x', '1234', null])assert.equal(isKiroSessionId(id),false);
});
