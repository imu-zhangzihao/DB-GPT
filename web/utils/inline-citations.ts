const MAX_CITATION_INDEX = 100;

function isEscaped(value: string, index: number): boolean {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === '\\'; cursor -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

function markerRunLength(value: string, index: number, marker: string): number {
  let length = 0;
  while (value[index + length] === marker) length += 1;
  return length;
}

function escapeReservedCitationElements(markdown: string): string {
  const escapedBlocks = markdown.replace(/<citation-ref\b[^>]*>[\s\S]*?<\/citation-ref\s*>/gi, value =>
    value.split('<').join('&lt;').split('[').join('&#91;'),
  );
  return escapedBlocks.replace(/<\/?citation-ref\b/gi, value => `&lt;${value.slice(1)}`);
}

/**
 * Turn valid, plain-text Markdown markers such as `[2]` into safe custom
 * elements that the chat renderer can make interactive.
 *
 * Markers inside inline/fenced code, existing Markdown links, images,
 * reference definitions, and escaped text are intentionally left untouched.
 */
export function decorateInlineCitations(markdown: string, validIndexes: ReadonlySet<number>): string {
  if (!markdown) return markdown;

  // Reserve this element for markup produced by this function. This prevents
  // raw model-authored HTML from masquerading as a trusted citation control.
  const safeMarkdown = escapeReservedCitationElements(markdown);
  if (validIndexes.size === 0) return safeMarkdown;

  let output = '';
  let cursor = 0;
  let inlineCodeTicks = 0;
  let fencedCodeMarker = '';
  let fencedCodeLength = 0;
  let lineStart = true;

  while (cursor < safeMarkdown.length) {
    const character = safeMarkdown[cursor];

    if (character === '\n') {
      output += character;
      cursor += 1;
      lineStart = true;
      continue;
    }

    if ((character === '`' || character === '~') && !isEscaped(safeMarkdown, cursor)) {
      const runLength = markerRunLength(safeMarkdown, cursor, character);
      const isFence = lineStart && runLength >= 3 && inlineCodeTicks === 0;
      if (isFence && fencedCodeLength === 0) {
        fencedCodeMarker = character;
        fencedCodeLength = runLength;
      } else if (isFence && character === fencedCodeMarker && runLength >= fencedCodeLength) {
        fencedCodeMarker = '';
        fencedCodeLength = 0;
      } else if (character === '`' && fencedCodeLength === 0) {
        inlineCodeTicks = inlineCodeTicks === 0 ? runLength : runLength === inlineCodeTicks ? 0 : inlineCodeTicks;
      }
      output += safeMarkdown.slice(cursor, cursor + runLength);
      cursor += runLength;
      lineStart = false;
      continue;
    }

    if (fencedCodeLength === 0 && inlineCodeTicks === 0 && character === '[' && !isEscaped(safeMarkdown, cursor)) {
      const match = safeMarkdown.slice(cursor).match(/^\[(\d{1,3})\]/);
      if (match) {
        const index = Number(match[1]);
        const nextCharacter = safeMarkdown[cursor + match[0].length];
        const previousCharacter = safeMarkdown[cursor - 1];
        const nextMarker = safeMarkdown.slice(cursor + match[0].length).match(/^\[(\d{1,3})\]/);
        const nextIsValidCitation = nextMarker ? validIndexes.has(Number(nextMarker[1])) : false;
        const belongsToMarkdownSyntax =
          previousCharacter === '!' ||
          previousCharacter === '[' ||
          nextCharacter === '(' ||
          (nextCharacter === '[' && !nextIsValidCitation) ||
          nextCharacter === ':';

        if (!belongsToMarkdownSyntax && index >= 1 && index <= MAX_CITATION_INDEX && validIndexes.has(index)) {
          output += `<citation-ref data-index="${index}">[${index}]</citation-ref>`;
          cursor += match[0].length;
          lineStart = false;
          continue;
        }
      }
    }

    output += character;
    cursor += 1;
    if (character !== ' ' && character !== '\t' && character !== '\r') lineStart = false;
  }

  return output;
}
