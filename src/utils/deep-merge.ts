export function deepMerge<T extends object, U extends object>(target: T, source?: U): DeepMerge<T, U> {
  if (!source) {
    return target as unknown as DeepMerge<T, U>;
  }

  const result = { ...target } as Record<string, unknown>;

  for (const key in source) {
    if (Object.hasOwn(source, key)) {
      const sourceValue = source[key];
      const targetValue = result[key];

      if (isObject(sourceValue) && isObject(targetValue)) {
        result[key] = deepMerge(targetValue, sourceValue);
      } else {
        result[key] = sourceValue;
      }
    }
  }

  return result as DeepMerge<T, U>;
}

function isObject(item: unknown): item is object {
  return typeof item === 'object' && item !== null && !Array.isArray(item);
}

// 1. Utility for forced type disclosure (nice output in IDE)
type Simplify<T> = { [K in keyof T]: T[K] } & {};

// 2. Smart check for object/Record
// Exclude arrays and functions, consider the possibility of undefined
// biome-ignore lint/complexity/noBannedTypes: type check
// biome-ignore lint/suspicious/noExplicitAny: type check
type IsRecord<T> = T extends object ? (T extends any[] ? false : T extends Function ? false : true) : false;

// Helper for obtaining a pure type without undefined
type NotUndefined<T> = Exclude<T, undefined>;

// 3. Choosing keys
type OptionalKeys<T> = {
  // biome-ignore lint/complexity/noBannedTypes: type check
  [K in keyof T]-?: {} extends Pick<T, K> ? K : never;
}[keyof T];
type RequiredKeys<T> = Exclude<keyof T, OptionalKeys<T>>;

// 4. Merge values
type MergeValues<T, S> =
  // Check if both values (without undefined) are objects
  IsRecord<NotUndefined<T>> extends true
    ? IsRecord<NotUndefined<S>> extends true
      ? // IF BOTH ARE OBJECTS:
        // Recursively merge their "clean" versions.
        // IMPORTANT: We removed `| (undefined extends S ? T : never)`,
        // to prevent the strict type from Source from being swallowed by the weak type from Target.
        DeepMerge<NotUndefined<T>, NotUndefined<S>>
      : // IF DIFFERENT TYPES (or primitives):
        SimpleMerge<T, S>
    : SimpleMerge<T, S>;

// 5. Simple merge for primitives
// Here we leave the fallback to T, as it's safe for primitives (string | undefined)
type SimpleMerge<T, S> = NotUndefined<S> | (undefined extends S ? T : never);

// 6. Main type DeepMerge
export type DeepMerge<T, S> =
  IsRecord<NotUndefined<T>> extends true
    ? IsRecord<NotUndefined<S>> extends true
      ? Simplify<
          // Keys from T (that are not in S)
          Pick<T, Exclude<keyof T, keyof S>> &
            // Keys from S (that are not in T)
            Pick<S, Exclude<keyof S, keyof T>> & {
              // If a key is required in AT LEAST ONE object -> it's required // Common keys:
              [K in (RequiredKeys<T> & keyof S) | (RequiredKeys<S> & keyof T)]: MergeValues<T[K], S[K]>;
              // biome-ignore lint/suspicious/noExplicitAny: type check
            } & { [K in (OptionalKeys<T> & OptionalKeys<S>) & keyof any]?: MergeValues<T[K], S[K]> } // If a key is optional in BOTH -> it's optional
        >
      : S // If S is no longer an object, it overwrites T
    : S;
