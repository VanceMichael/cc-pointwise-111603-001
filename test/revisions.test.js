import test from 'node:test';
import assert from 'node:assert/strict';
import { contentFingerprint, mergeArticle, revisionOrder } from '../src/revisions.js';

const candidate = (overrides = {}) => ({
  sourceId: 'n-1',
  revision: 1,
  title: '标题',
  content: '正文',
  section: 'local',
  url: '/article/n-1',
  publishedAt: '2026-11-16T08:00:00Z',
  updatedAt: '2026-11-16T08:00:00Z',
  observedAt: '2026-11-16T08:05:00Z',
  fingerprint: contentFingerprint('标题', '正文'),
  attributes: { articleId: 'n-1' },
  ...overrides,
});

const context = { batchId: 'batch-test' };

test('指纹同时覆盖标题与正文，任一变化即产生不同指纹', () => {
  const base = contentFingerprint('标题', '正文');
  assert.notEqual(base, contentFingerprint('新标题', '正文'));
  assert.notEqual(base, contentFingerprint('标题', '新正文'));
  assert.equal(base, contentFingerprint('标题', '正文'));
});

test('首发创建文章并记录第一版', () => {
  const { outcome, article } = mergeArticle(undefined, candidate(), context);
  assert.equal(outcome, 'created');
  assert.equal(article.versions.length, 1);
  assert.equal(article.current.revision, 1);
  assert.equal(article.current.batchId, 'batch-test');
});

test('相邻页重复同稿是 unchanged，不新增版本', () => {
  const first = mergeArticle(undefined, candidate(), context).article;
  const again = mergeArticle(first, candidate({ observedAt: '2026-11-16T08:10:00Z' }), context);
  assert.equal(again.outcome, 'unchanged');
  assert.equal(again.article.versions.length, 1);
});

test('标题或正文随更高修订变化时追加新版本并切换当前稿', () => {
  const first = mergeArticle(undefined, candidate(), context).article;
  const updated = candidate({
    revision: 2,
    title: '标题：更新',
    content: '正文：数字修正',
    updatedAt: '2026-11-16T09:00:00Z',
    fingerprint: contentFingerprint('标题：更新', '正文：数字修正'),
  });
  const { outcome, article } = mergeArticle(first, updated, context);
  assert.equal(outcome, 'revised');
  assert.equal(article.versions.length, 2);
  assert.equal(article.current.revision, 2);
  assert.equal(article.versions[0].revision, 1);
});

test('旧修订或同修订旧观察不能把当前稿倒退', () => {
  const first = mergeArticle(undefined, candidate({ revision: 2 }), context).article;
  const older = candidate({ revision: 1, fingerprint: contentFingerprint('旧标题', '旧正文') });
  const { outcome, article } = mergeArticle(first, older, context);
  assert.equal(outcome, 'stale');
  assert.equal(article.current.revision, 2);
  assert.equal(article.versions.length, 1);
  assert.ok(revisionOrder(candidate({ revision: 2 }), candidate({ revision: 1 })) > 0);
});
