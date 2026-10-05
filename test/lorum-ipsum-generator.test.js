import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loremIpsum, loremSentence, LANGUAGES, WORD_BANKS } from '../src/wc/machvive-lorum-ipsum/generator.js';

const sentencesIn = (text) => text.split('.').filter((s) => s.trim()).length;
const wordsIn = (sentence) => sentence.trim().split(/\s+/).filter(Boolean);

describe('loremIpsum()', () => {
  test('offers both languages and rejects anything else', () => {
    assert.deepEqual([...LANGUAGES], ['latin', 'english']);
    for (const lang of LANGUAGES) assert.ok(loremIpsum({ lang, sentences: 1 }).length > 0);
    assert.throws(
      () => loremIpsum({ lang: 'klingon' }),
      // Not just `TypeError`: with no guard at all, indexing an undefined bank
      // throws its own TypeError and a bare type assertion passes regardless.
      (err) => err instanceof TypeError && /lang must be one of latin, english/.test(err.message)
    );
  });

  test('a seed makes output repeatable', () => {
    // Without this a page regenerates different copy on every render, which turns
    // a visual diff into noise and makes a screenshot useless as a regression check.
    assert.equal(loremIpsum({ seed: 99 }), loremIpsum({ seed: 99 }));
    assert.notEqual(loremIpsum({ seed: 99 }), loremIpsum({ seed: 100 }));
  });

  test('no seed means fresh copy', () => {
    const runs = new Set(Array.from({ length: 8 }, () => loremIpsum({ sentences: 4 })));
    assert.ok(runs.size > 1, 'unseeded calls should not keep returning one string');
  });

  test('produces the requested number of sentences', () => {
    for (const count of [1, 3, 9]) {
      assert.equal(sentencesIn(loremIpsum({ sentences: count, seed: 5 })), count);
    }
  });

  test('sentences: -1 picks between one and five', () => {
    // Parity with the original tool, where -1 meant "surprise me".
    const counts = new Set();
    for (let seed = 0; seed < 40; seed++) counts.add(sentencesIn(loremIpsum({ sentences: -1, seed })));
    assert.ok(counts.size > 1, 'should vary');
    for (const n of counts) assert.ok(n >= 1 && n <= 5, `${n} is outside 1-5`);
  });

  test('paragraphs are separated by a blank line', () => {
    const text = loremIpsum({ sentences: 2, paragraphs: 3, seed: 11 });
    const parts = text.split('\n\n');
    assert.equal(parts.length, 3);
    for (const part of parts) assert.equal(sentencesIn(part), 2);
  });

  test('word counts stay inside the requested range', () => {
    const text = loremIpsum({ sentences: 20, minWords: 6, maxWords: 8, lang: 'english', seed: 3 });
    for (const sentence of text.split('.').filter((s) => s.trim())) {
      const count = wordsIn(sentence).length;
      assert.ok(count >= 6 && count <= 8, `"${sentence.trim()}" has ${count} words`);
    }
  });

  test('a word is never repeated inside one sentence', () => {
    const text = loremIpsum({ sentences: 12, lang: 'english', seed: 21 });
    for (const sentence of text.split('.').filter((s) => s.trim())) {
      const words = wordsIn(sentence).map((w) => w.toLowerCase());
      assert.equal(new Set(words).size, words.length, `repeat in "${sentence.trim()}"`);
    }
  });

  test('words do repeat across sentences', () => {
    // The original deduped against the whole output with a substring match, which
    // silently starved later sentences. Real prose reuses words; only a sentence
    // reads badly when it does.
    const text = loremIpsum({ sentences: 25, lang: 'latin', seed: 8 });
    const all = text.toLowerCase().replace(/\./g, '').split(/\s+/).filter(Boolean);
    assert.ok(new Set(all).size < all.length, 'vocabulary should not be globally unique');
  });

  test('every sentence is capitalised and closed', () => {
    const text = loremIpsum({ sentences: 6, lang: 'english', seed: 4 });
    assert.ok(text.endsWith('.'));
    for (const sentence of text.split('.').filter((s) => s.trim())) {
      assert.match(sentence.trim()[0], /[A-Z]/, `"${sentence.trim()}" is not capitalised`);
    }
  });

  test('Latin opens with the phrase everyone recognises', () => {
    assert.ok(loremIpsum({ sentences: 3, seed: 1 }).startsWith('Lorem ipsum dolor sit amet'));
    assert.ok(!loremIpsum({ sentences: 3, seed: 1, classicOpening: false }).startsWith('Lorem ipsum dolor'));
  });

  test('English does not open with Latin', () => {
    for (let seed = 0; seed < 10; seed++) {
      assert.ok(!loremIpsum({ lang: 'english', seed }).startsWith('Lorem ipsum'));
    }
  });

  test('the two banks are actually different vocabularies', () => {
    const words = (lang) => new Set(
      loremIpsum({ sentences: 40, lang, seed: 2 }).toLowerCase().replace(/\./g, '').split(/\s+/)
    );
    const latin = words('latin');
    const english = words('english');
    const shared = [...latin].filter((w) => english.has(w));
    assert.ok(shared.length < latin.size / 4, `banks overlap too much: ${shared.join(', ')}`);
  });

  test('terminates when the bank is smaller than the sentence asked for', () => {
    // Exact-word dedupe plus a large target could otherwise spin forever.
    const started = Date.now();
    const text = loremIpsum({ sentences: 1, minWords: 400, maxWords: 400, seed: 6 });
    assert.ok(Date.now() - started < 1000, 'should not spin looking for unused words');
    assert.ok(wordsIn(text).length > 50, 'should still produce a long sentence');
    // Per-sentence dedupe is the real ceiling: a sentence can never be longer
    // than the bank, however many words were asked for.
    assert.ok(wordsIn(text).length <= WORD_BANKS.latin.length);
    assert.ok(text.endsWith('.'));
  });

  test('degenerate ranges do not throw', () => {
    assert.ok(loremIpsum({ minWords: 10, maxWords: 2, seed: 1 }).endsWith('.'));
    assert.ok(loremIpsum({ sentences: 0, seed: 1 }).endsWith('.'), 'zero falls back to one');
    assert.ok(loremIpsum({ paragraphs: 0, seed: 1 }).endsWith('.'));
  });

  test('no bank word contains anything HTML would interpret', () => {
    // Why this is worth a test: it is the reason rendering copy with textContent
    // rather than innerHTML is currently unobservable. The day a word bank gains
    // an & or a <, this fails and points at the right place — rather than the
    // difference quietly becoming an injection surface.
    for (const [lang, bank] of Object.entries(WORD_BANKS)) {
      const unsafe = bank.filter((word) => /[<>&"]/.test(word));
      assert.deepEqual(unsafe, [], `${lang} bank contains ${unsafe.join(', ')}`);
    }
  });

  test('loremSentence returns exactly one sentence', () => {
    const text = loremSentence({ lang: 'english', seed: 12 });
    assert.equal(sentencesIn(text), 1);
    assert.ok(!text.includes('\n'));
  });
});
