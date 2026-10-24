import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import plugin from '../lib/index.js';
import { ROUTES } from '../lib/constants.js';

// ═══════════════════════════════════════════════════════
//  MCP-style in-process test harness
//  不启动服务器，不用端口，直接 app.fetch() 完成
// ═══════════════════════════════════════════════════════

function createTestApp() {
  const routeMap = new Map();
  const eventHandlers = {};

  // 模拟 DSH cordis 环境
  const ctx = {
    root: {
      on(event, handler) {
        eventHandlers[event] = handler;
        return () => { delete eventHandlers[event]; };
      },
      effect(fn) { return fn(); },
      inject(deps, fn) {
        fn({
          webServer: {
            register(route) {
              routeMap.set(route.path, route);
              return () => { routeMap.delete(route.path); };
            }
          }
        });
      }
    }
  };

  plugin.apply(ctx.root);

  // ── app.fetch(url, init) → 进程内路由 HTTP 请求 ──
  async function appFetch(path, { method = 'GET', body = null } = {}) {
    const route = routeMap.get(path);
    if (!route) return { status: 404, body: null, headers: {} };

    const req = new EventEmitter();
    req.method = method;
    const resHeaders = {};
    let resBody = '';
    let resStatus = 200;

    const res = {
      setHeader(k, v) { resHeaders[k.toLowerCase()] = v; },
      getHeader(k) { return resHeaders[k.toLowerCase()]; },
      set statusCode(c) { resStatus = c; },
      get statusCode() { return resStatus; },
      end(chunk) { if (chunk) resBody += chunk; }
    };

    // 模拟请求体
    if (body) {
      process.nextTick(() => {
        req.emit('data', typeof body === 'string' ? body : JSON.stringify(body));
        req.emit('end');
      });
    } else {
      process.nextTick(() => req.emit('end'));
    }

    route.handler(req, res);
    // 等待异步处理
    await new Promise(r => setTimeout(r, 25));

    let parsed = null;
    try { parsed = JSON.parse(resBody); } catch (e) {}

    return { status: resStatus, body: parsed || resBody, raw: resBody, headers: resHeaders };
  }

  // ── app.emit(event, session, data) → 触发 session/event ──
  function appEmit(type, session = {}, data = {}) {
    const handler = eventHandlers['session/event'];
    if (handler) handler(session, { type, data });
  }

  // ── app.assemble(sections) → 触发 system-prompt/assemble (Waterfall) ──
  async function appAssemble(sections) {
    const handler = eventHandlers['system-prompt/assemble'];
    if (!handler) return sections;
    const initial = { sections: sections.map(s => ({ ...s })) };
    const result = await handler(initial, {}, () => Promise.resolve(initial));
    return result ? result.sections : sections;
  }

  return { fetch: appFetch, emit: appEmit, assemble: appAssemble, routeMap, eventHandlers };
}

// ═══════════════════════════════════════════════════════
//  Tests
// ═══════════════════════════════════════════════════════

test('1. plugin export structure and apply lifecycle', () => {
  assert.equal(plugin.name, 'dsh-thought-flow');
  assert.equal(typeof plugin.apply, 'function');

  const app = createTestApp();
  assert.ok(app.routeMap.has(ROUTES.SCRIPT));
  assert.ok(app.routeMap.has(ROUTES.STYLE));
  assert.ok(app.routeMap.has(ROUTES.SYNC));
  assert.ok(app.routeMap.has(ROUTES.ACTION));
  assert.ok(app.routeMap.has(ROUTES.STATUS));
  assert.ok(app.routeMap.has(ROUTES.STREAM));
});

test('2. webServer routes: static js and css delivery', async () => {
  const app = createTestApp();

  const js = await app.fetch(ROUTES.SCRIPT);
  assert.equal(js.status, 200);
  assert.ok(js.headers['content-type'].includes('application/javascript'));
  assert.ok(js.raw.includes('__dshThoughtFlowLoaded'));

  const css = await app.fetch(ROUTES.STYLE);
  assert.equal(css.status, 200);
  assert.ok(css.headers['content-type'].includes('text/css'));
  assert.ok(css.raw.length > 100);
});

