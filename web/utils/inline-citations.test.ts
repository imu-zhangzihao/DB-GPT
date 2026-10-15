import { strict as assert } from 'assert';
import { decorateInlineCitations } from './inline-citations';

const valid = new Set([1, 2]);
const citation = (index: number) => `<citation-ref data-index="${index}">[${index}]</citation-ref>`;

assert.equal(decorateInlineCitations('Claim [1].', valid), `Claim ${citation(1)}.`);
assert.equal(decorateInlineCitations('Claim [1][2].', valid), `Claim ${citation(1)}${citation(2)}.`);
assert.equal(decorateInlineCitations('Claim [9].', valid), 'Claim [9].');
assert.equal(decorateInlineCitations('Claim [1].', new Set()), 'Claim [1].');
assert.equal(decorateInlineCitations('Use `items[1]` here.', valid), 'Use `items[1]` here.');
assert.equal(
  decorateInlineCitations('```python\nitems[1]\n```\nClaim [1].', valid),
  `\`\`\`python\nitems[1]\n\`\`\`\nClaim ${citation(1)}.`,
);
assert.equal(
  decorateInlineCitations('~~~python\nitems[1]\n~~~\nClaim [1].', valid),
  `~~~python\nitems[1]\n~~~\nClaim ${citation(1)}.`,
);
assert.equal(decorateInlineCitations('See [1](https://example.com).', valid), 'See [1](https://example.com).');
assert.equal(decorateInlineCitations('Nested [[1]] text.', valid), 'Nested [[1]] text.');
assert.equal(decorateInlineCitations('![1](image.png)', valid), '![1](image.png)');
assert.equal(decorateInlineCitations('[1]: https://example.com', valid), '[1]: https://example.com');
assert.equal(decorateInlineCitations('Escaped \\[1].', valid), 'Escaped \\[1].');
assert.equal(decorateInlineCitations('[0] [-1] [abc] [101]', valid), '[0] [-1] [abc] [101]');
assert.equal(decorateInlineCitations('[1], then [1].', valid), `${citation(1)}, then ${citation(1)}.`);
assert.equal(
  decorateInlineCitations('<citation-ref data-index="1">[1]</citation-ref>', valid),
  '&lt;citation-ref data-index="1">&#91;1]&lt;/citation-ref>',
);

console.log('inline-citations tests passed');
