import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { MemoryStore, MEMORY_LIMITS, MEMORY_DELIMITER } from '../lib/memory.js';
import { injectMemorySections, injectClarifyPolicy } from '../lib/parser.js';
import { MEMORY_SECTION_NAME, CLARIFY_SECTION_NAME } from '../lib/constants.js';

function makeStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-tf-mem-'));
  return { store: new MemoryStore(dir), dir };
}

test('1. MemoryStore: add/parse round-trip with § delimiter', () => {
  const { store } = makeStore();
  assert.equal(store.parseEntries('memory').length, 0);

  const r1 = store.add('memory', '项目使用 pnpm + TypeScript');
  assert.equal(r1.ok, true);
  const r2 = store.add('memory', '本机是 Windows 11，Shell 用 PowerShell');
  assert.equal(r2.ok, true);

  const entries = store.parseEntries('memory');
  assert.equal(entries.length, 2);
  assert.equal(entries[0], '项目使用 pnpm + TypeScript');

  // 落盘内容使用 § 分隔
  const raw = store.readRaw('memory');
  assert.ok(raw.includes('§'), 'raw file should contain delimiter');
});

test('2. MemoryStore: enforces character cap and returns diagnostics', () => {
  const { store } = makeStore();
  const big = 'x'.repeat(MEMORY_LIMITS.memory + 100);
  const res = store.add('memory', big);

  assert.equal(res.ok, false);
  assert.equal(res.error, 'limit exceeded');
  assert.ok(res.over > 0, 'should report overflow amount');
  assert.ok(res.hint && res.hint.length > 0, 'should give consolidation hint');
  // 拒绝后不应写入
  assert.equal(store.parseEntries('memory').length, 0);
});

test('3. MemoryStore: replace by substring keeps limit invariant', () => {
  const { store } = makeStore();
  store.add('memory', '用户偏好中文回复');
  store.add('memory', '项目路径在 D 盘');

  const rep = store.replace('memory', '中文回复', '用户偏好简体中文，代码注释也用中文');
  assert.equal(rep.ok, true);
  assert.ok(rep.previous.includes('中文回复'));

  const entries = store.parseEntries('memory');
  assert.equal(entries.length, 2);
  assert.ok(entries.some((e) => e.includes('代码注释也用中文')));

  // 匹配不到时明确失败
  const miss = store.replace('memory', '不存在的子串', 'x');
  assert.equal(miss.ok, false);
  assert.equal(miss.error, 'substring not found');
});

test('4. MemoryStore: remove and clear', () => {
  const { store } = makeStore();
  store.add('memory', 'a 条目');
  store.add('memory', 'b 条目');

  const rm = store.remove('memory', 'a 条目');
  assert.equal(rm.ok, true);
  assert.equal(store.parseEntries('memory').length, 1);

  store.clear('memory');
  assert.equal(store.parseEntries('memory').length, 0);
  assert.equal(store.readRaw('memory'), '');
});

test('5. MemoryStore: snapshot shows usage percentage like Hermes', () => {
  const { store } = makeStore();
  assert.equal(store.renderSnapshot('memory'), '', 'empty memory must render empty string');

  store.add('memory', '这是一条记忆');
  const snap = store.renderSnapshot('memory');
  assert.ok(snap.includes('MEMORY (your personal notes)'), 'should have Hermes-style header');
  assert.ok(/\[\d+% — \d+\/2200 chars\]/.test(snap), 'should show percent and char usage');
  assert.ok(snap.includes('这是一条记忆'));

  store.add('user', '用户是 linhr');
  const userSnap = store.renderSnapshot('user');
  assert.ok(userSnap.includes('USER (about the user)'));
  assert.ok(userSnap.includes('/1375 chars'));
});

test('6. injectMemorySections: empty snapshots produce zero sections', () => {
  const base = [{ name: 'system', order: 1, text: 'you are an agent' }];
  const out = injectMemorySections(base, { memory: '', user: '' });

  assert.equal(out.length, base.length, 'no section should be added when memory is empty');
  assert.ok(!out.some((s) => String(s.name || '').startsWith(MEMORY_SECTION_NAME)));
});

test('7. injectMemorySections: injects both layers and is idempotent', () => {
  const base = [{ name: 'system', order: 1, text: 'you are an agent' }];
  const out1 = injectMemorySections(base, { memory: 'M-snapshot', user: 'U-snapshot' });

  const memSections = out1.filter((s) => String(s.name || '').startsWith(MEMORY_SECTION_NAME));
  assert.equal(memSections.length, 2, 'should inject memory + user sections');
  assert.ok(out1.some((s) => s.text.includes('M-snapshot')));
  assert.ok(out1.some((s) => s.text.includes('U-snapshot')));

  // 再次注入不应累积
  const out2 = injectMemorySections(out1, { memory: 'M2', user: 'U2' });
  const again = out2.filter((s) => String(s.name || '').startsWith(MEMORY_SECTION_NAME));
  assert.equal(again.length, 2, 'must not accumulate duplicate memory sections');
  assert.ok(out2.some((s) => s.text.includes('M2')));
  assert.ok(!out2.some((s) => s.text.includes('M-snapshot')), 'old snapshot should be replaced');
});

test('8. injectClarifyPolicy: injects once and respects enable flag', () => {
  const base = [{ name: 'system', order: 1, text: 'x' }];

  const off = injectClarifyPolicy(base, false);
  assert.equal(off.length, base.length, 'disabled must add nothing');

  const on = injectClarifyPolicy(base, true);
  const section = on.find((s) => s.name === CLARIFY_SECTION_NAME);
  assert.ok(section, 'clarify section should be injected');
  assert.ok(section.text.includes('ask_user_question'), 'should reference the real tool');
  assert.ok(section.text.includes('最多问 2 个问题'));

  const twice = injectClarifyPolicy(on, true);
  assert.equal(
    twice.filter((s) => s.name === CLARIFY_SECTION_NAME).length,
    1,
    'must stay idempotent'
  );
});

test('9. end-to-end: memory written then visible in assembled prompt sections', () => {
  const { store } = makeStore();

  // 模拟系统提示装配链路
  let sections = [{ name: 'system', order: 1, text: 'base' }];
  sections = injectMemorySections(sections, {
    memory: store.renderSnapshot('memory'),
    user: store.renderSnapshot('user')
  });
  assert.equal(sections.length, 1, 'before writing memory: no memory section');

  // 写入记忆后再装配
  store.add('memory', '项目用 pnpm');
  store.add('user', '偏好中文');
  sections = injectMemorySections(
    [{ name: 'system', order: 1, text: 'base' }],
    { memory: store.renderSnapshot('memory'), user: store.renderSnapshot('user') }
  );

  const joined = sections.map((s) => s.text).join('\n');
  assert.ok(joined.includes('项目用 pnpm'), 'memory must reach the prompt');
  assert.ok(joined.includes('偏好中文'), 'user preference must reach the prompt');
});
