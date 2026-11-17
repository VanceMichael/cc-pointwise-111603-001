import { contentFingerprint } from './revisions.js';

export const entryPath = "/feed?cursor=start";

export function parsePage(response) {
  const payload = JSON.parse(response.text);
  if (!Array.isArray(payload.items)) throw new Error('source items missing');
  const items = payload.items;
  const next = payload.next ?? null;
  return { next, records: items.map((item) => ({
    sourceId: String(item["articleId"]),
    source: "稿件采集台",
    observedAt: item["publishedAt"],
    label: String(item["title"]),
    attributes: structuredClone(item),
  })) };
}

function requireString(item, field) {
  const value = item[field];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`invalid or missing ${field}`);
  }
  return value;
}

// 单条稿件解析失败被隔离：页面仍可读，调用方保留上一份有效稿并登记失败依据。
export function parseItem(item, observedAt) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    throw new Error('source item must be an object');
  }
  const sourceId = String(item.articleId ?? '').trim();
  if (!sourceId) throw new Error('invalid or missing articleId');
  const title = requireString(item, 'title');
  const content = requireString(item, 'content');
  const section = requireString(item, 'section');
  const url = requireString(item, 'url');
  const publishedAt = requireString(item, 'publishedAt');
  const updatedAt = requireString(item, 'updatedAt');
  if (!Number.isFinite(Date.parse(publishedAt))) throw new Error('invalid publishedAt');
  if (!Number.isFinite(Date.parse(updatedAt))) throw new Error('invalid updatedAt');
  const revision = Number(item.revision);
  if (!Number.isFinite(revision)) throw new Error('invalid revision');
  return {
    sourceId,
    revision,
    title,
    content,
    section,
    url,
    publishedAt,
    updatedAt,
    observedAt,
    fingerprint: contentFingerprint(title, content),
    attributes: structuredClone(item),
  };
}

// 采集页解析：页面结构损坏抛错（由采集器重试），单条稿件损坏进入 failures 而不拖垮整页。
export function parseCollectionPage(response, clock) {
  const payload = JSON.parse(response.text);
  if (!payload || !Array.isArray(payload.items)) throw new Error('source items missing');
  const observedAt = clock.observedAt();
  const items = [];
  const failures = [];
  for (const [index, raw] of payload.items.entries()) {
    try {
      items.push(parseItem(raw, observedAt));
    } catch (error) {
      failures.push({
        index,
        articleId: raw && raw.articleId != null ? String(raw.articleId) : null,
        reason: error.message,
        observedAt,
        raw: raw && typeof raw === 'object' ? structuredClone(raw) : raw ?? null,
      });
    }
  }
  return { next: payload.next ?? null, etag: response.etag ?? null, items, failures };
}
