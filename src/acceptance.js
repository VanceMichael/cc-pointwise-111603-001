import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startSource } from '../source/server.js';
import { SourceClient } from './source-client.js';
import { parsePage, entryPath } from './adapter.js';
import { RecordRepository } from './repository.js';
import { CollectionRepository } from './collection-repository.js';
import { CollectionService } from './service.js';
import { runCollection } from './collector.js';
import { readOperations, readTopic, readArticleHistory, readCollectionFailures } from './operations.js';

const scenarioPath = new URL('../fixtures/collection.json', import.meta.url);
const source = await startSource(scenarioPath);
const directory = await mkdtemp(join(tmpdir(), 'collection-acceptance-'));
try {
  const client = new SourceClient(source.url);

  // 首批结构化导入与重放行为保持不变。
  const page = parsePage(await client.read(entryPath));
  assert.ok(page.records.length > 0, '初始来源须有可接收的业务记录');
  const legacyPath = join(directory, 'records.json');
  const legacy = new RecordRepository(legacyPath);
  const first = await new CollectionService(legacy).ingest(page.records);
  assert.equal(first.accepted, page.records.length);
  const stored = await legacy.read();
  const reopened = new RecordRepository(legacyPath);
  assert.deepEqual(await new CollectionService(reopened).query({}), stored, '重新打开后读取同一份业务记录');
  assert.equal((await new CollectionService(reopened).ingest(page.records)).stored, stored.length, '重放首批记录不重复保存');
  const operations = await readOperations(reopened);
  assert.deepEqual(operations.rows.map((row) => row.sourceId), stored.map((row) => row.sourceId));

  // 持续采集：首轮跨页去重，重启回读状态一致。
  const statePath = join(directory, 'collection.json');
  const repository = new CollectionRepository(statePath);
  await repository.load();
  const opening = await runCollection({ client, repository, sourceUrl: source.url, entryPath, sleep: () => undefined });
  assert.equal(opening.status, 'completed');
  assert.equal(opening.decisions.created, 3);
  assert.equal(opening.decisions.unchanged, 1);
  const restarted = new CollectionRepository(statePath);
  await restarted.load();
  const topic = await readTopic(restarted);
  assert.equal(topic.rows.length, 3);

  // 来源修订后再采集：当前稿更新且历史可回看。
  source.publish('revised');
  const revised = await runCollection({ client, repository: restarted, sourceUrl: source.url, entryPath, sleep: () => undefined });
  assert.equal(revised.decisions.revised, 2);
  const history = await readArticleHistory(restarted, 'n-1');
  assert.deepEqual(history.versions.map((version) => version.revision), [2, 1]);
  assert.ok(history.versions.every((version) => version.fingerprint && version.batchId));

  // 304 再采集不产生新版本；旧稿重放不倒退当前内容。
  const cached = await runCollection({ client, repository: restarted, sourceUrl: source.url, entryPath, sleep: () => undefined });
  assert.equal(cached.decisions.revised, 0);
  assert.ok(cached.batch.pages.every((item) => item.status === 'notModified'));
  source.publish('lagging');
  const lagging = await runCollection({ client, repository: restarted, sourceUrl: source.url, entryPath, sleep: () => undefined });
  assert.equal(lagging.decisions.stale, 2);
  assert.equal(restarted.get().articles['n-1'].current.revision, 2);

  // 解析失败隔离：上一份有效稿保留，失败依据可核对。
  source.publish('broken');
  const broken = await runCollection({ client, repository: restarted, sourceUrl: source.url, entryPath, sleep: () => undefined });
  assert.equal(broken.parseFailures, 2);
  assert.equal(restarted.get().articles['n-1'].current.revision, 2);
  assert.equal((await readCollectionFailures(restarted)).failures.length, 2);

  console.log(JSON.stringify({
    legacy: { accepted: first.accepted, persisted: stored.length },
    collect: { opening: opening.decisions, revised: revised.decisions, cached: cached.status, lagging: lagging.decisions, broken: broken.parseFailures },
    topicRows: topic.rows.length,
    historyVersions: history.versions.length,
    status: 'ok',
  }));
} finally {
  await source.close();
  await rm(directory, { recursive: true, force: true });
}
