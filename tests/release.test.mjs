import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectContent, verifyRelease } from '../scripts/verify-release.mjs';

test('release contains only the independent public examples', () => {
  const { files } = verifyRelease();
  assert.ok(files.includes('README.md'));
  assert.ok(files.includes('.env.example'));
  assert.ok(!files.some(path => path === '.env.local' || path.startsWith('data/') || path.startsWith('src/lib/')));
});

test('publication verification rejects credential and database content', () => {
  assert.throws(() => inspectContent(`am_${'f'.repeat(64)}`), /credential/);
  assert.throws(() => inspectContent(`ghp_${'x'.repeat(36)}`), /credential/);
  assert.throws(() => inspectContent('SQLite format 3\u0000'), /database/);
  assert.throws(() => inspectContent(['agent', 'demo', String(2026)].join('-')), /credential/);
  assert.throws(() => inspectContent(['demo', 'agent.local'].join('@')), /credential/);
  assert.doesNotThrow(() => inspectContent('MARKET_API_KEY=am_replace_with_your_agent_key'));
});
