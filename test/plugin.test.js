import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import plugin from '../lib/index.js';
import { ROUTES, ACTIONS } from '../lib/constants.js';

function createMockReqRes({ method = 'GET', body = null } = {}) {
  const req = new EventEmitter();
  req.method = method;
  const headers = {};
  let resBody = '';
  let statusCode = 200;
  let finished = false;

  const res = {
    setHeader(k, v) { headers[k.toLowerCase()] = v; },
    getHeader(k) { return headers[k.toLowerCase()]; },
    set statusCode(code) { statusCode = code; },
    get statusCode() { return statusCode; },
    end(chunk) {
      if (chunk) resBody += chunk;
      finished = true;
    }
  };

  function sendReq() {
    process.nextTick(() => {
      if (body) {
        req.emit('data', typeof body === 'string' ? body : JSON.stringify(body));
      }
      req.emit('end');
    });
  }

  return {
    req,
    res,
    sendReq,
    getBody: () => resBody,
    getJson: () => JSON.parse(resBody || '{}'),
    getHeaders: () => headers,
    getStatus: () => statusCode,
    isFinished: () => finished
  };
}

function setupTestEnvironment() {
  const eventHandlers = {};
  const routes = {};
  const root = {
    on(event, handler) {
      eventHandlers[event] = handler;
      return () => { delete eventHandlers[event]; };
    },
    effect(fn) {
      return fn();
    },
    inject(deps, fn) {
      fn({
        webServer: {
          register(route) {
            routes[route.path] = route;
            return () => { delete routes[route.path]; };
          }
        }
      });
    }
  };

  plugin.apply(root);
  return { eventHandlers, routes, root };
}

test('1. plugin export structure and apply lifecycle', () => {
  assert.equal(plugin.name, 'dsh-thought-flow');
  assert.equal(typeof plugin.apply, 'function');

  const { eventHandlers, routes } = setupTestEnvironment();

  assert.ok(typeof eventHandlers['webserver/index-inject'] === 'function');
  assert.ok(typeof eventHandlers['system-prompt/assemble'] === 'function');
  assert.ok(typeof eventHandlers['session/event'] === 'function');
  assert.ok(routes[ROUTES.SCRIPT]);
  assert.ok(routes[ROUTES.STYLE]);
  assert.ok(routes[ROUTES.SYNC]);
  assert.ok(routes[ROUTES.ACTION]);
  assert.ok(routes[ROUTES.STATUS]);

  // 验证前端加载代码注入
  const mockTable = [];
  eventHandlers['webserver/index-inject'](mockTable);
  assert.equal(mockTable.length, 1);
  assert.ok(mockTable[0].text.includes(ROUTES.SCRIPT));
});

test('2. webServer routes: static js and css delivery', () => {
  const { routes } = setupTestEnvironment();

  const jsReqRes = createMockReqRes();
  routes[ROUTES.SCRIPT].handler(jsReqRes.req, jsReqRes.res);
  assert.equal(jsReqRes.getStatus(), 200);
  assert.ok(jsReqRes.getHeaders()['content-type'].includes('application/javascript'));
  assert.ok(jsReqRes.getBody().includes('__dshThoughtFlowLoaded'));

  const cssReqRes = createMockReqRes();
  routes[ROUTES.STYLE].handler(cssReqRes.req, cssReqRes.res);
  assert.equal(cssReqRes.getStatus(), 200);
  assert.ok(cssReqRes.getHeaders()['content-type'].includes('text/css'));
  assert.ok(cssReqRes.getBody().includes('tf-flow-panel'));
});

test('3. session/event reasoning parsing and state synchronization', () => {
  const { eventHandlers, routes } = setupTestEnvironment();

  // 模拟 turn/start
  eventHandlers['session/event']({}, { type: 'turn/start' });

  // 模拟 reasoning 消息推送
  const thoughtText = `首先进行系统上下文的装配。\n然后进行推理分块验证。`;
  eventHandlers['session/event']({}, {
    type: 'assistant/message',
    data: {
      message: {
        content: [
          { type: 'reasoning', text: thoughtText }
        ]
      }
    }
  });

  // 通过 /sync 接口验证状态
  const syncReqRes = createMockReqRes();
  routes[ROUTES.SYNC].handler(syncReqRes.req, syncReqRes.res);
  const syncData = syncReqRes.getJson();

  assert.equal(syncData.ok, true);
  assert.equal(syncData.isThinking, true);
  assert.equal(syncData.turnCount, 1);
  assert.ok(syncData.rounds.length >= 1);
  assert.ok(syncData.rounds[0].blocks.length >= 2);

  // 模拟 turn/end
  eventHandlers['session/event']({}, { type: 'turn/end' });
  const syncReqRes2 = createMockReqRes();
  routes[ROUTES.SYNC].handler(syncReqRes2.req, syncReqRes2.res);
  assert.equal(syncReqRes2.getJson().isThinking, false);
});

