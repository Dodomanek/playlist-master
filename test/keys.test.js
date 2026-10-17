import test from 'node:test';
import assert from 'node:assert/strict';
import { keyCompatibility, keyNeighbors, parseKey, wheelDistance } from '../src/lib/keys.js';

test('Camelot zápis se přečte tak, jak je', () => {
  assert.equal(parseKey('8A').camelot, '8A');
  assert.equal(parseKey('12b').camelot, '12B');
  assert.equal(parseKey(' 3A ').camelot, '3A');
  assert.equal(parseKey('0A').camelot, null);
  assert.equal(parseKey('13A').camelot, null);
});

test('hudební názvy se převedou na Camelot', () => {
  assert.equal(parseKey('C').camelot, '8B');
  assert.equal(parseKey('Am').camelot, '8A');
  assert.equal(parseKey('A minor').camelot, '8A');
  assert.equal(parseKey('Cmin').camelot, '5A');
  assert.equal(parseKey('CM').camelot, '8B');
  assert.equal(parseKey('Cmajor').camelot, '8B');
  assert.equal(parseKey('F#m').camelot, '11A');
  assert.equal(parseKey('Gbm').camelot, '11A');
  assert.equal(parseKey('Dbm').camelot, '12A');
  assert.equal(parseKey('Abm').camelot, '1A');
  assert.equal(parseKey('Bbm').camelot, '3A');
  assert.equal(parseKey('E♭').camelot, '5B');
  assert.equal(parseKey('B').camelot, '1B');
  assert.equal(parseKey('A#').camelot, '6B');
});

test('prázdný nebo nesmyslný klíč nespadne', () => {
  assert.equal(parseKey('').camelot, null);
  assert.equal(parseKey(null).camelot, null);
  assert.equal(parseKey('xyz').camelot, null);
  assert.equal(parseKey('Cb').camelot, null);
});

test('vzdálenost na wheelu je kruhová', () => {
  assert.equal(wheelDistance(1, 1), 0);
  assert.equal(wheelDistance(12, 1), 1);
  assert.equal(wheelDistance(1, 12), 1);
  assert.equal(wheelDistance(1, 7), 6);
});

test('kompatibilita klíčů kopíruje pravidla Camelot wheelu', () => {
  assert.equal(keyCompatibility('8A', '8A'), 1);
  assert.equal(keyCompatibility('8A', '8B'), 0.92);
  assert.equal(keyCompatibility('8A', '9A'), 0.88);
  assert.equal(keyCompatibility('8A', '9B'), 0.8);
  assert.equal(keyCompatibility('8A', '10A'), 0.7);
  assert.ok(keyCompatibility('8A', '2A') < 0.2, 'tritón musí být mimo');
  assert.ok(keyCompatibility('8A', '10A') > keyCompatibility('8A', '11A'));
});

test('klíč, který nejde přečíst, nikoho neblokuje', () => {
  assert.equal(keyCompatibility('', '8A'), 0.5);
  assert.equal(keyCompatibility('8A', 'haha'), 0.5);
});

test('sousedé na wheelu obsahují očekávané vztahy', () => {
  const rel = keyNeighbors('12A').map((n) => n.camelot);
  assert.deepEqual(rel, ['12A', '12B', '1A', '11A', '2A']);
});
