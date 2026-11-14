import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { coordinates, parseProperties } from './spherex-map/public/sky-data.js';

test('accepts decimal and sexagesimal ICRS coordinates and rejects invalid bounds', () => {
  assert.deepEqual(coordinates('210.80227, +54.34895'), [210.80227, 54.34895]);
  assert.deepEqual(coordinates('05:30:00 −05:30:00'), [82.5, -5.5]);
  assert.throws(() => coordinates('360 0'));
  assert.throws(() => coordinates('10 -91'));
  assert.equal(coordinates('Orion'), null);
});

test('official metadata gives the expected first, blank and reference frame labels', () => {
  const metadata = readFileSync(new URL('./spherex-map/public/irsa.properties', import.meta.url), 'utf8');
  const frames = parseProperties(metadata);
  assert.deepEqual([frames.length, frames[0], frames[50], frames[51], frames[62], frames[101]], [102, .753, 2.399, 2.445, 3.293, 4.988]);
  assert.throws(() => parseProperties(metadata.replace('0.771', 'NaN')));
});
