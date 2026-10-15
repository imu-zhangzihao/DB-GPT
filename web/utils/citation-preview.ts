export type CitationSourceKind = 'pdf' | 'markdown' | 'text' | 'csv' | 'spreadsheet';

const MARKDOWN_EXTENSIONS = ['.md', '.mdx', '.markdown'];

export function getCitationSourceKind(sourceName?: string, path?: string): CitationSourceKind {
  const locations = [sourceName, path]
    .map(location => (location || '').trim().toLowerCase().split(/[?#]/, 1)[0])
    .filter(Boolean);
  if (locations.some(location => location.endsWith('.pdf'))) return 'pdf';
  if (locations.some(location => location.endsWith('.xlsx') || location.endsWith('.xls'))) return 'spreadsheet';
  if (locations.some(location => location.endsWith('.csv'))) return 'csv';
  if (locations.some(location => MARKDOWN_EXTENSIONS.some(extension => location.endsWith(extension))))
    return 'markdown';
  return 'text';
}

export function getSafeCitationUrl(url?: string): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export interface CitationTextRange {
  start: number;
  end: number;
}

/**
 * Find evidence in a normalized PDF text layer.
 *
 * PDF extractors often interleave columns differently from PDF.js. Prefer one
 * long contiguous match, then progressively match overlapping evidence
 * fragments so a real passage can still be highlighted without treating the
 * whole page as evidence.
 */
export function findCitationTextRanges(pageText: string, evidenceText: string): CitationTextRange[] {
  if (pageText.length < 8 || evidenceText.length < 8) return [];

  const maximum = Math.min(240, evidenceText.length);
  const windowSizes = [...new Set([maximum, 160, 120, 80, 48, 32])].filter(
    size => size >= 32 && size <= evidenceText.length,
  );
  const fragmentRanges: CitationTextRange[] = [];
  for (const windowSize of windowSizes) {
    const ranges: CitationTextRange[] = [];
    const step = Math.max(16, Math.floor(windowSize / 2));
    const offsets = new Set<number>();
    for (let offset = 0; offset + windowSize <= evidenceText.length; offset += step) offsets.add(offset);
    offsets.add(Math.max(0, evidenceText.length - windowSize));

    for (const offset of offsets) {
      const fragment = evidenceText.slice(offset, offset + windowSize);
      if (fragment.length < Math.min(32, windowSize)) continue;
      const start = pageText.indexOf(fragment);
      if (start >= 0) ranges.push({ start, end: start + fragment.length });
    }
    if (!ranges.length) continue;
    if (windowSize >= 120) return ranges;
    fragmentRanges.push(...ranges);
  }
  if (fragmentRanges.length) {
    fragmentRanges.sort((left, right) => left.start - right.start || left.end - right.end);
    return fragmentRanges.reduce<CitationTextRange[]>((merged, range) => {
      const previous = merged[merged.length - 1];
      if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
      else merged.push({ ...range });
      return merged;
    }, []);
  }
  return [];
}
