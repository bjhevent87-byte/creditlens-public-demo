export class ExpiringCache extends Map {
  constructor(defaultTtlMs = 60 * 60_000) {
    super();
    this.defaultTtlMs = defaultTtlMs;
  }

  set(key, value, ttlMs = this.defaultTtlMs) {
    return super.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  get(key) {
    const entry = super.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      super.delete(key);
      return undefined;
    }
    return entry.value;
  }
}
