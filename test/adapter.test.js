import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCollectionPage, parseItem } from '../src/adapter.js';

const clock = { observedAt: () => '2026-11-16T12:00:00Z' };

test('采集页解析保留 etag、游标与逐条候选', () => {
  const page = parseCollectionPage({
    text: JSON.stringify({
      items: [{
        articleId: 'n-1', url: '/a', revision: 1, title: 't', content: 'c',
        section: 'local', publishedAt: '2026-11-16T08:00:00Z', updatedAt: '2026-11-16T08:00:00Z',
      }],
      next: '/feed?cursor=2',
    }),
    etag: '"v1"',
  }, clock);
  assert.equal(page.next, '/feed?cursor=2');
  assert.equal(page.etag, '"v1"');
  assert.equal(page.items[0].observedAt, '2026-11-16T12:00:00Z');
  assert.equal(page.failures.length, 0);
  assert.ok(page.items[0].fingerprint);
});

test('单条稿件损坏被隔离为失败，同页其它稿件仍可用', () => {
  const page = parseCollectionPage({
    text: JSON.stringify({
      items: [
        { articleId: 'bad', url: '/b', revision: 1, title: 't', content: '', section: 'local',
          publishedAt: '2026-11-16T08:00:00Z', updatedAt: '2026-11-16T08:00:00Z' },
        { articleId: 'good', url: '/g', revision: 1, title: 't', content: 'c', section: 'policy',
          publishedAt: '2026-11-16T08:00:00Z', updatedAt: '2026-11-16T08:00:00Z' },
      ],
      next: null,
    }),
    etag: null,
  }, clock);
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].sourceId, 'good');
  assert.equal(page.failures.length, 1);
  assert.equal(page.failures[0].articleId, 'bad');
  assert.match(page.failures[0].reason, /content/);
  assert.ok(page.failures[0].raw);
});

test('页面结构损坏直接抛错，交给采集器重试', () => {
  assert.throws(() => parseCollectionPage({ text: '{"items": 5}', etag: null }, clock), /items missing/);
  assert.throws(() => parseCollectionPage({ text: 'not json', etag: null }, clock), /JSON/);
});

test('条目校验覆盖身份、修订号与时间字段', () => {
  const valid = {
    articleId: 'n-1', url: '/a', revision: 1, title: 't', content: 'c',
    section: 'local', publishedAt: '2026-11-16T08:00:00Z', updatedAt: '2026-11-16T08:00:00Z',
  };
  assert.equal(parseItem(valid, 'now').sourceId, 'n-1');
  assert.throws(() => parseItem({ ...valid, articleId: '  ' }, 'now'), /articleId/);
  assert.throws(() => parseItem({ ...valid, revision: 'x' }, 'now'), /revision/);
  assert.throws(() => parseItem({ ...valid, updatedAt: 'nope' }, 'now'), /updatedAt/);
});
