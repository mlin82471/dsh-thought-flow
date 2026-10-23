/**
 * 轻量级环形日志与错误聚合缓冲器
 */

export class RingLogger {
  constructor(capacity = 50) {
    this.capacity = capacity;
    this.logs = [];
    this.errors = [];
  }

  log(level, msg, detail = null) {
    const entry = {
      level,
      msg: String(msg),
      detail: detail ? (detail instanceof Error ? { message: detail.message, stack: detail.stack } : detail) : undefined,
      ts: Date.now()
    };
    this.logs.push(entry);
    if (this.logs.length > this.capacity) {
      this.logs.shift();
    }
    if (level === 'error') {
      this.errors.push(entry);
      if (this.errors.length > this.capacity) {
        this.errors.shift();
      }
    }
    if (process.env.NODE_ENV !== 'test') {
      if (level === 'error') {
        console.error('[dsh-tf]', msg, detail || '');
      } else if (level === 'warn') {
        console.warn('[dsh-tf]', msg, detail || '');
      }
    }
  }

  info(msg, detail) { this.log('info', msg, detail); }
  warn(msg, detail) { this.log('warn', msg, detail); }
  error(msg, detail) { this.log('error', msg, detail); }

  getRecentLogs() { return [...this.logs]; }
  getRecentErrors() { return [...this.errors]; }

  clear() {
    this.logs = [];
    this.errors = [];
  }
}

export const logger = new RingLogger();
