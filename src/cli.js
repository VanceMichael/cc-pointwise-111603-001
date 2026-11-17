import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { RecordRepository } from './repository.js';
import { CollectionRepository } from './collection-repository.js';
import { CollectionService } from './service.js';
import { SourceClient } from './source-client.js';
import { runCollection } from './collector.js';
import { entryPath } from './adapter.js';
import { readTopic, readArticleHistory, readCollectionFailures } from './operations.js';

const here = dirname(fileURLToPath(import.meta.url));
const defaultRecords = resolve(here, '../var/records.json');
const defaultCollection = resolve(here, '../var/collection.json');
const service = new CollectionService(new RecordRepository(defaultRecords));
const action = process.argv[2] ?? '--help';

function parseArgs(after = 3) {
  const positionals = [];
  const options = {};
  for (let index = after; index < process.argv.length; index += 1) {
    const token = process.argv[index];
    if (token.startsWith('--')) {
      options[token] = process.argv[index + 1];
      index += 1;
    } else {
      positionals.push(token);
    }
  }
  return { positionals, options };
}

if (action === '--help' || action === '-h') {
  console.log(JSON.stringify({
    usage: 'npm start -- ingest [文件] | query [来源] | collect <来源地址> [--state 文件] | topics [section] [--state 文件] | history <sourceId> [--state 文件] | failures [--state 文件]',
    commands: ['ingest', 'query', 'collect', 'topics', 'history', 'failures'],
  }));
  process.exit(0);
}

if (action === 'ingest') {
  const records = JSON.parse(await readFile(process.argv[3] ?? resolve(here, '../fixtures/records.json'), 'utf8'));
  console.log(JSON.stringify(await service.ingest(records), null, 2));
} else if (action === 'query') {
  console.log(JSON.stringify(await service.query({ source: process.argv[3] }), null, 2));
} else if (action === 'collect') {
  const { positionals, options } = parseArgs();
  const sourceUrl = positionals[0];
  if (!sourceUrl) throw new Error('collect requires a local source url');
  const repository = new CollectionRepository(options['--state'] ?? defaultCollection);
  await repository.load();
  const result = await runCollection({
    client: new SourceClient(sourceUrl),
    repository,
    sourceUrl,
    entryPath,
  });
  console.log(JSON.stringify(result, null, 2));
} else if (action === 'topics') {
  const { positionals, options } = parseArgs();
  const repository = new CollectionRepository(options['--state'] ?? defaultCollection);
  await repository.load();
  console.log(JSON.stringify(await readTopic(repository, { section: positionals[0] }), null, 2));
} else if (action === 'history') {
  const { positionals, options } = parseArgs();
  const sourceId = positionals[0];
  if (!sourceId) throw new Error('history requires a sourceId');
  const repository = new CollectionRepository(options['--state'] ?? defaultCollection);
  await repository.load();
  const result = await readArticleHistory(repository, sourceId);
  if (!result) throw new Error(`unknown sourceId: ${sourceId}`);
  console.log(JSON.stringify(result, null, 2));
} else if (action === 'failures') {
  const { options } = parseArgs();
  const repository = new CollectionRepository(options['--state'] ?? defaultCollection);
  await repository.load();
  console.log(JSON.stringify(await readCollectionFailures(repository), null, 2));
} else {
  throw new Error('action must be ingest, query, collect, topics, history or failures');
}
