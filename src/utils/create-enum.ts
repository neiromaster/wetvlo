import { z } from 'zod';

/**
 * Helper to create enum-like object with Zod schema
 * - Creates object with uppercase keys: DEBUG -> 'debug'
 * - Creates Zod schema for validation
 * - Infers TypeScript type as string literals
 *
 * @example
 * ```ts
 * export const EpisodeType = createEnum([
 *   'available',
 *   'vip',
 * ] as const);
 *
 * // EpisodeType.object.AVAILABLE === 'available'
 * // EpisodeType.schema - Zod schema
 * // typeof EpisodeType.type === 'available' | 'vip'
 * ```
 */
export function createEnum<const T extends readonly string[]>(values: T) {
  const obj = Object.fromEntries(values.map((v) => [v.toUpperCase(), v])) as Record<Uppercase<T[number]>, T[number]>;

  return {
    values,
    object: obj,
    schema: z.enum(values),
    type: null as unknown as T[number],
  };
}
