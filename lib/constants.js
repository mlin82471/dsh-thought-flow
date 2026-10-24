/**
 * dsh-thought-flow 核心常量与协议定义
 */

export const EVENT_TYPES = {
  TURN_START: ['turn/start', 'turn.start', 'turn:start', 'start'],
  TURN_END: ['turn/end', 'turn.end', 'turn:end', 'finish', 'end'],
  MESSAGE: ['assistant/message', 'message', 'chat/message'],
  DELTA: ['assistant/delta', 'turn/delta', 'stream/delta', 'delta', 'content/delta'],
  TOOL_START: ['tool/start', 'tool.start', 'tool_start', 'tool/call', 'tool_call'],
  TOOL_END: ['tool/end', 'tool.end', 'tool_end', 'tool/result', 'tool_result']
};

export const REASONING_TYPES = ['reasoning', 'thought', 'thinking'];

export const ROUTES = {
  SCRIPT: '/dsh-thought-flow/thought-flow.js',
  STYLE: '/dsh-thought-flow/thought-flow.css',
  SYNC: '/dsh-thought-flow/sync',
  STREAM: '/dsh-thought-flow/stream',
  ACTION: '/dsh-thought-flow/action',
  STATUS: '/dsh-thought-flow/status',
  MEMORY: '/dsh-thought-flow/memory'
};

export const ACTIONS = {
  PAUSE: 'pause',
  RESUME: 'resume',
  INTERRUPT: 'interrupt',
  OPINION: 'opinion',
  REMOVE_OPINION: 'remove_opinion',
  EDIT_BLOCK: 'edit_block',
  CLEAR: 'clear'
};

export const DOM_PREFIX = '__dsh_tf__';

/** 记忆操作类型（对齐 Hermes 的 add / replace / remove） */
export const MEMORY_OPS = {
  ADD: 'add',
  REPLACE: 'replace',
  REMOVE: 'remove',
  CLEAR: 'clear',
  STATS: 'stats'
};

export const CHINESE_SECTION_NAME = 'thought-flow:chinese-constraint';
export const GUIDANCE_SECTION_NAME = 'thought-flow:user-guidance';
export const MEMORY_SECTION_NAME = 'thought-flow:memory';
export const CLARIFY_SECTION_NAME = 'thought-flow:clarify-policy';
export const FRAMEWORK_SECTION_NAME = 'thought-flow:thinking-framework';

export const THINK_STYLES = {
  DEEP_THINK: 'deep_think',
  RELATIONAL: 'relational'
};

export const THINK_EFFORTS = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high'
};

/**
 * 判断事件类型是否为回合开始
 */
export function isTurnStart(type) {
  if (!type || typeof type !== 'string') return false;
  return EVENT_TYPES.TURN_START.includes(type.toLowerCase());
}

/**
 * 判断事件类型是否为回合结束
 */
export function isTurnEnd(type) {
  if (!type || typeof type !== 'string') return false;
  return EVENT_TYPES.TURN_END.includes(type.toLowerCase());
}

/**
 * 判断事件类型是否为消息类事件
 */
export function isMessageEvent(type) {
  if (!type || typeof type !== 'string') return false;
  return EVENT_TYPES.MESSAGE.includes(type.toLowerCase());
}

/**
 * 判断消息内容片段是否为推理/思维链
 */
export function isReasoningPart(part) {
  if (!part || typeof part !== 'object') return false;
  const partType = (part.type || part.kind || '').toLowerCase();
  return REASONING_TYPES.includes(partType) && typeof part.text === 'string' && part.text.length > 0;
}

/**
 * 判断事件类型是否为流式增量事件
 */
export function isDeltaEvent(type) {
  if (!type || typeof type !== 'string') return false;
  return EVENT_TYPES.DELTA.includes(type.toLowerCase());
}

/**
 * 判断事件类型是否为工具调用启动
 */
export function isToolStart(type) {
  if (!type || typeof type !== 'string') return false;
  return EVENT_TYPES.TOOL_START.includes(type.toLowerCase());
}

/**
 * 判断事件类型是否为工具调用结束
 */
export function isToolEnd(type) {
  if (!type || typeof type !== 'string') return false;
  return EVENT_TYPES.TOOL_END.includes(type.toLowerCase());
}

/**
 * 尝试提取 token usage 信息
 */
export function extractUsage(data) {
  if (!data || typeof data !== 'object') return null;
  const usage = data.usage || data.tokenUsage || (data.message && data.message.usage);
  if (!usage || typeof usage !== 'object') return null;

  const promptTokens = usage.prompt_tokens ?? usage.promptTokens ?? 0;
  const completionTokens = usage.completion_tokens ?? usage.completionTokens ?? 0;
  const reasoningTokens = usage.reasoning_tokens ?? usage.reasoningTokens ?? (usage.completion_tokens_details && usage.completion_tokens_details.reasoning_tokens) ?? 0;
  const totalTokens = usage.total_tokens ?? usage.totalTokens ?? (promptTokens + completionTokens);

  return {
    promptTokens,
    completionTokens,
    reasoningTokens,
    totalTokens
  };
}
