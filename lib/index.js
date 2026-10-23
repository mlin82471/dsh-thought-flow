import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseThoughtIntoBlocks, enforceChineseRule } from './parser.js';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 注入到 DSH Web 客户端的前端脚本
const INJECT_SCRIPT = `
(function(){
  try {
    var d = document.body || document.head || document.documentElement;
    if (!d) return;
    var s = document.createElement("script");
    s.src = "/dsh-thought-flow/thought-flow.js";
    s.onerror = function(){};
    d.appendChild(s);
  } catch(e){}
})()
`;

export default {
  name: 'dsh-thought-flow',
  apply(root) {
    const disposers = [];
    root.effect(() => () => {
      for (const d of disposers) {
        try { d(); } catch (err) {}
      }
    });

    // 1. 结构化前端脚本注入 (Electron / Web 均兼容)
    disposers.push(root.on('webserver/index-inject', (table) => {
      try {
        if (!Array.isArray(table)) return;
        for (const row of table) {
          if (row && row.kind === 'script' && typeof row.text === 'string' && row.text.includes('/dsh-thought-flow/thought-flow.js')) {
            return;
          }
        }
        table.push({ kind: 'script', placement: 'body', text: INJECT_SCRIPT });
      } catch (err) {}
    }));

    // 2. 状态存储与事件管理
    let currentBlocks = [];
    let pendingInterventions = [];
    let isPaused = false;

    // 3. 注入系统提示词：强制中文思考
    disposers.push(root.on('system-prompt/assemble', (assembly) => {
      try {
        if (assembly && Array.isArray(assembly.sections)) {
          assembly.sections = enforceChineseRule(assembly.sections);
        }
      } catch (err) {}
    }));

    // 4. 监听会话推理事件
    disposers.push(root.on('session/event', (session, event) => {
      try {
        if (!event || !event.type) return;
        const type = event.type;
        const data = event.data || {};

        // 捕获思考链生成
        if (type === 'assistant/message') {
          const msg = data.message || {};
          const content = msg.content;
          if (Array.isArray(content)) {
            for (const part of content) {
              if (part && (part.type === 'reasoning' || part.kind === 'reasoning') && part.text) {
                currentBlocks = parseThoughtIntoBlocks(part.text);
              }
            }
          }
        }
      } catch (err) {}
    }));

    // 5. 注册 Web 端静态路由与控制 API
    root.inject(['webServer'], (ctx) => {
      const server = ctx.webServer;
      if (!server || typeof server.register !== 'function') return;

      // 提供静态资源 /dsh-thought-flow/thought-flow.js
      disposers.push(server.register({
        kind: 'exact',
        path: '/dsh-thought-flow/thought-flow.js',
        handler(req, res) {
          try {
            const jsPath = path.join(PACKAGE_ROOT, 'assets', 'thought-flow.js');
            const content = fs.readFileSync(jsPath, 'utf8');
            res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
            res.end(content);
          } catch (err) {
            res.statusCode = 404;
            res.end('Not found');
          }
        }
      }));

      // 提供静态资源 /dsh-thought-flow/thought-flow.css
      disposers.push(server.register({
        kind: 'exact',
        path: '/dsh-thought-flow/thought-flow.css',
        handler(req, res) {
          try {
            const cssPath = path.join(PACKAGE_ROOT, 'assets', 'thought-flow.css');
            const content = fs.readFileSync(cssPath, 'utf8');
            res.setHeader('Content-Type', 'text/css; charset=utf-8');
            res.end(content);
          } catch (err) {
            res.statusCode = 404;
            res.end('Not found');
          }
        }
      }));

      // 实时同步接口 /dsh-thought-flow/sync
      disposers.push(server.register({
        kind: 'exact',
        path: '/dsh-thought-flow/sync',
        handler(req, res) {
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({
            ok: true,
            isPaused,
            blocks: currentBlocks,
            pendingInterventions
          }));
        }
      }));

      // 用户交互与干预接口 /dsh-thought-flow/action
      disposers.push(server.register({
        kind: 'exact',
        path: '/dsh-thought-flow/action',
        handler(req, res) {
          if (req.method !== 'POST') {
            res.statusCode = 405;
            res.end('Method not allowed');
            return;
          }
          let body = '';
          req.on('data', chunk => { body += chunk; });
          req.on('end', () => {
            try {
              const payload = JSON.parse(body || '{}');
              if (payload.action === 'pause') {
                isPaused = true;
              } else if (payload.action === 'resume') {
                isPaused = false;
              } else if (payload.action === 'opinion') {
                pendingInterventions.push({
                  type: 'opinion',
                  text: payload.text,
                  ts: Date.now()
                });
              } else if (payload.action === 'edit_block') {
                const target = currentBlocks.find(b => b.id === payload.blockId);
                if (target) {
                  target.content = payload.content;
                }
              }
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ ok: true }));
            } catch (err) {
              res.statusCode = 400;
              res.end(JSON.stringify({ ok: false, error: err.message }));
            }
          });
        }
      }));
    });
  }
};