test('4. human intervention opinion injection into system-prompt/assemble', async () => {
  const { eventHandlers, routes } = setupTestEnvironment();

  // 用户在前端点击"发送指导"
  const actionReqRes = createMockReqRes({
    method: 'POST',
    body: { action: ACTIONS.OPINION, text: '请务必使用中文并给出具体技术实现细节' }
  });
  routes[ACTIONS ? ROUTES.ACTION : '/dsh-thought-flow/action'].handler(actionReqRes.req, actionReqRes.res);
  actionReqRes.sendReq();

  await new Promise(r => setTimeout(r, 20));
  assert.equal(actionReqRes.getStatus(), 200);
  assert.equal(actionReqRes.getJson().ok, true);

  // DSH 触发系统提示词装配
  const assembly = { sections: [{ name: 'system:base', text: 'Base' }] };
  const assembled = eventHandlers['system-prompt/assemble'](assembly);

  // 验证中文约束和用户指导均已注入
  const chineseSec = assembled.sections.find(s => s.name === 'thought-flow:chinese-constraint');
  const guidanceSec = assembled.sections.find(s => s.name === 'thought-flow:user-guidance');
  assert.ok(chineseSec, 'Chinese directive must be present');
  assert.ok(guidanceSec, 'User guidance directive must be present');
  assert.ok(guidanceSec.text.includes('请务必使用中文并给出具体技术实现细节'));

  // 验证已生效后 pending 队列已清空，后续装配不会重复堆积
  const assembly2 = { sections: [{ name: 'system:base', text: 'Base' }] };
  const assembled2 = eventHandlers['system-prompt/assemble'](assembly2);
  const guidanceSec2 = assembled2.sections.find(s => s.name === 'thought-flow:user-guidance');
  assert.equal(guidanceSec2, undefined, 'Pending guidance should be cleared after consumption');
});

test('5. pause action triggers session.abort() when active', async () => {
  const { eventHandlers, routes } = setupTestEnvironment();

  let abortCalled = false;
  const mockSession = {
    abort() {
      abortCalled = true;
    }
  };

  // 触发带有 session 的 turn/start
  eventHandlers['session/event'](mockSession, { type: 'turn/start' });

  // 发送打断请求
  const actionReqRes = createMockReqRes({
    method: 'POST',
    body: { action: ACTIONS.PAUSE }
  });
  routes[ROUTES.ACTION].handler(actionReqRes.req, actionReqRes.res);
  actionReqRes.sendReq();

  await new Promise(r => setTimeout(r, 20));
  assert.equal(actionReqRes.getStatus(), 200);
  assert.equal(actionReqRes.getJson().isPaused, true);
  assert.equal(abortCalled, true, 'session.abort() should have been called');

  // 发送 resume
  const resumeReqRes = createMockReqRes({
    method: 'POST',
    body: { action: ACTIONS.RESUME }
  });
  routes[ROUTES.ACTION].handler(resumeReqRes.req, resumeReqRes.res);
  resumeReqRes.sendReq();

  await new Promise(r => setTimeout(r, 20));
  assert.equal(resumeReqRes.getJson().isPaused, false);
});

test('6. block editing and clear action flows', async () => {
  const { eventHandlers, routes } = setupTestEnvironment();

  // 先注入一段思考
  eventHandlers['session/event']({}, { type: 'turn/start' });
  eventHandlers['session/event']({}, {
    type: 'assistant/message',
    data: { message: { content: [{ type: 'reasoning', text: '1. 初始步骤内容' }] } }
  });

  // 编辑 block
  const editReqRes = createMockReqRes({
    method: 'POST',
    body: { action: ACTIONS.EDIT_BLOCK, blockId: 'block-1', content: '被人类直接修改后的内容' }
  });
  routes[ROUTES.ACTION].handler(editReqRes.req, editReqRes.res);
  editReqRes.sendReq();
  await new Promise(r => setTimeout(r, 20));

  // 验证修改成功
  const syncReqRes = createMockReqRes();
  routes[ROUTES.SYNC].handler(syncReqRes.req, syncReqRes.res);
  const syncData = syncReqRes.getJson();
  assert.equal(syncData.rounds[0].blocks[0].content, '被人类直接修改后的内容');

  // 清空画板
  const clearReqRes = createMockReqRes({
    method: 'POST',
    body: { action: ACTIONS.CLEAR }
  });
  routes[ROUTES.ACTION].handler(clearReqRes.req, clearReqRes.res);
  clearReqRes.sendReq();
  await new Promise(r => setTimeout(r, 20));

  const syncReqRes2 = createMockReqRes();
  routes[ROUTES.SYNC].handler(syncReqRes2.req, syncReqRes2.res);
  assert.deepEqual(syncReqRes2.getJson().rounds, []);
});

