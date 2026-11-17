import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startSource } from '../source/server.js';
import { SourceClient } from '../src/source-client.js';
import { CollectionRepository } from '../src/collection-repository.js';
import { runCollection } from '../src/collector.js';
import { entryPath } from '../src/adapter.js';
import { readTopic, readArticleHistory, readCollectionFailures } from '../src/operations.js';

const scenarioPath = new URL('../fixtures/collection.json', import.meta.url);
const overlapPath = '/feed?cursor=overlap';

async function harness() {
  const source = await startSource(scenarioPath);
  const directory = await mkdtemp(join(tmpdir(), 'collection-run-'));
  const statePath = join(directory, 'state', 'collection.json');
  const make = () => new CollectionRepository(statePath);
  return {
    source,
    directory,
    statePath,
    run: async (repository = make()) => {
      await repository.load();
      return runCollection({
        client: new SourceClient(source.url),
        repository,
        sourceUrl: source.url,
        entryPath,
        sleep: () => undefined,
      });
    },
    load: async () => {
      const repository = make();
      await repository.load();
      return repository;
    },
  };
}

test('首次采集跨页去重：相邻页重复稿件不产生新版本', async () => {
  const h = await harness();
  try {
    const result = await h.run();
    assert.equal(result.status, 'completed');
    assert.deepEqual(result.decisions, { created: 3, revised: 0, unchanged: 1, stale: 0 });
    const repository = await h.load();
    const topic = await readTopic(repository);
    assert.deepEqual(topic.rows.map((row) => row.sourceId).sort(), ['n-1', 'n-2', 'n-3']);
    const history = await readArticleHistory(repository, 'n-1');
    assert.equal(history.versions.length, 1);
    assert.equal(history.current.revision, 1);
  } finally { await h.source.close(); await rm(h.directory, { recursive: true, force: true }); }
});

test('再次采集命中 304 时复用已知游标，不制造新版本', async () => {
  const h = await harness();
  try {
    await h.run();
    const before = JSON.parse(await readFile(h.statePath, 'utf8'));
    const result = await h.run();
    assert.equal(result.status, 'completed');
    assert.deepEqual(result.decisions, { created: 0, revised: 0, unchanged: 0, stale: 0 });
    assert.ok(result.batch.pages.every((page) => page.status === 'notModified'));
    const after = JSON.parse(await readFile(h.statePath, 'utf8'));
    assert.equal(after.articles['n-1'].versions.length, 1);
    assert.equal(after.batches.length, before.batches.length + 1);
    assert.ok(h.source.requests.every((request) => request.method === 'GET'));
  } finally { await h.source.close(); await rm(h.directory, { recursive: true, force: true }); }
});

test('分页期间来源更新：边界页上的修订在续采时被发现并保留历史', async () => {
  const h = await harness();
  try {
    await h.run();
    h.source.publish('revised');
    const result = await h.run();
    assert.equal(result.decisions.revised, 2);
    assert.ok(result.decisions.unchanged >= 1);
    const repository = await h.load();
    const n1 = await readArticleHistory(repository, 'n-1');
    assert.equal(n1.versions.length, 2);
    assert.deepEqual(n1.versions.map((version) => version.revision), [2, 1]);
    assert.equal(n1.versions[0].title, '线路开通：数据更新');
    const topic = await readTopic(repository, { section: 'local' });
    assert.deepEqual(topic.rows.map((row) => row.sourceId).sort(), ['n-1', 'n-3']);
    assert.equal(topic.rows.find((row) => row.sourceId === 'n-1').attributes.revision, 2);
  } finally { await h.source.close(); await rm(h.directory, { recursive: true, force: true }); }
});

