import test from 'node:test';
import assert from 'node:assert/strict';
import { isCursorComposerId } from '../core/cursor-session.mjs';

test('Cursor location accepts only UUID composer IDs',()=>{
  const id='12345678-1234-1234-1234-123456789abc';
  assert.equal(isCursorComposerId(id),true);
  for(const value of ['', 'composer_123', '../session', `${id}?command=x`, null])assert.equal(isCursorComposerId(value),false);
});
