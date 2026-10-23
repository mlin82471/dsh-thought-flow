import test from 'node:test';
import assert from 'node:assert/strict';
import plugin from '../lib/index.js';

test('plugin export structure and apply lifecycle', () => {
  assert.equal(plugin.name, 'dsh-thought-flow');
  assert.equal(typeof plugin.apply, 'function');

  // 模拟 Cordis root 环境
  const eventHandlers = {};
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
            return () => {};
          }
        }
      });
    }
  };

  plugin.apply(root);

  // 验证关键钩子注册
  assert.ok(typeof eventHandlers['webserver/index-inject'] === 'function');
  assert.ok(typeof eventHandlers['system-prompt/assemble'] === 'function');
  assert.ok(typeof eventHandlers['session/event'] === 'function');

  // 验证注入代码
  const mockTable = [];
  eventHandlers['webserver/index-inject'](mockTable);
  assert.equal(mockTable.length, 1);
  assert.ok(mockTable[0].text.includes('/dsh-thought-flow/thought-flow.js'));
});
