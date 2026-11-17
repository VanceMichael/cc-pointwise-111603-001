import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('命令帮助列出全部入口且正常退出', () => {
  const result = spawnSync(process.execPath, ['src/cli.js', '--help'], {encoding: 'utf8'});
  assert.equal(result.status, 0);
  const help = JSON.parse(result.stdout);
  for (const command of ['ingest', 'query', 'collect', 'topics', 'history', 'failures']) {
    assert.ok(help.usage.includes(command), `usage 缺少 ${command}`);
  }
  assert.deepEqual(help.commands, ['ingest', 'query', 'collect', 'topics', 'history', 'failures']);
});

test('未知动作明确失败而不执行默认查询', () => {
  const result = spawnSync(process.execPath, ['src/cli.js', 'invalid-action'], {encoding: 'utf8'});
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /ingest, query, collect, topics, history or failures/);
});

test('collect 缺少来源地址时明确失败', () => {
  const result = spawnSync(process.execPath, ['src/cli.js', 'collect'], {encoding: 'utf8'});
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /local source url/);
});
