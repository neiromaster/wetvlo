/**
 * Resolve environment variables in strings
 * Supports ${VAR_NAME} syntax
 *
 * @param value - String that may contain ${VAR_NAME} placeholders
 * @returns String with environment variables resolved
 */
export function resolveEnv(value: string): string {
  if (typeof value !== 'string') {
    return value;
  }

  return value.replace(/\$\{([^}]+)\}/g, (_match, varName) => {
    const envValue = process.env[varName];
    if (envValue === undefined) {
      throw new Error(`Environment variable "${varName}" is not set`);
    }
    return envValue;
  });
}

/**
 * Recursively resolve environment variables in object
 *
 * @param obj - Object that may contain strings with ${VAR_NAME}
 * @returns Object with all environment variables resolved
 */
export function resolveEnvRecursive<T>(obj: T): T {
  if (typeof obj === 'string') {
    return resolveEnv(obj) as T;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => resolveEnvRecursive(item)) as T;
  }

  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = resolveEnvRecursive(value);
    }
    return result as T;
  }

  return obj;
}
