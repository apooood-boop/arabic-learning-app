import { VocabCard } from '../types/arabic';

export const SUGGESTED_VOCAB_TAGS: string[] = [
  'Daily Life',
  'Travel',
  'Food & Drink',
  'Work & Study',
  'Grammar',
  'Verbs',
  'Culture & History',
  'Feelings',
];

export function normalizeVocabTag(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .trim()
    .replace(/^#+/, '')
    .replace(/\s+/g, ' ')
    .slice(0, 32)
    .trim();
}

export function normalizeVocabTags(rawTags: unknown): string[] {
  const source: unknown[] = Array.isArray(rawTags)
    ? rawTags
    : typeof rawTags === 'string'
      ? rawTags.split(/[,،]+/)
      : [];

  const seen = new Set<string>();
  const result: string[] = [];

  for (const item of source) {
    const cleaned = normalizeVocabTag(item);
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
  }

  return result;
}

export function parseTagInput(raw: string): string[] {
  return normalizeVocabTags(raw.split(/[,،]+/));
}

export function cardHasTag(card: VocabCard, targetTag: string): boolean {
  const targetKey = normalizeVocabTag(targetTag).toLowerCase();
  if (!targetKey) return false;
  return normalizeVocabTags(card.tags).some((tag) => tag.toLowerCase() === targetKey);
}

export function collectDeckTags(cards: VocabCard[]): Array<{ tag: string; count: number }> {
  const map = new Map<string, { tag: string; count: number }>();

  for (const card of cards) {
    const cardTags = normalizeVocabTags(card.tags);
    for (const tag of cardTags) {
      const key = tag.toLowerCase();
      const existing = map.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        map.set(key, { tag, count: 1 });
      }
    }
  }

  return Array.from(map.values()).sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.tag.localeCompare(b.tag, undefined, { sensitivity: 'base' });
  });
}
