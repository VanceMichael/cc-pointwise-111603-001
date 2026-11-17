import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CollectionRepository } from '../src/collection-repository.js';
import { runCollection } from '../src/collector.js';

const item = (articleId, revision = 1) => ({
  articleId, url: `/article/${articleId}`, revision, title: `t-${articleId}`,
  content: `c-${articleId}`, section: 'local',
  publishedAt: '2026-11-16T08:00:00Z', updatedAt: '2026-11-16T08:00:00Z',
});

const pageResponse = (items, next, etag) => ({
  notModified: false,
  etag,
  text: JSON.stringify({ items, next }),
});

async function freshRepository(directory) {
  const repository = new CollectionRepository(join(directory, 'collection.json'));
  await repository.load();
  return repository;
}

test('游标成环时批次中止并保留已采集页面，不陷入死循环', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'collection-cycle-'));
  try {
    const routes = new Map([
      ['/feed?cursor=start', pageResponse([item('n-1')], '/feed?cursor=loop', '"s"')],
      ['/feed?cursor=loop', pageResponse([item('n-2')], '/feed?cursor=start', '"l"')],
    ]);
    const client = { read: async (path) => routes.get(path) };
    const repository = await freshRepository(directory);
    const result = await runCollection({
      client, repository, sourceUrl: 'http://127.0.0.1:9', entryPath: '/feed?cursor=start',
    });
    assert.equal(result.status, 'aborted');
    assert.match(result.reason, /cursor cycle/);
    const state = repository.get();
    assert.ok(state.articles['n-1'] && state.articles['n-2']);
    assert.equal(state.checkpoint.path, '/feed?cursor=start');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('304 缺少本地游标缓存时安全失败，不伪造采集结果', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'collection-304-'));
  try {
    const repository = await freshRepository(directory);
    repository.get().checkpoint.pages['/feed?cursor=start'] = { etag: '"stale"', next: undefined };
    const client = { read: async () => ({ notModified: true, etag: '"stale"', text: null }) };
    const result = await runCollection({
      client, repository, sourceUrl: 'http://127.0.0.1:9', entryPath: '/feed?cursor=start',
    });
    assert.equal(result.status, 'failed');
    assert.match(result.reason, /304 without a cached cursor/);
    assert.equal(Object.keys(repository.get().articles).length, 0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('页面条数上限保护触发后批次中止且检查点可恢复', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'collection-limit-'));
  try {
    const routes = new Map([
      ['/feed?cursor=start', pageResponse([item('n-1')], '/feed?cursor=p2', '"1"')],
      ['/feed?cursor=p2', pageResponse([item('n-2')], '/feed?cursor=p3', '"2"')],
      ['/feed?cursor=p3', pageResponse([item('n-3')], null, '"3"')],
    ]);
    const client = { read: async (path) => routes.get(path) };
    const repository = await freshRepository(directory);
    const result = await runCollection({
      client, repository, sourceUrl: 'http://127.0.0.1:9', entryPath: '/feed?cursor=start',
      maxPages: 2,
    });
    assert.equal(result.status, 'aborted');
    assert.match(result.reason, /page limit/);
    assert.equal(repository.get().checkpoint.path, '/feed?cursor=p3');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
