interface Entry {
  slug: string;
  title: string;
}

export function getGroups(): { name: string; entries: Entry[] }[] {
  const groups: { name: string; entries: Entry[] }[] = [];
  return groups;
}

export function getMapping(): Record<string, { id: number; label: string }> {
  return {};
}
