// commit(shown): отложенный шаг мира I кладётся в его историю, даже когда на экране уже другой мир
//   node --test tools/test-undo-commit.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nav, registerWorld } from '../host/registry.js';
import { commit, hists } from '../host/undo.js';

test('deferred commit of world 1 after leaving it still pushes the step', () => {
  let s = 'a';
  registerWorld(1, { snapshot: () => ({ s }) });
  registerWorld(2, { snapshot: () => ({}) });
  nav.world = 1; s = 'b';
  nav.world = 2;                                          // ушли в другой мир, пока шаг ждал ядро
  commit();                                               // прежнее поведение: шаг теряется
  assert.equal(hists[1].length, 0);
  s = 'c'; nav.world = 2;
  commit(1);                                              // шаг мира I — явно
  assert.equal(hists[1].length, 1);
});
