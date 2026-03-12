type EnvOverrides = Record<string, string | undefined>;

/**
 * Run a function with temporary env-var overrides.
 * Saves affected variables before applying overrides, runs `fn`,
 * then restores originals in a `finally` block — even on throw.
 * Setting a key to `undefined` deletes it for the duration.
 */
export async function withTestEnv<T>(overrides: EnvOverrides, fn: () => T | Promise<T>): Promise<T> {
  const saved: EnvOverrides = {};
  for (const key of Object.keys(overrides)) {
    saved[key] = process.env[key];
  }
  try {
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}
