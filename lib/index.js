import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseThoughtIntoBlocks, enforceChineseRule, injectUserGuidance } from './parser.js';
import {
  isTurnStart,
  isTurnEnd,
  isMessageEvent,
  isReasoningPart,
  isDeltaEvent,
  isToolStart,
  isToolEnd,
  extractUsage,
  ROUTES,
  ACTIONS
} from './constants.js';
import { logger } from './logger.js';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 注入到 DSH Web 客户端的前端脚本
const INJECT_SCRIPT = `
(function(){
  try {
    var d = document.body || document.head || document.documentElement;
    if (!d) return;
    var s = document.createElement("script");
    s.src = "${ROUTES.SCRIPT}";
    s.onerror = function(){};
    d.appendChild(s);
  } catch(e){}
})()
`;

export default {
  name: 'dsh-thought-flow',
  apply(root) {
    const startTime = Date.now();
    const disposers = [];
    const sseClients = new Set();

    function broadcastSSE(event, payload) {
      const msg = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
      for (const client of sseClients) {
        try {
          if (typeof client.write === 'function') {
            client.write(msg);
          }
        } catch (err) {
          sseClients.delete(client);
        }
      }
    }
    function truncateRounds(maxRounds = 30) {
      if (rounds.length > maxRounds) {
        rounds = rounds.slice(-maxRounds);
        logger.info('Rounds truncated to ' + maxRounds);
      }
    }

    root.effect(() => () => {
      for (const client of sseClients) {
        try { client.end(); } catch (err) {}
      }
      sseClients.clear();
      for (const d of disposers) {
        try { d(); } catch (err) { logger.warn('Disposer failed', err); }
      }
    });

    // 1. 结构化前端脚本注入 (Electron / Web 均兼容)
    disposers.push(root.on('webserver/index-inject', (table) => {
      try {
        if (!Array.isArray(table)) return;
        for (const row of table) {
          if (row && row.kind === 'script' && typeof row.text === 'string' && row.text.includes(ROUTES.SCRIPT)) {
            return;
          }
        }
        table.push({ kind: 'script', placement: 'body', text: INJECT_SCRIPT });
      } catch (err) {
        logger.error('Failed to inject webserver script', err);
      }
    }));

    // 2. 状态存储与多轮思考历史 (按轮次/阶段沉淀)
    let rounds = []; // [{ roundId: 1, title: '第一次思考', blocks: [...] }]
    let currentBlocks = [];
    let pendingInterventions = [];
    let appliedInterventions = [];
    let isPaused = false;
    let isThinking = false;
    let turnCount = 0;
    let currentSession = null;

    function cancelActiveSession() {
      if (!currentSession) return false;
      try {
        if (typeof currentSession.abort === 'function') {
          currentSession.abort();
          logger.info('Session aborted via currentSession.abort()');
          return true;
        }
        if (typeof currentSession.cancel === 'function') {
          currentSession.cancel();
          logger.info('Session aborted via currentSession.cancel()');
          return true;
        }
        if (currentSession.client && typeof currentSession.client.abort === 'function') {
          currentSession.client.abort();
          logger.info('Session aborted via currentSession.client.abort()');
          return true;
        }
        if (currentSession.request && typeof currentSession.request.abort === 'function') {
          currentSession.request.abort();
          logger.info('Session aborted via currentSession.request.abort()');
          return true;
        }
      } catch (err) {
        logger.error('Failed to cancel active session', err);
      }
      logger.warn('cancelActiveSession: no known abort API matched on session');
      return false;
    }

    // 3. 注入系统提示词：强制中文思考 + 用户实时意见介入
    disposers.push(root.on('system-prompt/assemble', (assembly) => {
      try {
        if (assembly && Array.isArray(assembly.sections)) {
          // 强制中文思维链（已做防重复注入）
          assembly.sections = enforceChineseRule(assembly.sections);

          // 注入挂起的用户指导意见并清空 pending 队列
          if (pendingInterventions.length > 0) {
            assembly.sections = injectUserGuidance(assembly.sections, pendingInterventions);
            appliedInterventions.push(...pendingInterventions);
            logger.info(`Injected ${pendingInterventions.length} user interventions into system prompt`);
            pendingInterventions = [];
          }
        }
      } catch (err) {
        logger.error('Failed in system-prompt/assemble', err);
      }
      return assembly;
    }));

    // 4. 监听会话推理与工具调用事件
    disposers.push(root.on('session/event', (session, event) => {
      try {
        if (session) {
          currentSession = session;
        }
        if (!event || !event.type) return;
        const type = event.type;
        const data = event.data || {};

        if (type === 'session/end' || type === 'session.end' || type === 'session:end') {
          isThinking = false;
          isPaused = false;
          currentSession = null;
          turnCount = 0;
          broadcastSSE('reset', {});
        }
        if (isTurnStart(type)) {
          turnCount++;
          isThinking = true;
          const roundTitle = turnCount <= 1 ? '第一次思考' : (turnCount === 2 ? '第二次思考' : `第 ${turnCount} 次思考`);
          let existingRound = rounds.find(r => r.roundId === turnCount);
          if (!existingRound) {
            existingRound = {
              roundId: turnCount || 1,
              title: roundTitle,
              blocks: [],
              tools: [],
              stats: { startTime: Date.now() },
              finalReply: ''
            };
            rounds.push(existingRound);
          }
          broadcastSSE('turn/start', { turnCount, round: existingRound });
        }

        if (isTurnEnd(type)) {
          isThinking = false;
          let existingRound = rounds.find(r => r.roundId === turnCount);
          if (existingRound && existingRound.stats && existingRound.stats.startTime) {
            existingRound.stats.durationMs = Math.max(0, Date.now() - existingRound.stats.startTime);
          }
          broadcastSSE('turn/end', { turnCount, round: existingRound });
          truncateRounds(30);
        }

        // 工具调用启动 (Issue 3: 工具可视化)
        if (isToolStart(type)) {
          let currentRound = rounds.find(r => r.roundId === turnCount) || rounds[rounds.length - 1];
          if (!currentRound) {
            currentRound = { roundId: turnCount || 1, title: '第一次思考', blocks: [], tools: [], stats: { startTime: Date.now() }, finalReply: '' };
            rounds.push(currentRound);
          }
          if (!currentRound.tools) currentRound.tools = [];
          const tool = {
            id: data.toolCallId || data.id || ('tool-' + Date.now()),
            name: data.name || data.tool || '未知工具',
            args: data.args || data.arguments || {},
            startTime: Date.now(),
            status: 'running'
          };
          currentRound.tools.push(tool);
          broadcastSSE('tool/start', { roundId: currentRound.roundId, tool });
        }

        // 工具调用结束
        if (isToolEnd(type)) {
          let currentRound = rounds.find(r => r.roundId === turnCount) || rounds[rounds.length - 1];
          if (currentRound && currentRound.tools && currentRound.tools.length > 0) {
            const toolId = data.toolCallId || data.id;
            let tool = toolId ? currentRound.tools.find(t => t.id === toolId) : null;
            if (!tool) {
              for (let i = currentRound.tools.length - 1; i >= 0; i--) {
                if (currentRound.tools[i].status === 'running') {
                  tool = currentRound.tools[i];
                  break;
                }
              }
            }
            if (tool) {
              tool.endTime = Date.now();
              tool.durationMs = Math.max(0, tool.endTime - tool.startTime);
              tool.status = (data.error || data.exitCode > 0) ? 'error' : 'success';
              tool.result = data.result || data.output || data.response;
              tool.error = data.error ? (typeof data.error === 'string' ? data.error : (data.error.message || '执行失败')) : null;
              broadcastSSE('tool/end', { roundId: currentRound.roundId, tool });
            }
          }
        }

        // 流式增量推理片段 (Issue 1: 流式推入)
        if (isDeltaEvent(type)) {
          const delta = data.delta || data.chunk || data;
          let reasoningDelta = '';
          if (typeof delta === 'string') {
            if (data.isReasoning || data.type === 'reasoning') {
              reasoningDelta = delta;
            }
          } else if (delta && typeof delta === 'object') {
            if (delta.type === 'reasoning' || delta.kind === 'reasoning') {
              reasoningDelta = delta.text || delta.content || '';
            } else if (delta.reasoning_content) {
              reasoningDelta = delta.reasoning_content;
            }
          }
          if (reasoningDelta) {
            let currentRound = rounds.find(r => r.roundId === turnCount) || rounds[rounds.length - 1];
            if (!currentRound) {
              currentRound = {
                roundId: turnCount || 1,
                title: '第一次思考',
                blocks: [],
                tools: [],
                stats: { startTime: Date.now() },
                finalReply: ''
              };
              rounds.push(currentRound);
            }
            broadcastSSE('reasoning/delta', { roundId: currentRound.roundId, delta: reasoningDelta });
          }
        }

        // 捕获思考链生成与最终回复 (assistant/message)
        if (isMessageEvent(type) || type === 'assistant/message') {
          const usage = extractUsage(data);
          let currentRound = rounds.find(r => r.roundId === turnCount);
          if (!currentRound) {
            const roundTitle = turnCount <= 1 ? '第一次思考' : (turnCount === 2 ? '第二次思考' : `第 ${turnCount} 次思考`);
            currentRound = {
              roundId: turnCount || 1,
              title: roundTitle,
              blocks: [],
              tools: [],
              stats: { startTime: Date.now() },
              finalReply: ''
            };
            rounds.push(currentRound);
          }
          if (usage) {
            currentRound.stats = { ...(currentRound.stats || {}), ...usage };
          }

          const msg = data.message || {};
          const content = msg.content;
          if (Array.isArray(content)) {
            const textParts = content.filter(p => p && (p.type === 'text' || p.kind === 'text') && p.text);
            if (textParts.length > 0) {
              currentRound.finalReply = textParts.map(p => p.text).join('\n');
            }
            for (const part of content) {
              if (isReasoningPart(part)) {
                const newBlocks = parseThoughtIntoBlocks(part.text);
                currentBlocks = newBlocks;
                currentRound.blocks = newBlocks;
              }
            }
          }
          broadcastSSE('round/update', { round: currentRound });
        }
      } catch (err) {
        logger.error('Failed handling session/event', err);
      }
    }));

    // 5. 注册 Web 端静态路由与控制 API
    root.inject(['webServer'], (ctx) => {
      const server = ctx.webServer;
      if (!server || typeof server.register !== 'function') return;

      // 静态资源：thought-flow.js
      disposers.push(server.register({
        kind: 'exact',
        path: ROUTES.SCRIPT,
        handler(req, res) {
          try {
            const jsPath = path.join(PACKAGE_ROOT, 'assets', 'thought-flow.js');
            const content = fs.readFileSync(jsPath, 'utf8');
            res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
            res.end(content);
          } catch (err) {
            logger.error('Error serving thought-flow.js', err);
            res.statusCode = 404;
            res.end('Not found');
          }
        }
      }));

      // 静态资源：thought-flow.css
      disposers.push(server.register({
        kind: 'exact',
        path: ROUTES.STYLE,
        handler(req, res) {
          try {
            const cssPath = path.join(PACKAGE_ROOT, 'assets', 'thought-flow.css');
            const content = fs.readFileSync(cssPath, 'utf8');
            res.setHeader('Content-Type', 'text/css; charset=utf-8');
            res.end(content);
          } catch (err) {
            logger.error('Error serving thought-flow.css', err);
            res.statusCode = 404;
            res.end('Not found');
          }
        }
      }));

      // 实时同步接口：/dsh-thought-flow/sync
      disposers.push(server.register({
        kind: 'exact',
        path: ROUTES.SYNC,
        handler(req, res) {
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({
            ok: true,
            isPaused,
            isThinking,
            turnCount,
            rounds: rounds.length ? rounds : (currentBlocks.length ? [{ roundId: 1, title: '第一次思考', blocks: currentBlocks }] : []),
            blocks: currentBlocks,
            pendingInterventions,
            appliedInterventions
          }));
        }
      }));

      // 实时流式推送接口 (SSE)：/dsh-thought-flow/stream (Issue 1)
      disposers.push(server.register({
        kind: 'exact',
        path: ROUTES.STREAM,
        handler(req, res) {
          try {
            res.writeHead(200, {
              'Content-Type': 'text/event-stream; charset=utf-8',
              'Cache-Control': 'no-cache, no-transform',
              'Connection': 'keep-alive',
              'Access-Control-Allow-Origin': '*'
            });
            res.write(`event: init\ndata: ${JSON.stringify({
              turnCount,
              isThinking,
              isPaused,
              rounds: rounds.length ? rounds : (currentBlocks.length ? [{ roundId: 1, title: '第一次思考', blocks: currentBlocks, tools: [] }] : [])
            })}\n\n`);

            sseClients.add(res);
            req.on('close', () => {
              sseClients.delete(res);
            });
          } catch (err) {
            logger.error('Error in SSE stream handler', err);
            res.statusCode = 500;
            res.end();
          }
        }
      }));

      // 用户交互与干预接口：/dsh-thought-flow/action
      disposers.push(server.register({
        kind: 'exact',
        path: ROUTES.ACTION,
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
              let sessionAborted = false;

              if (payload.action === ACTIONS.PAUSE || payload.action === ACTIONS.INTERRUPT) {
                isPaused = true;
                sessionAborted = cancelActiveSession();
                broadcastSSE('action/pause', { isPaused: true, sessionAborted });
              } else if (payload.action === ACTIONS.RESUME) {
                isPaused = false;
                broadcastSSE('action/resume', { isPaused: false });
              } else if (payload.action === ACTIONS.OPINION) {
                const intervention = {
                  id: 'itv-' + Date.now(),
                  type: 'opinion',
                  text: payload.text,
                  ts: Date.now()
                };
                pendingInterventions.push(intervention);
                broadcastSSE('action/opinion', intervention);
              } else if (payload.action === ACTIONS.EDIT_BLOCK) {
                for (const r of rounds) {
                  const b = r.blocks.find(x => x.id === payload.blockId);
                  if (b) { b.content = payload.content; break; }
                }
                const target = currentBlocks.find(b => b.id === payload.blockId);
                if (target) {
                  target.content = payload.content;
                }
                broadcastSSE('action/edit_block', { blockId: payload.blockId, content: payload.content });
              } else if (payload.action === ACTIONS.CLEAR) {
                rounds = [];
                currentBlocks = [];
                turnCount = 0;
                pendingInterventions = [];
                broadcastSSE('action/clear', {});
              }
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.end(JSON.stringify({ ok: true, isPaused, sessionAborted }));
            } catch (err) {
              logger.error('Error handling action', err);
              res.statusCode = 400;
              res.end(JSON.stringify({ ok: false, error: err.message }));
            }
          });
        }
      }));

      // 诊断与健康监控接口：/dsh-thought-flow/status
      disposers.push(server.register({
        kind: 'exact',
        path: ROUTES.STATUS,
        handler(req, res) {
          const now = Date.now();
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({
            ok: true,
            version: '1.0.0',
            uptimeMs: now - startTime,
            stats: {
              turnCount,
              roundsCount: rounds.length,
              isThinking,
              isPaused,
              pendingInterventionsCount: pendingInterventions.length,
              appliedInterventionsCount: appliedInterventions.length,
              sseClients: sseClients.size
            },
            rounds: rounds.length,
            turnCount: turnCount,
            isPaused: isPaused,
            isThinking: isThinking,
            pendingInterventions: pendingInterventions.length,
            sseClients: sseClients.size,
            errors: logger.getRecentErrors(),
            recentErrors: logger.getRecentErrors(),
            logs: logger.getRecentLogs(),
            recentLogs: logger.getRecentLogs().slice(-20)
          }, null, 2));
        }
      }));
    });
  }
};
