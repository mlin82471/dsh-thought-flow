import test from 'node:test';
import assert from 'node:assert/strict';
import { parseThoughtIntoBlocks, enforceChineseRule } from '../lib/parser.js';

test('parseThoughtIntoBlocks breaks thinking into progressive steps', () => {
  const rawText = `首先分析用户的问题，了解核心需求是开发一个插件。
然后，考虑界面的设计，必须使用苹果风格的磨砂玻璃效果。
接着实现打断机制，提供暂停和修改的能力。
最后整理代码，确保单元测试完整。`;

  const blocks = parseThoughtIntoBlocks(rawText);
  assert.ok(blocks.length >= 3, `Expected at least 3 blocks, got ${blocks.length}`);
  assert.equal(blocks[0].step, 1);
  assert.ok(blocks[0].title.length > 0);
  assert.ok(blocks[0].content.includes('用户的问题'));
});

test('enforceChineseRule injects strict Chinese thinking instructions', () => {
  const sections = [
    { name: 'system:base', text: 'You are a helpful assistant.' }
  ];
  const modified = enforceChineseRule(sections);
  const injected = modified.find(s => s.name === 'thought-flow:chinese-constraint');
  assert.ok(injected, 'Expected Chinese constraint section to be injected');
  assert.ok(injected.text.includes('中文'), 'Expected Chinese instruction text');
});