test('3. session/event reasoning parsing and state synchronization', async () => {
  const app = createTestApp();

  app.emit('turn/start');

  app.emit('assistant/message', {}, {
    message: {
      content: [
        { type: 'reasoning', text: '首先进行系统上下文的装配。\n然后进行推理分块验证。' }
      ]
    }
  });

  const sync = await app.fetch(ROUTES.SYNC);
  assert.equal(sync.body.ok, true);
  assert.equal(sync.body.isThinking, true);
  assert.equal(sync.body.turnCount, 1);
  assert.ok(sync.body.rounds.length >= 1);
  assert.ok(sync.body.rounds[0].blocks.length >= 2);

  app.emit('turn/end');
  const sync2 = await app.fetch(ROUTES.SYNC);
  assert.equal(sync2.body.isThinking, false);
});

test('4. human intervention opinion injection into system-prompt/assemble', async () => {
  const app = createTestApp();

  // 用户发送指导
  const action = await app.fetch(ROUTES.ACTION, {
    method: 'POST',
    body: { action: 'opinion', text: '请务必使用中文并给出具体技术实现细节' }
  });
  assert.equal(action.body.ok, true);

  // DSH 触发系统提示词装配
  const sections = await app.assemble([{ name: 'system:base', text: 'Base' }]);

  const chineseSec = sections.find(s => s.name === 'thought-flow:chinese-constraint');
  const guidanceSec = sections.find(s => s.name === 'thought-flow:user-guidance');
  assert.ok(chineseSec, 'Chinese directive must be present');
  assert.ok(guidanceSec, 'User guidance directive must be present');
  assert.ok(guidanceSec.text.includes('请务必使用中文'));

  // 验证已消费后不重复
  const sections2 = await app.assemble([{ name: 'system:base', text: 'Base' }]);
  assert.equal(sections2.find(s => s.name === 'thought-flow:user-guidance'), undefined);
});

test('5. pause action triggers session.abort() when active', async () => {
  const app = createTestApp();

  let abortCalled = false;
  app.emit('turn/start', { abort() { abortCalled = true; } });

  const pause = await app.fetch(ROUTES.ACTION, {
    method: 'POST',
    body: { action: 'pause' }
  });
  assert.equal(pause.body.isPaused, true);
  assert.equal(abortCalled, true);

  const resume = await app.fetch(ROUTES.ACTION, {
    method: 'POST',
    body: { action: 'resume' }
  });
  assert.equal(resume.body.isPaused, false);
});

test('6. block editing and clear action flows', async () => {
  const app = createTestApp();

  app.emit('turn/start');
  app.emit('assistant/message', {}, {
    message: { content: [{ type: 'reasoning', text: '1. 初始步骤内容' }] }
  });

  // 编辑 block
  const edit = await app.fetch(ROUTES.ACTION, {
    method: 'POST',
    body: { action: 'edit_block', blockId: 'block-1', content: '被人类直接修改后的内容' }
  });
  assert.equal(edit.body.ok, true);

  const sync = await app.fetch(ROUTES.SYNC);
  assert.equal(sync.body.rounds[0].blocks[0].content, '被人类直接修改后的内容');

  // 清空
  const clear = await app.fetch(ROUTES.ACTION, {
    method: 'POST',
    body: { action: 'clear' }
  });
  assert.equal(clear.body.ok, true);

  const sync2 = await app.fetch(ROUTES.SYNC);
  assert.deepEqual(sync2.body.rounds, []);
});

test('7. /dsh-thought-flow/status reports health and diagnostic stats', async () => {
  const app = createTestApp();

  const status = await app.fetch(ROUTES.STATUS);
  assert.equal(status.body.ok, true);
  assert.equal(status.body.version, '1.0.0');
  assert.ok(typeof status.body.uptimeMs === 'number');
  assert.ok(typeof status.body.turnCount === 'number');
  assert.ok(Array.isArray(status.body.recentErrors));
  assert.ok(Array.isArray(status.body.recentLogs));
});

