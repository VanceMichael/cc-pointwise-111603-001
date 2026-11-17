export class SourceClient {
  constructor(baseUrl) {
    const address = new URL(baseUrl);
    if (address.hostname !== '127.0.0.1') throw new Error('local source required');
    this.baseUrl = address;
  }

  async read(path, { etag } = {}) {
    const address = new URL(path, this.baseUrl);
    if (address.origin !== this.baseUrl.origin) throw new Error('source origin changed');
    const headers = etag ? { 'if-none-match': etag } : undefined;
    const response = await fetch(address, { headers, signal: AbortSignal.timeout(2000) });
    if (response.status === 304) {
      if (!etag) throw new Error('source returned 304 without a conditional request');
      return { notModified: true, etag: response.headers.get('etag'), contentType: null, text: null };
    }
    if (!response.ok) throw new Error(`source ${response.status}: ${path}`);
    return {
      notModified: false,
      text: await response.text(),
      contentType: response.headers.get('content-type'),
      etag: response.headers.get('etag'),
    };
  }
}