test('中断在边界页后：检查点停在该页，接着采集不跳过其后续修订', async () => {
  const h = await harness();
  try {
    // 只让入口页可成功读取，模拟读到第一页后在边界页中断。
    h.source.failNext(overlapPath, 'disconnect');
    h.source.failNext(overlapPath, 'disconnect');
    h.source.failNext(overlapPath, 503);
    const interruptedRun = await h.run();
    assert.equal(interruptedRun.status, 'failed');
    assert.match(interruptedRun.reason, /terminated|socket|503|fetch/i);
    const interrupted = JSON.parse(await readFile(h.statePath, 'utf8'));
    assert.equal(interrupted.checkpoint.path, overlapPath);
    assert.equal(interrupted.checkpoint.completed, false);
    assert.ok(interrupted.articles['n-1']);
    assert.ok(!interrupted.articles['n-3']);
    assert.equal(interrupted.batches.at(-1).status, 'failed');

    // 来源在中断期间更新，续采从边界页继续并拿到 n-3 与 n-1 的修订。
    h.source.publish('revised');
    const resumed = await h.run();
    assert.equal(resumed.status, 'completed');
    const repository = await h.load();
    const state = repository.get();
    assert.equal(state.checkpoint.completed, true);
    assert.ok(state.articles['n-3']);
    assert.equal(state.articles['n-1'].current.revision, 2);
    assert.equal((await readArticleHistory(repository, 'n-1')).versions.length, 2);
  } finally { await h.source.close(); await rm(h.directory, { recursive: true, force: true }); }
});

test('有界重试后成功，重试不产生重复版本', async () => {
  const h = await harness();
  try {
    h.source.failNext(entryPath, 503);
    h.source.failNext(entryPath, 'disconnect');
    const result = await h.run();
    assert.equal(result.status, 'completed');
    const repository = await h.load();
    assert.equal((await readArticleHistory(repository, 'n-1')).versions.length, 1);
  } finally { await h.source.close(); await rm(h.directory, { recursive: true, force: true }); }
});

test('重试耗尽后批次失败，检查点保留且下一轮可继续', async () => {
  const h = await harness();
  try {
    for (let i = 0; i < 5; i += 1) h.source.failNext(entryPath, 503);
    const exhausted = await h.run();
    assert.equal(exhausted.status, 'failed');
    assert.match(exhausted.reason, /503/);
    const failed = JSON.parse(await readFile(h.statePath, 'utf8'));
    assert.equal(failed.batches.at(-1).status, 'failed');
    const result = await h.run();
    assert.equal(result.status, 'completed');
    assert.equal(result.decisions.created, 3);
  } finally { await h.source.close(); await rm(h.directory, { recursive: true, force: true }); }
});

test('旧缓存/旧稿重放不能把新稿倒退，只记为 stale', async () => {
  const h = await harness();
  try {
    await h.run();
    h.source.publish('revised');
    await h.run();
    h.source.publish('lagging');
    const result = await h.run();
    assert.equal(result.decisions.stale, 2);
    assert.equal(result.decisions.revised, 0);
    const repository = await h.load();
    const article = repository.get().articles['n-1'];
    assert.equal(article.current.revision, 2);
    assert.equal(article.versions.length, 2);
  } finally { await h.source.close(); await rm(h.directory, { recursive: true, force: true }); }
});

test('正文解析失败保留上一份有效稿并留下可核对的失败依据', async () => {
  const h = await harness();
  try {
    await h.run();
    h.source.publish('revised');
    await h.run();
    h.source.publish('broken');
    const result = await h.run();
    assert.equal(result.status, 'completed');
    assert.equal(result.parseFailures, 2);
    const repository = await h.load();
    const state = repository.get();
    // n-1 空正文、n-3 正文非字符串：当前稿停留在上一有效版本。
    assert.equal(state.articles['n-1'].current.revision, 2);
    assert.equal(state.articles['n-3'].current.revision, 2);
    // 同页中可解析的 n-2 修订照常生效。
    assert.equal(state.articles['n-2'].current.revision, 2);
    const failures = await readCollectionFailures(repository);
    assert.equal(failures.failures.length, 2);
    assert.deepEqual(failures.failures.map((failure) => failure.articleId).sort(), ['n-1', 'n-3']);
    assert.ok(failures.failures.every((failure) => failure.batchId && failure.path && failure.reason));
    const topic = await readTopic(repository);
    assert.equal(topic.openFailures, 2);
    const history = await readArticleHistory(repository, 'n-1');
    assert.equal(history.versions.length, 2);
  } finally { await h.source.close(); await rm(h.directory, { recursive: true, force: true }); }
});
