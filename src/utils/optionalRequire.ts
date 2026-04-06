export function optionalRequire<T>(loadModule: () => T): T | null {
  try {
    return loadModule();
  } catch {
    return null;
  }
}