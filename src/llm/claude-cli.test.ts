import assert from 'node:assert/strict';
import { test } from 'node:test';
import { claudeArgs, runClaude, subscriptionEnvironment } from './claude-cli.js';

test('API 課金と親セッションへの紐付けにつながる変数は子へ渡さない', () => {
  const env = subscriptionEnvironment({
    PATH: '/bin', HTTPS_PROXY: 'http://proxy', ANTHROPIC_API_KEY: 'x', CLAUDECODE: '1', LICTOR_PID: '9', CONCORDIA_HOOK: '1',
  });
  assert.deepEqual(env, { PATH: '/bin', HTTPS_PROXY: 'http://proxy' });
});

test('非対話モードとモデルを指定して呼ぶ', () => {
  assert.deepEqual(claudeArgs('haiku'), ['-p', '--model', 'haiku', '--output-format', 'text']);
});

test('起動できない CLI はエラーで返す (黙って空文字にしない)', async () => {
  await assert.rejects(runClaude('hi', { bin: 'tendentia-no-such-claude-cli', timeoutMs: 5_000 }), /claude CLI/);
});
