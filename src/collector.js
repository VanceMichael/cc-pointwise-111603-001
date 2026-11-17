import { randomUUID } from 'node:crypto';
import { parseCollectionPage } from './adapter.js';
import { mergeArticle } from './revisions.js';

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function transient(error) {
  return /source 5\d\d|fetch|network|socket|timeout|abort|terminated|JSON|items missing/i.test(error.message);
}

// 沿来源游标持续采集：逐页提交检查点，304 复用已知游标，瞬时故障有界重试，
// 单条解析失败隔离处理。每一页成功处理后立即落盘，保证中断恢复不丢边界修订。
export async function runCollection({
  client,
  repository,
  sourceUrl,
  entryPath,
  now = () => new Date(),
  sleep = defaultSleep,
  maxPages = 1000,
  maxAttempts = 3,
}) {
  const state = repository.get();
  state.source = sourceUrl;
  const batchId = `batch-${now().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const batch = {
    batchId,
    sourceUrl,
    startedAt: now().toISOString(),
    finishedAt: null,
    status: 'running',
    reason: null,
    pages: [],
    decisions: { created: 0, revised: 0, unchanged: 0, stale: 0 },
    parseFailures: 0,
  };
  state.batches.push(batch);
  await repository.save();

  // 上一轮完整走完后游标回到入口；上一轮中途停下则从边界页重新读取，不能跳过。
  let path = state.checkpoint.completed || !state.checkpoint.path ? entryPath : state.checkpoint.path;
  const visited = new Set();
  let pageCount = 0;

  const readWithRetry = async (target) => {
    let attempt = 0;
    for (;;) {
      try {
        const known = state.checkpoint.pages[target];
        const response = await client.read(target, { etag: known?.etag ?? null });
        if (response.notModified) {
          if (!known?.next && known?.next !== null) {
            throw new Error(`304 without a cached cursor for ${target}`);
          }
          return { notModified: true, etag: response.etag ?? known.etag, next: known.next };
        }
        return parseCollectionPage(response, { observedAt: () => now().toISOString() });
      } catch (error) {
        attempt += 1;
        if (attempt >= maxAttempts || !transient(error)) throw error;
        await sleep(25 * attempt);
      }
    }
  };

  try {
    while (path) {
      if (visited.has(path)) {
        batch.status = 'aborted';
        batch.reason = `cursor cycle detected at ${path}`;
        break;
      }
      visited.add(path);
      pageCount += 1;
      if (pageCount > maxPages) {
        batch.status = 'aborted';
        batch.reason = `page limit ${maxPages} reached at ${path}`;
        break;
      }

      const page = await readWithRetry(path);
      const pageReport = {
        path,
        status: page.notModified ? 'notModified' : 'fresh',
        etag: page.etag ?? state.checkpoint.pages[path]?.etag ?? null,
        items: 0,
        parseFailures: 0,
        decisions: { created: 0, revised: 0, unchanged: 0, stale: 0 },
      };

      if (!page.notModified) {
        for (const failure of page.failures) {
          pageReport.parseFailures += 1;
          batch.parseFailures += 1;
          state.failures.push({ batchId, path, ...failure });
        }
        for (const candidate of page.items) {
          const { outcome, article } = mergeArticle(state.articles[candidate.sourceId], candidate, { batchId });
          state.articles[candidate.sourceId] = article;
          pageReport.decisions[outcome] += 1;
          batch.decisions[outcome] += 1;
        }
        pageReport.items = page.items.length;
        state.checkpoint.pages[path] = { etag: page.etag, next: page.next, observedAt: now().toISOString() };
      }

      batch.pages.push(pageReport);
      if (page.next === null) {
        // 完整走完整条游标链：下一轮从入口重新发现更新。
        state.checkpoint.path = null;
        state.checkpoint.completed = true;
      } else {
        state.checkpoint.path = page.next;
        state.checkpoint.completed = false;
      }
      await repository.save();

      if (page.next === null) break;
      path = page.next;
    }
  } catch (error) {
    // 失败前已成功处理的页面都已提交；检查点保持在失败页，下轮从该页继续。
    batch.status = 'failed';
    batch.reason = error.message;
    batch.finishedAt = now().toISOString();
    await repository.save();
    return { batchId, status: 'failed', reason: error.message, batch };
  }

  batch.finishedAt = now().toISOString();
  if (batch.status === 'running') batch.status = 'completed';
  await repository.save();
  return {
    batchId,
    status: batch.status,
    reason: batch.reason,
    decisions: batch.decisions,
    parseFailures: batch.parseFailures,
    pages: batch.pages.length,
    batch,
  };
}
