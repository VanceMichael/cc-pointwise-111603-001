const fields = ["articleId", "revision", "title", "content", "section"];

export async function readOperations(repository) {
  const records = await repository.read();
  return { product: "稿件采集台", rows: records.map((record) => ({
    sourceId: record.sourceId,
    source: record.source,
    observedAt: record.observedAt,
    attributes: Object.fromEntries(fields.map((field) => [field, record.attributes[field] ?? null])),
  })) };
}

const topicFields = ["articleId", "revision", "title", "content", "section", "url", "publishedAt", "updatedAt"];

function topicRow(article) {
  return {
    sourceId: article.sourceId,
    section: article.section,
    observedAt: article.current.observedAt,
    revision: article.current.revision,
    versions: article.versions.length,
    attributes: Object.fromEntries(topicFields.map((field) => [
      field,
      article.current.attributes[field] ?? article.current[field] ?? null,
    ])),
  };
}

// 专题读取方看到的当前有效稿件，按 section 归类；解析失败不会删除这里的上一份有效稿。
export async function readTopic(collectionRepository, { section } = {}) {
  const state = collectionRepository.get();
  const rows = Object.values(state.articles)
    .filter((article) => !section || article.section === section)
    .sort((left, right) => left.sourceId.localeCompare(right.sourceId))
    .map(topicRow);
  return {
    product: "稿件采集台",
    section: section ?? null,
    rows,
    lastBatch: state.batches.at(-1)?.batchId ?? null,
    openFailures: state.failures.length,
  };
}

// 回看某条稿件此前已知的全部版本（新到旧），每条带可核对的采集批次与内容指纹。
export async function readArticleHistory(collectionRepository, sourceId) {
  const state = collectionRepository.get();
  const article = state.articles[String(sourceId)];
  if (!article) return null;
  return {
    sourceId: article.sourceId,
    publishedAt: article.publishedAt,
    current: {
      revision: article.current.revision,
      fingerprint: article.current.fingerprint,
      observedAt: article.current.observedAt,
      batchId: article.current.batchId,
    },
    versions: [...article.versions].reverse().map((version) => ({
      revision: version.revision,
      title: version.title,
      content: version.content,
      section: version.section,
      url: version.url,
      publishedAt: version.publishedAt,
      updatedAt: version.updatedAt,
      observedAt: version.observedAt,
      fingerprint: version.fingerprint,
      batchId: version.batchId,
    })),
  };
}

// 历次正文/条目解析失败依据，供编辑核对为何保留旧稿。
export async function readCollectionFailures(collectionRepository) {
  const state = collectionRepository.get();
  return { failures: state.failures.map(({ raw, ...failure }) => failure) };
}
