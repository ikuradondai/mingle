import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { challenges } from '../dist/data/challenges.js';
import { CHALLENGE_PAIR_TEMPLATES } from '../dist/data/challenges/pair-text.js';
import { PAIR_PERSONALIZED_CARDS, PARTICIPANT_RULES, displayQuestionText } from '../dist/participant-rule.js';

const byId = new Map(challenges.map((card) => [card.id, card]));
const entries = Object.entries(CHALLENGE_PAIR_TEMPLATES);
const GROUP_WORDS = /右隣|左隣|となりの人|みんな|全員|ここにいる|このメンバー|一斉|このグループ|順に/u;
const GENDERED = /彼氏|彼女|男性|女性|旦那|奥さん|嫁|姑|婿|舅|ママ|パパ|おじいちゃん|おばあちゃん/u;
const ALLOWED_LEFTOVERS = new Set(['try-23', 'ch-reunion-03', 'ch-siblings-08']);
const isGroupDeckOrCommon = (card) => !card.deckIds || card.deckIds.every((id) => PARTICIPANT_RULES[id] === 'group');
const two = (index, names = ['あかり', 'けん']) => ({ participants: names, participantIndex: index, rule: 'group' });

test('145 templates, every key is a real challenge on a group deck or common, not group-only', () => {
  assert.equal(entries.length, 145);
  assert.ok(Object.isFrozen(CHALLENGE_PAIR_TEMPLATES));
  for (const [id] of entries) {
    const card = byId.get(id);
    assert.ok(card, `unknown challenge id ${id}`);
    assert.ok(isGroupDeckOrCommon(card), `${id} is not on a group deck`);
    assert.notEqual(card.players, 'group', id);
  }
});

test('together templates carry no name; each templates carry {name} or ふたり', () => {
  for (const [id, tpl] of entries) {
    const card = byId.get(id);
    if (card.perform === 'together') assert.ok(!tpl.includes('{name}'), `${id} together must not use {name}`);
    else assert.ok(tpl.includes('{name}') || tpl.includes('ふたり'), `${id}: ${tpl}`);
  }
});

test('touch level 1 templates keep エアでもOK', () => {
  for (const [id, tpl] of entries) {
    if (byId.get(id).touch === 1) assert.ok(tpl.includes('エアでもOK'), `${id}: ${tpl}`);
  }
});

test('templates contain no multi-person wording, gendered words, or bare 相手; stay within 60 chars', () => {
  for (const [id, tpl] of entries) {
    assert.ok(!GROUP_WORDS.test(tpl), `${id}: ${tpl}`);
    assert.ok(!GENDERED.test(tpl), `${id}: ${tpl}`);
    assert.ok(!/(?<!対戦)(?<!取引)(?<!相談)(?<!理想の)相手/u.test(tpl), `${id} has 相手: ${tpl}`);
    assert.ok([...tpl.replace(/\{name\}/g, 'あかり')].length <= 60, `${id} too long`);
  }
});

test('leak guard: every 2-player-eligible challenge with group wording has a template (allowlist only)', () => {
  for (const card of challenges) {
    if (card.players === 'group' || !isGroupDeckOrCommon(card)) continue;
    if (!GROUP_WORDS.test(card.text)) continue;
    if (ALLOWED_LEFTOVERS.has(card.id)) continue;
    assert.ok(Object.hasOwn(CHALLENGE_PAIR_TEMPLATES, card.id), `${card.id} needs a pair template: ${card.text}`);
  }
  for (const id of ALLOWED_LEFTOVERS) assert.ok(!Object.hasOwn(CHALLENGE_PAIR_TEMPLATES, id), id);
});

test('PAIR_PERSONALIZED_CARDS includes challenges with source = challenge text', () => {
  for (const [id] of entries) assert.equal(PAIR_PERSONALIZED_CARDS[id].source, byId.get(id).text, id);
});

test('displayQuestionText: each cards show the partner name for either answerer', () => {
  const card = byId.get('ch-friends-01');
  const tpl = CHALLENGE_PAIR_TEMPLATES[card.id];
  assert.equal(displayQuestionText(card.text, { ...two(0), cardId: card.id }), tpl.split('{name}').join('けん'));
  assert.equal(displayQuestionText(card.text, { ...two(1), cardId: card.id }), tpl.split('{name}').join('あかり'));
});

test('displayQuestionText: together cards read the same for both players', () => {
  const card = entries.map(([id]) => byId.get(id)).find((c) => c.perform === 'together');
  const a = displayQuestionText(card.text, { ...two(0), cardId: card.id });
  const b = displayQuestionText(card.text, { ...two(1), cardId: card.id });
  assert.equal(a, b);
  assert.equal(a, CHALLENGE_PAIR_TEMPLATES[card.id]);
});

test('displayQuestionText: 3 players, solo, mismatched text, no cardId fall back to the original', () => {
  const card = byId.get('ch-friends-01');
  assert.equal(displayQuestionText(card.text, { participants: ['A', 'B', 'C'], participantIndex: 0, rule: 'group', cardId: card.id }), card.text);
  assert.equal(displayQuestionText(card.text, { participants: ['自分'], participantIndex: 0, rule: 'solo', cardId: card.id }), card.text);
  assert.equal(displayQuestionText(`${card.text}古い`, { ...two(0), cardId: card.id }), `${card.text}古い`);
  assert.equal(displayQuestionText(card.text, two(0)), card.text);
});

test('displayQuestionText: names with $& stay literal', () => {
  const card = byId.get('ch-friends-01');
  assert.equal(displayQuestionText(card.text, { ...two(0, ['A', '$&<B>&']), cardId: card.id }), CHALLENGE_PAIR_TEMPLATES[card.id].split('{name}').join('$&<B>&'));
  assert.ok(displayQuestionText(card.text, { ...two(0, ['A', '$&<B>&']), cardId: card.id }).startsWith('$&<B>&と'));
});

test('all three call sites pass cardId to displayQuestionText', () => {
  for (const file of ['app.js', 'group-room.js', 'business-play.js']) {
    const src = readFileSync(new URL(`../dist/${file}`, import.meta.url), 'utf8');
    const calls = [...src.matchAll(/displayQuestionText\(/g)].filter((m) => !src.slice(Math.max(0, m.index - 10), m.index).includes('import') && !/^\s*displayQuestionText[,\s]/.test(src.slice(m.index)));
    const bodies = calls.map((m) => src.slice(m.index, m.index + 400));
    assert.ok(bodies.length >= 1, file);
    for (const body of bodies) assert.ok(/cardId:\s*[\w?.]+/.test(body), `${file} lacks cardId`);
  }
});
