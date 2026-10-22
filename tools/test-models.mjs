// Тесты моделей миров (worlds/<мир>/model.js) в Node без браузера: модель — только данные и алгоритм,
// без DOM, canvas и Web Audio, поэтому импортируется как есть. Пока каркас — модели появятся с шага 4 docs/refactor-plan.md.
//   node --test tools/test-models.mjs
import { test } from 'node:test';

test.todo('Firmamentum: stars, comet, snapshot → restore (step 4)');
