import { strict as assert } from 'assert';
import { findCitationTextRanges, getCitationSourceKind, getSafeCitationUrl } from './citation-preview';

assert.equal(getCitationSourceKind('paper.PDF'), 'pdf');
assert.equal(getCitationSourceKind('guide.md'), 'markdown');
assert.equal(getCitationSourceKind('guide.MDX?version=1'), 'markdown');
assert.equal(getCitationSourceKind('README.markdown#section'), 'markdown');
assert.equal(getCitationSourceKind('Knowledge Base', 'docs/source.pdf'), 'pdf');
assert.equal(getCitationSourceKind('', 'docs/source.pdf'), 'pdf');
assert.equal(getCitationSourceKind('notes.txt'), 'text');
assert.equal(getCitationSourceKind('report.xlsx'), 'spreadsheet');
assert.equal(getCitationSourceKind('records.csv'), 'csv');

assert.equal(getSafeCitationUrl('https://example.com/source.pdf'), 'https://example.com/source.pdf');
assert.equal(getSafeCitationUrl('http://example.com/source.md'), 'http://example.com/source.md');
assert.equal(getSafeCitationUrl('javascript:alert(1)'), null);
assert.equal(getSafeCitationUrl('file:///tmp/source.pdf'), null);
assert.equal(getSafeCitationUrl('not a url'), null);

assert.deepEqual(findCitationTextRanges('abcdefghij'.repeat(30), 'abcdefghij'.repeat(24)), [
  { start: 0, end: 240 },
]);

const twoColumnPage =
  'bytetrackachieves803mota773idf1onmot17testsetwith30fpsrunningspeed' +
  'figurecaptioninsertedbythesecondcolumn' +
  'outperformingallprevioustrackersthesourcecodepretrainedmodels';
const interleavedEvidence =
  'bytetrackachieves803mota773idf1onmot17testsetonmot20hieveandbdd100ktrackingbenchmarks' +
  'with30fpsrunningspeedoutperformingallprevioustrackersthesourcecodepretrainedmodels';
const fragmentedRanges = findCitationTextRanges(twoColumnPage, interleavedEvidence);
assert.ok(fragmentedRanges.length > 0);
assert.ok(fragmentedRanges.some(range => range.start === 0));

assert.deepEqual(findCitationTextRanges('unrelated page text', 'different evidence text'), []);

console.log('citation-preview tests passed');
