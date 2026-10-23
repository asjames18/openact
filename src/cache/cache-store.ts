import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

interface CacheEntry<T = unknown> {
  key: string;
  blueprintId: string;
  createdAt: number;
  expiresAt: number;
  data: T;
  tierUsed: string;
}

/**
 * Deterministic Response Cache (Memory + Disk) & Sliding-Window Rate Limiter.
 */
export class CacheAndRateLimiter {
  private readonly cacheDir: string;
  private readonly memoryCache = new Map<string, CacheEntry>();
  private readonly requestTimestamps = new Map<string, number[]>();

  constructor(baseDir: string = process.cwd()) {
    this.cacheDir = path.join(baseDir, '.openact', 'cache');
  }

  public computeKey(blueprintId: string, inputs: Record<string, unknown>): string {
    const sortedInputs = Object.keys(inputs)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = inputs[k];
        return acc;
      }, {});
    const raw = `${blueprintId}:${JSON.stringify(sortedInputs)}`;
    return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 24);
  }

  public get<T = unknown>(
    blueprintId: string,
    inputs: Record<string, unknown>
  ): { data: T; tierUsed: string; ageSeconds: number } | null {
    const key = this.computeKey(blueprintId, inputs);
    const now = Date.now();

    const mem = this.memoryCache.get(key);
    if (mem) {
      if (now < mem.expiresAt) {
        return {
          data: mem.data as T,
          tierUsed: mem.tierUsed,
          ageSeconds: Math.round((now - mem.createdAt) / 1000),
        };
      }
      this.memoryCache.delete(key);
    }

    const filePath = path.join(this.cacheDir, `${key}.json`);
    if (fs.existsSync(filePath)) {
      try {
        const entry = JSON.parse(fs.readFileSync(filePath, 'utf8')) as CacheEntry<T>;
        if (now < entry.expiresAt) {
          this.memoryCache.set(key, entry);
          return {
            data: entry.data,
            tierUsed: entry.tierUsed,
            ageSeconds: Math.round((now - entry.createdAt) / 1000),
          };
        }
        fs.unlinkSync(filePath);
      } catch {
        // Ignore corrupted cache file
      }
    }

    return null;
  }

  public set<T = unknown>(
    blueprintId: string,
    inputs: Record<string, unknown>,
    data: T,
    ttlSeconds: number,
    tierUsed: string
  ): void {
    if (ttlSeconds <= 0) return;

    const key = this.computeKey(blueprintId, inputs);
    const now = Date.now();
    const entry: CacheEntry<T> = {
      key,
      blueprintId,
      createdAt: now,
      expiresAt: now + ttlSeconds * 1000,
      data,
      tierUsed,
    };

    this.memoryCache.set(key, entry);

    try {
      if (!fs.existsSync(this.cacheDir)) {
        fs.mkdirSync(this.cacheDir, { recursive: true });
      }
      const filePath = path.join(this.cacheDir, `${key}.json`);
      fs.writeFileSync(filePath, JSON.stringify(entry), 'utf8');
    } catch {
      // Non-fatal if disk is read-only
    }
  }

  public clearCache(): number {
    const count = this.memoryCache.size;
    this.memoryCache.clear();
    if (fs.existsSync(this.cacheDir)) {
      const files = fs.readdirSync(this.cacheDir).filter((f) => f.endsWith('.json'));
      for (const file of files) {
        try {
          fs.unlinkSync(path.join(this.cacheDir, file));
        } catch {
          // ignore
        }
      }
      return Math.max(count, files.length);
    }
    return count;
  }

  /**
   * Checks and records a request against a blueprint's per-minute rate limit.
   * Throws an error if the rate limit is exceeded.
   */
  public checkRateLimit(blueprintId: string, requestsPerMinute: number = 60): void {
    const now = Date.now();
    const windowStart = now - 60_000;
    const prev = this.requestTimestamps.get(blueprintId) ?? [];
    const active = prev.filter((ts) => ts > windowStart);

    if (active.length >= requestsPerMinute) {
      const retryAfterSec = Math.ceil((active[0] + 60_000 - now) / 1000);
      throw new Error(
        `Rate limit exceeded for "${blueprintId}" (${requestsPerMinute} req/min). Retry in ${retryAfterSec}s.`
      );
    }

    active.push(now);
    this.requestTimestamps.set(blueprintId, active);
  }
}