test('8. /dsh-thought-flow/stream handles SSE connection and stream broadcasting', (t, done) => {
  const app = createTestApp();

  const route = app.routeMap.get(ROUTES.STREAM);
  const req = new EventEmitter();
  const headers = {};
  const chunks = [];

  route.handler(req, {
    writeHead(code, hdrs) { Object.assign(headers, hdrs); },
    write(chunk) { chunks.push(chunk); },
    end() {}
  });

  assert.ok(headers['Content-Type'].includes('text/event-stream'));
  assert.ok(chunks.some(c => c.includes('event: init')));

  // 触发 delta
  app.emit('assistant/delta', {}, {
    delta: { type: 'reasoning', text: '流式逐字推入的片段' }
  });

  assert.ok(chunks.some(c => c.includes('reasoning/delta') && c.includes('流式逐字推入的片段')));
  done();
});

test('9. tool call lifecycle tracking: tool/start and tool/end with status & latency', async () => {
  const app = createTestApp();

  app.emit('turn/start');
  app.emit('tool/start', {}, {
    toolCallId: 'call-101',
    name: 'read_file',
    args: { path: 'src/index.ts' }
  });

  const sync1 = await app.fetch(ROUTES.SYNC);
  const t1 = sync1.body.rounds[0].tools[0];
  assert.equal(t1.name, 'read_file');
  assert.equal(t1.status, 'running');

  app.emit('tool/end', {}, {
    toolCallId: 'call-101',
    result: 'file content successfully read'
  });

  const sync2 = await app.fetch(ROUTES.SYNC);
  const t2 = sync2.body.rounds[0].tools[0];
  assert.equal(t2.status, 'success');
  assert.ok(typeof t2.durationMs === 'number');
});

test('10. token usage extraction & final reply capture', async () => {
  const app = createTestApp();

  app.emit('turn/start');
  app.emit('assistant/message', {}, {
    message: {
      content: [
        { type: 'reasoning', text: '1. 分析系统瓶颈' },
        { type: 'text', text: '这是最终返回给用户的正式回复内容。' }
      ]
    },
    usage: { prompt_tokens: 120, completion_tokens: 85, reasoning_tokens: 60, total_tokens: 205 }
  });

  const sync = await app.fetch(ROUTES.SYNC);
  const round = sync.body.rounds[0];

  assert.equal(round.finalReply, '这是最终返回给用户的正式回复内容。');
  assert.equal(round.stats.promptTokens, 120);
  assert.equal(round.stats.completionTokens, 85);
  assert.equal(round.stats.reasoningTokens, 60);
  assert.equal(round.stats.totalTokens, 205);
});

test('11. style and effort settings flow: update via /dsh-thought-flow/memory and reflection in system prompt and sync', async () => {
  const app = createTestApp();

  // 1. 验证 GET 接口包含默认风格与努力度
  const memGet1 = await app.fetch(ROUTES.MEMORY);
  assert.equal(memGet1.body.thinkStyle, 'deep_think');
  assert.equal(memGet1.body.thinkEffort, 'medium');

  // 2. 更新风格为 relational
  const postStyle = await app.fetch(ROUTES.MEMORY, {
    method: 'POST',
    body: { op: 'set_style', style: 'relational' }
  });
  assert.equal(postStyle.body.ok, true);
  assert.equal(postStyle.body.thinkStyle, 'relational');

  // 3. 更新努力度为 high
  const postEffort = await app.fetch(ROUTES.MEMORY, {
    method: 'POST',
    body: { op: 'set_effort', effort: 'high' }
  });
  assert.equal(postEffort.body.ok, true);
  assert.equal(postEffort.body.thinkEffort, 'high');

  // 4. 验证 SYNC 接口同步反映
  const sync = await app.fetch(ROUTES.SYNC);
  assert.equal(sync.body.thinkStyle, 'relational');
  assert.equal(sync.body.thinkEffort, 'high');

  // 5. 触发 system-prompt/assemble 验证结构化框架注入
  const sections = await app.assemble([{ name: 'base', text: 'Base' }]);
  const fw = sections.find(s => s.name === 'thought-flow:thinking-framework');
  assert.ok(fw);
  assert.ok(fw.text.includes('【结构化思考框架 (6 步推演引导)】'));
  assert.ok(fw.text.includes('对话反思'));
  assert.ok(fw.text.includes('深度 (1000-2000字)'));
});
