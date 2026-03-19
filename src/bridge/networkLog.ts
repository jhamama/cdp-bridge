export interface NetworkEntry {
  requestId: string;
  method: string;
  url: string;
  status?: number;
  responseHeaders?: Record<string, string>;
  timestamp: number;
  duration?: number;
  requestBody?: string;
}

export class NetworkLog {
  private entries: NetworkEntry[] = [];
  private maxSize: number;
  private pendingRequests = new Map<string, { startTime: number; entry: NetworkEntry }>();

  constructor(maxSize: number = 200) {
    this.maxSize = maxSize;
  }

  onRequestWillBeSent(params: any) {
    const entry: NetworkEntry = {
      requestId: params.requestId,
      method: params.request.method,
      url: params.request.url,
      timestamp: Date.now(),
    };
    this.pendingRequests.set(params.requestId, { startTime: Date.now(), entry });
  }

  onResponseReceived(params: any) {
    const pending = this.pendingRequests.get(params.requestId);
    if (pending) {
      pending.entry.status = params.response.status;
      pending.entry.responseHeaders = params.response.headers;
      pending.entry.duration = Date.now() - pending.startTime;
      this.add(pending.entry);
      this.pendingRequests.delete(params.requestId);
    }
  }

  private add(entry: NetworkEntry) {
    if (this.entries.length >= this.maxSize) {
      this.entries.shift();
    }
    this.entries.push(entry);
  }

  get(limit: number = 50, filter?: string, method?: string): NetworkEntry[] {
    let result = [...this.entries];
    if (filter) {
      result = result.filter(e => e.url.includes(filter));
    }
    if (method) {
      result = result.filter(e => e.method.toUpperCase() === method.toUpperCase());
    }
    return result.slice(-limit);
  }

  clear() {
    this.entries = [];
    this.pendingRequests.clear();
  }

  resize(newSize: number) {
    this.maxSize = newSize;
    while (this.entries.length > this.maxSize) {
      this.entries.shift();
    }
  }
}
