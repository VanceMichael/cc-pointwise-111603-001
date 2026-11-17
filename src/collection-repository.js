import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const emptyState = () => ({
  source: null,
  checkpoint: { path: null, pages: {}, completed: false },
  articles: {},
  batches: [],
  failures: [],
});

// 持续采集的全部状态在单文件内原子提交；采集器每处理完一页就落盘一次，
// 中断后用同一份状态继续，重复重试不会重复产生版本。
export class CollectionRepository {
  constructor(path) {
    this.path = path;
    this.state = emptyState();
    this.loaded = false;
  }

  async load() {
    try {
      const value = JSON.parse(await readFile(this.path, 'utf8'));
      this.state = { ...emptyState(), ...value };
      this.state.checkpoint = { ...emptyState().checkpoint, ...(value.checkpoint ?? {}) };
      this.state.checkpoint.pages = value.checkpoint?.pages ?? {};
      this.state.articles = value.articles ?? {};
      this.state.batches = value.batches ?? [];
      this.state.failures = value.failures ?? [];
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      this.state = emptyState();
    }
    this.loaded = true;
    return this.state;
  }

  get() {
    if (!this.loaded) throw new Error('collection repository must be loaded first');
    return this.state;
  }

  async save() {
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(this.state, null, 2)}\n`, { flag: 'wx' });
    await rename(temporary, this.path);
  }
}
