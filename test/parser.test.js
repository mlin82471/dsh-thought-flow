import test from 'node:test';
import assert from 'node:assert/strict';
import { parseThoughtIntoBlocks, enforceChineseRule, injectUserGuidance } from '../lib/parser.js';
import { CHINESE_SECTION_NAME, GUIDANCE_SECTION_NAME } from '../lib/constants.js';

test('1. parseThoughtIntoBlocks: breaks thinking into progressive steps with Chinese keywords', () => {
  const rawText = `首先分析用户的问题，了解核心需求是开发一个插件。
然后，考虑界面的设计，必须使用苹果风格的磨砂玻璃效果。
接着实现打断机制，提供暂停和修改的能力。
最后整理代码，确保单元测试完整。`;

  const blocks = parseThoughtIntoBlocks(rawText);
  assert.ok(blocks.length >= 4, `Expected at least 4 blocks, got ${blocks.length}`);
  assert.equal(blocks[0].step, 1);
  assert.ok(blocks[0].title.length > 0);
  assert.ok(blocks[0].content.includes('用户的问题'));
});

test('2. parseThoughtIntoBlocks: handles null, undefined, empty, and non-string inputs safely', () => {
  assert.deepEqual(parseThoughtIntoBlocks(null), []);
  assert.deepEqual(parseThoughtIntoBlocks(undefined), []);
  assert.deepEqual(parseThoughtIntoBlocks(''), []);
  assert.deepEqual(parseThoughtIntoBlocks('   \n  \t  '), []);
  assert.deepEqual(parseThoughtIntoBlocks(12345), []);
  assert.deepEqual(parseThoughtIntoBlocks({}), []);
});

test('3. parseThoughtIntoBlocks: handles standard numbered lists and English Step/Phase markers', () => {
  const rawText = `1. 初始化上下文环境
2. 注入 Cordis 插件监听器
Step 3: 挂载 WebServer 路由与静态资源
Phase 4: 启动前端毛玻璃画板推演`;

  const blocks = parseThoughtIntoBlocks(rawText);
  assert.equal(blocks.length, 4);
  assert.equal(blocks[0].step, 1);
  assert.equal(blocks[1].step, 2);
  assert.equal(blocks[2].step, 3);
  assert.equal(blocks[3].step, 4);
  assert.ok(blocks[0].title.includes('初始化上下文环境'));
});

test('4. parseThoughtIntoBlocks: handles text starting on line 1 with number without leading newline (Issue 11)', () => {
  const rawText = `1. 第一行直接以数字序号开头，无前导换行符。\n2. 第二行推进思考。\n3. 第三行总结收尾。`;
  const blocks = parseThoughtIntoBlocks(rawText);
  assert.equal(blocks.length, 3);
  assert.equal(blocks[0].step, 1);
  assert.ok(blocks[0].content.includes('第一行直接以数字序号开头'));
});

test('5. parseThoughtIntoBlocks: handles purely English text without numbering via paragraph/sentence splitting', () => {
  const englishText = `The user wants to optimize the reasoning flow visualization component.
First, we analyze the architectural bottlenecks and state synchronization logic.
Next, we implement incremental DOM rendering and sanitize rich text inputs to protect the editor.
Finally, we run extensive unit tests and end-to-end verifications.`;

  const blocks = parseThoughtIntoBlocks(englishText);
  assert.ok(blocks.length >= 2, `Expected at least 2 blocks, got ${blocks.length}`);
  assert.equal(blocks[0].step, 1);
  assert.ok(blocks[0].title.length > 0);
});

test('6. parseThoughtIntoBlocks: processes super long text (>15KB) efficiently without crash', () => {
  const segment = `阶段 1：构建大规模推演上下文。\n这是一段针对系统级高并发思考链路的深度推导内容，包含了多种状态变量与分支预测判断。\n`;
  const longText = segment.repeat(300); // > 20KB
  assert.ok(longText.length > 15000);

  const t0 = performance.now();
  const blocks = parseThoughtIntoBlocks(longText);
  const elapsed = performance.now() - t0;

  assert.ok(blocks.length > 10, 'Should break long text into blocks');
  assert.ok(elapsed < 200, `Parsing >15KB text should be fast, took ${elapsed}ms`);
});

test('7. parseThoughtIntoBlocks: gracefully slices single giant paragraph without any newlines', () => {
  const singleParagraph = '深度思维推演正式开始。第一步先明确系统的总体架构与各模块之间的通信契约。第二步对会话生命周期中的各种事件进行细致捕获与分析。第三步对用户输入的数据流进行纯文本清洗与防注入保护。第四步完成整个逻辑闭环并向调用端返回标准格式的数据结构。';
  const blocks = parseThoughtIntoBlocks(singleParagraph);
  assert.ok(blocks.length >= 1, 'Should parse single paragraph into blocks');
  assert.ok(blocks[0].title.length > 0);
});

test('8. enforceChineseRule: injects rule and guarantees idempotency without duplication (Issue 3)', () => {
  const initialSections = [
    { name: 'system:base', text: 'You are an advanced AI assistant.' }
  ];

  const round1 = enforceChineseRule(initialSections);
  assert.equal(round1.length, 2);
  const injected = round1.find(s => s.name === CHINESE_SECTION_NAME);
  assert.ok(injected, 'Expected Chinese constraint section');
  assert.ok(injected.text.includes('中文'));

  // 再次调用 enforceChineseRule，必须防重去重，不得无限膨胀
  const round2 = enforceChineseRule(round1);
  assert.equal(round2.length, 2, 'Should not add duplicate section');
  const count = round2.filter(s => s.name === CHINESE_SECTION_NAME).length;
  assert.equal(count, 1, 'Exactly 1 section should exist');
});

test('9. injectUserGuidance: correctly formats pending user interventions into prompt sections (Issue 1)', () => {
  const sections = [
    { name: 'system:base', text: 'Base prompt.' }
  ];
  const interventions = [
    { text: '请务必使用 TypeScript 风格接口说明' },
    { text: '重点解释打断机制的工作原理' }
  ];

  const updated = injectUserGuidance(sections, interventions);
  assert.equal(updated.length, 2);
  const guidance = updated.find(s => s.name === GUIDANCE_SECTION_NAME);
  assert.ok(guidance);
  assert.ok(guidance.text.includes('TypeScript 风格接口说明'));
  assert.ok(guidance.text.includes('重点解释打断机制'));

  // 空干预数组调用时不产生副作用
  const unchanged = injectUserGuidance(sections, []);
  assert.equal(unchanged.length, 1);
});
