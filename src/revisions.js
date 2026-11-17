import { createHash } from 'node:crypto';

// 标题与正文共同构成内容指纹；其它字段（section、url、时间戳）的变化不单独产生新版本。
export function contentFingerprint(title, content) {
  const canonical = JSON.stringify({
    title: String(title ?? ''),
    content: String(content ?? ''),
  });
  return createHash('sha256').update(canonical).digest('hex');
}

// 来源 revision 为主序，updatedAt 为同 revision 下的次序；返回正数表示候选更新。
export function revisionOrder(candidate, current) {
  if (candidate.revision !== current.revision) {
    return candidate.revision - current.revision;
  }
  return Date.parse(candidate.updatedAt) - Date.parse(current.updatedAt);
}

export function buildVersion(candidate, context) {
  return {
    revision: candidate.revision,
    title: candidate.title,
    content: candidate.content,
    section: candidate.section,
    url: candidate.url,
    publishedAt: candidate.publishedAt,
    updatedAt: candidate.updatedAt,
    observedAt: candidate.observedAt,
    fingerprint: candidate.fingerprint,
    batchId: context.batchId,
    attributes: structuredClone(candidate.attributes),
  };
}

// 把一次候选观察并入文章修订链，返回身份决策：
// created 首发 | revised 内容变化且更新 | unchanged 重复稿件 | stale 旧稿不得倒退当前内容
export function mergeArticle(article, candidate, context) {
  if (!article) {
    const version = buildVersion(candidate, context);
    return {
      outcome: 'created',
      article: {
        sourceId: candidate.sourceId,
        publishedAt: candidate.publishedAt,
        section: candidate.section,
        url: candidate.url,
        createdAt: candidate.observedAt,
        updatedAt: candidate.updatedAt,
        current: version,
        versions: [version],
      },
    };
  }
  if (candidate.fingerprint === article.current.fingerprint) {
    return { outcome: 'unchanged', article };
  }
  if (revisionOrder(candidate, article.current) <= 0) {
    return { outcome: 'stale', article };
  }
  const version = buildVersion(candidate, context);
  article.current = version;
  article.versions.push(version);
  article.section = candidate.section;
  article.url = candidate.url;
  article.updatedAt = candidate.updatedAt;
  return { outcome: 'revised', article };
}
