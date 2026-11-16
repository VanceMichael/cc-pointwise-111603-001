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
