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
import { readOperations, readTopic, readArticleHistory } from './operations.js';

const scenarioPath = new URL('../fixtures/collection.json', import.meta.url);
const source = await startSource(scenarioPath);
const directory = await mkdtemp(join(tmpdir(), 'collection-demo-'));
try {
  const client = new SourceClient(source.url);

  // 首批结构化导入（保留原有本地运维入口）。
  const legacy = new RecordRepository(join(directory, 'records.json'));
  const page = parsePage(await client.read(entryPath));
  await new CollectionService(legacy).ingest(page.records);
  console.log('legacy ingest =>', JSON.stringify(await readOperations(legacy)));

  // 持续采集：首发、来源更新、再采集保留两个版本。
  const repository = new CollectionRepository(join(directory, 'collection.json'));
  await repository.load();
  console.log('first collect =>', JSON.stringify(await runCollection({ client, repository, sourceUrl: source.url, entryPath })));
  source.publish('revised');
  console.log('revised collect =>', JSON.stringify(await runCollection({ client, repository, sourceUrl: source.url, entryPath })));
  console.log('topic view =>', JSON.stringify(await readTopic(repository), null, 2));
  console.log('article history =>', JSON.stringify(await readArticleHistory(repository, 'n-1'), null, 2));
} finally {
  await source.close();
  await rm(directory, { recursive: true, force: true });
}
