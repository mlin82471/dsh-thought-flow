/**
 * dsh-thought-flow 记忆系统
 *
 * 参考 Hermes Agent (Nous Research) 的双层冻结快照设计：
 *   - MEMORY.md : Agent 自己的项目笔记 / 环境事实 / 踩坑经验  (2200 字符上限)
 *   - USER.md   : 用户偏好 / 沟通习惯                        (1375 字符上限)
 *
 * 省 token 的四个机制：
 *   1. 硬性字符上限 —— 有界记忆本身就是压缩，迫使主动策展而非无限堆砌
 *   2. 条目顺序 + 格式稳定 —— system prompt 前缀不变，prefix cache 才能命中
 *   3. 记忆为空时完全不注入 —— 零 token 开销
 *   4. 快照头部显示使用率 —— 让模型知道还剩多少空间，主动合并旧条目
 */

import fs from 'node:fs';
import path from 'node:path';

/** 各记忆文件的硬性字符上限（对齐 Hermes Agent 的实测值） */
export const MEMORY_LIMITS = {
  memory: 2200,
  user: 1375
};

/** 条目分隔符，与 Hermes 一致使用分节号 */
export const MEMORY_DELIMITER = '\n§\n';

function labelOf(target) {
  return target === 'user' ? 'USER (about the user)' : 'MEMORY (your personal notes)';
}

export class MemoryStore {
  constructor(baseDir) {
    this.baseDir = baseDir;
    this.paths = {
      memory: path.join(baseDir, 'MEMORY.md'),
      user: path.join(baseDir, 'USER.md')
    };
  }

  ensureDir() {
    try {
      fs.mkdirSync(this.baseDir, { recursive: true });
    } catch (err) {
      // 目录创建失败时不阻断主流程
    }
  }

  readRaw(target) {
    try {
      return fs.readFileSync(this.paths[target], 'utf8');
    } catch (err) {
      return '';
    }
  }

  /** 按 § 分隔符切分为条目数组 */
  parseEntries(target) {
    const raw = this.readRaw(target);
    if (!raw || !raw.trim()) return [];
    return raw
      .split(/\n\s*§\s*\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  writeEntries(target, entries) {
    this.ensureDir();
    const body = entries.length ? entries.join(MEMORY_DELIMITER) + '\n' : '';
    fs.writeFileSync(this.paths[target], body, 'utf8');
  }

  /** 用量统计 */
  usage(target) {
    const entries = this.parseEntries(target);
    const body = entries.join(MEMORY_DELIMITER);
    const limit = MEMORY_LIMITS[target];
    return {
      target,
      entries,
      count: entries.length,
      used: body.length,
      limit,
      percent: limit > 0 ? Math.round((body.length / limit) * 100) : 0,
      remaining: Math.max(0, limit - body.length)
    };
  }

  /**
   * 生成注入 system prompt 的快照文本。
   * 空记忆返回空字符串 —— 调用方据此跳过注入，实现零开销。
   */
  renderSnapshot(target) {
    const u = this.usage(target);
    if (!u.entries.length) return '';
    const bar = '═'.repeat(46);
    return [
      bar,
      labelOf(target) + ' [' + u.percent + '% — ' + u.used + '/' + u.limit + ' chars]',
      bar,
      u.entries.join(MEMORY_DELIMITER)
    ].join('\n');
  }

  /** 追加一条新记忆（超限时返回可诊断信息，不静默丢弃） */
  add(target, text) {
    const clean = String(text || '').trim();
    if (!clean) return { ok: false, error: 'empty entry' };

    const entries = this.parseEntries(target);
    const limit = MEMORY_LIMITS[target];
    const candidate = [...entries, clean].join(MEMORY_DELIMITER);

    if (candidate.length > limit) {
      return {
        ok: false,
        error: 'limit exceeded',
        used: candidate.length,
        limit,
        over: candidate.length - limit,
        entries,
        hint: '请先用 replace 合并或 remove 删除旧条目，再添加新条目'
      };
    }

    entries.push(clean);
    this.writeEntries(target, entries);
    return { ok: true, used: candidate.length, limit, count: entries.length };
  }

  /** 子串匹配替换（与 Hermes 的 replace 语义一致） */
  replace(target, substring, newText) {
    const needle = String(substring || '').trim();
    if (!needle) return { ok: false, error: 'empty match substring' };

    const entries = this.parseEntries(target);
    const idx = entries.findIndex((e) => e.includes(needle));
    if (idx === -1) return { ok: false, error: 'substring not found' };

    const next = [...entries];
    const previous = next[idx];
    next[idx] = String(newText || '').trim();

    const joined = next.join(MEMORY_DELIMITER);
    if (joined.length > MEMORY_LIMITS[target]) {
      return { ok: false, error: 'limit exceeded', used: joined.length, limit: MEMORY_LIMITS[target] };
    }

    this.writeEntries(target, next);
    return { ok: true, previous, used: joined.length, count: next.length };
  }

  /** 子串匹配删除 */
  remove(target, substring) {
    const needle = String(substring || '').trim();
    if (!needle) return { ok: false, error: 'empty match substring' };

    const entries = this.parseEntries(target);
    const idx = entries.findIndex((e) => e.includes(needle));
    if (idx === -1) return { ok: false, error: 'substring not found' };

    const removed = entries[idx];
    entries.splice(idx, 1);
    this.writeEntries(target, entries);
    return { ok: true, removed, count: entries.length };
  }

  clear(target) {
    this.writeEntries(target, []);
    return { ok: true, count: 0 };
  }

  stats() {
    return {
      memory: this.usage('memory'),
      user: this.usage('user')
    };
  }
}