test('7. /dsh-thought-flow/status reports health and diagnostic stats', () => {
  const { routes } = setupTestEnvironment();

  const statusReqRes = createMockReqRes();
  routes[ROUTES.STATUS].handler(statusReqRes.req, statusReqRes.res);
  const statusData = statusReqRes.getJson();

  assert.equal(statusData.ok, true);
  assert.equal(statusData.version, '1.0.0');
  assert.ok(typeof statusData.uptimeMs === 'number');
  assert.ok(statusData.stats);
  assert.ok(Array.isArray(statusData.errors));
  assert.ok(Array.isArray(statusData.logs));
});

test('8. /dsh-thought-flow/stream handles SSE connection and stream broadcasting', (t, done) => {
  const { eventHandlers, routes } = setupTestEnvironment();

  const sseReq = new EventEmitter();
  const headers = {};
  const chunks = [];
  const sseRes = {
    writeHead(code, hdrs) {
      Object.assign(headers, hdrs);
    },
    write(chunk) {
      chunks.push(chunk);
    },
    end() {}
  };

  routes[ROUTES.STREAM].handler(sseReq, sseRes);

  assert.ok(headers['Content-Type'].includes('text/event-stream'));
  assert.ok(chunks.some(c => c.includes('event: init')));

  // 触发 reasoning delta
  eventHandlers['session/event']({}, {
    type: 'assistant/delta',
    data: { delta: { type: 'reasoning', text: '流式逐字推入的片段' } }
  });

  assert.ok(chunks.some(c => c.includes('reasoning/delta') && c.includes('流式逐字推入的片段')));
  done();
});

test('9. tool call lifecycle tracking: tool/start and tool/end with status & latency', () => {
  const { eventHandlers, routes } = setupTestEnvironment();

  eventHandlers['session/event']({}, { type: 'turn/start' });

  // 触发工具调用
  eventHandlers['session/event']({}, {
    type: 'tool/start',
    data: {
      toolCallId: 'call-101',
      name: 'read_file',
      args: { path: 'src/index.ts' }
    }
  });

  // 通过 /sync 接口验证运行中状态
  const sync1 = createMockReqRes();
  routes[ROUTES.SYNC].handler(sync1.req, sync1.res);
  const data1 = sync1.getJson();
  assert.equal(data1.rounds[0].tools.length, 1);
  assert.equal(data1.rounds[0].tools[0].name, 'read_file');
  assert.equal(data1.rounds[0].tools[0].status, 'running');

  // 工具调用完成
  eventHandlers['session/event']({}, {
    type: 'tool/end',
    data: {
      toolCallId: 'call-101',
      result: 'file content successfully read'
    }
  });

  const sync2 = createMockReqRes();
  routes[ROUTES.SYNC].handler(sync2.req, sync2.res);
  const data2 = sync2.getJson();
  assert.equal(data2.rounds[0].tools[0].status, 'success');
  assert.ok(typeof data2.rounds[0].tools[0].durationMs === 'number');
});

test('10. token usage extraction & final reply capture for dual-pane view', () => {
  const { eventHandlers, routes } = setupTestEnvironment();

  eventHandlers['session/event']({}, { type: 'turn/start' });

  eventHandlers['session/event']({}, {
    type: 'assistant/message',
    data: {
      message: {
        content: [
          { type: 'reasoning', text: '1. 分析系统瓶颈' },
          { type: 'text', text: '这是最终返回给用户的正式回复内容。' }
        ]
      },
      usage: {
        prompt_tokens: 120,
        completion_tokens: 85,
        reasoning_tokens: 60,
        total_tokens: 205
      }
    }
  });

  const syncReqRes = createMockReqRes();
  routes[ROUTES.SYNC].handler(syncReqRes.req, syncReqRes.res);
  const data = syncReqRes.getJson();

  const round = data.rounds[0];
  assert.equal(round.finalReply, '这是最终返回给用户的正式回复内容。');
  assert.equal(round.stats.promptTokens, 120);
  assert.equal(round.stats.completionTokens, 85);
  assert.equal(round.stats.reasoningTokens, 60);
  assert.equal(round.stats.totalTokens, 205);
});
