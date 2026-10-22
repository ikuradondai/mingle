import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { soloDecks } from '../dist/data/solo-decks.js';

const app = fs.readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8');
const card = (id) => soloDecks.flatMap((deck) => deck.questions).find((question) => question.id === id);

test('solo round completion offers a fourth prompt-only choice; group keeps its own actions', () => {
  const solo = app.match(/const actionsConfig = solo \? \{([\s\S]*?)\n  \} : completionActions;/);
  assert.ok(solo, 'solo actionsConfig block');
  assert.match(solo[1], /surprise: \{ label: "意外だった答え", icon: "heart", prompt: "書いてみて、自分でも意外だった答えは？" \}/);
  assert.equal((solo[1].match(/label:/g) || []).length, 4);
  assert.match(app, /\["self", "favorite", "share", "surprise"\]\.includes\(choice\)/);
  const group = app.match(/const completionActions = Object\.freeze\(\{([\s\S]*?)\n\}\);/);
  assert.ok(group, 'group completionActions block');
  assert.doesNotMatch(group[1], /surprise|意外だった答え/);
  assert.match(app, /\["favorite", "share", "surprise"\]\.includes\(id\) && !recallAvailable/);
  assert.match(app, /choice === "surprise"\) && soloReflectionEntries\(state\.session\)\.length < 1/);
});

test('clarified work and decision cards keep length and question-mark limits', () => {
  assert.equal(card('self-work-09').text, '仕事でやめたくないことは？ やめたくない本当の理由は？');
  assert.equal(card('self-decision-07').text, '迷っていることが勝手に決まったら、ほっとするのはどっちの結果？');
  assert.equal(card('self-decision-02').text, '今、迷っていることを一言で言うと？');
  for (const id of ['self-work-09', 'self-decision-07', 'self-decision-02']) {
    const text = card(id).text;
    assert.ok(Array.from(text).length <= 40, id);
    assert.ok((text.match(/？/g) || []).length <= 2, id);
  }
});
