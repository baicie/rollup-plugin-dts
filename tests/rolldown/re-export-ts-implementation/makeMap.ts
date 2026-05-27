export function makeMap(str: string): (key: string) => boolean {
  const map = Object.create(null) as Record<string, boolean>;
  for (const key of str.split(',')) {
    map[key] = true;
  }
  return key => key in map;
}
