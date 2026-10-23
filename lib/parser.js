import { CHINESE_SECTION_NAME, GUIDANCE_SECTION_NAME } from './constants.js';

/**
 * 解析模型思维链并拆分为由浅入深的步骤方块
 * 支持中文序号、数字序号、英文 Step/Phase 标识、多段落与单长段落平滑切块
 */
export function parseThoughtIntoBlocks(rawText) {
  if (!rawText || typeof rawText !== 'string') return [];
  const text = rawText.trim();
  if (!text) return [];

  // 1. 结构化序号模式匹配 (支持行首 ^ 或换行后 \n+，兼顾中英文常见序号)
  const pattern = /(?:^|\n+)(?:(?:[0-9]{1,2}[.、)）\s]|[一二三四五六七八九十]+[、.]|[（(][0-9]{1,2}[)）]|Step\s*[0-9]+[:：]?|Phase\s*[0-9]+[:：]?|阶段\s*[0-9一二三四五]+[:：]?|首先[，,、\s]?|然后[，,、\s]?|接着[，,、\s]?|再次[，,、\s]?|另外[，,、\s]?|最后[，,、\s]?|思考[0-9一二三四五]*[:：]?)\s*)/gi;

  let splits = [];
  let match;
  let lastIndex = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const seg = text.slice(lastIndex, match.index).trim();
      if (seg) splits.push(seg);
    }
    lastIndex = match.index;
  }
  if (lastIndex < text.length) {
    const seg = text.slice(lastIndex).trim();
    if (seg) splits.push(seg);
  }

  // 2. 兜底策略 1：如果没匹配到序号，尝试双换行或单换行段落拆分
  if (splits.length <= 1) {
    const paragraphs = text.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
    if (paragraphs.length > 1) {
      splits = paragraphs;
    } else {
      const singleLines = text.split(/\n+/).map(p => p.trim()).filter(Boolean);
      if (singleLines.length > 1) {
        splits = singleLines;
      }
    }
  }

  // 3. 兜底策略 2：单一大长段落（无换行或仅单行），按中英文句子切块（每 120-180 字平滑聚合）
  if (splits.length <= 1) {
    const sentences = text.split(/(?<=[。！？!?\n])\s*/);
    let cur = '';
    splits = [];
    for (const s of sentences) {
      cur += s;
      if (cur.length >= 120) {
        splits.push(cur.trim());
        cur = '';
      }
    }
    if (cur.trim()) {
      splits.push(cur.trim());
    }
  }

  // 兜底策略 3：纯英文无标点长文本保护
  if (splits.length === 0) {
    splits = [text];
  }

  return splits.map((content, idx) => {
    // 提炼简明标题：去除前缀符号、markdown 标识与标点，取第一行精粹
    const firstLine = content.split('\n')[0]
      .replace(/^[\s#*>\-`[0-9一二三四五六七八九十.、()（）StepPhase阶段首先然后接着再次另外最后思考:：]+/, '')
      .trim();
    const title = (firstLine ? firstLine.slice(0, 24) : `思考节点 #${idx + 1}`);

    return {
      id: `block-${idx + 1}`,
      step: idx + 1,
      title: title || `思考节点 #${idx + 1}`,
      content: content,
      timestamp: Date.now()
    };
  });
}

/**
 * 注入强制中文思维链与回复的系统指令（幂等防重）
 */
export function enforceChineseRule(sections = []) {
  if (!Array.isArray(sections)) return sections;

  // 检查是否已有该节，若存在则直接返回原数组，杜绝多轮累积膨胀
  if (sections.some(s => s && s.name === CHINESE_SECTION_NAME)) {
    return sections;
  }

  const result = [...sections];
  const chineseDirective = {
    name: CHINESE_SECTION_NAME,
    order: 10,
    text: `【强制语言规范】\n1. 你的所有思考链过程（Thinking / Reasoning Process）必须且只能使用简体中文表达与推演，严禁在思考过程中夹杂无必要的英文词汇或通篇英文思考。\n2. 保持逻辑结构清晰、条理分明，善于分步规划并明确分块推导。`
  };
  result.push(chineseDirective);
  return result;
}

/**
 * 将用户介入指导意见注入系统提示词中
 */
export function injectUserGuidance(sections = [], pendingInterventions = []) {
  if (!Array.isArray(sections)) return sections;
  if (!Array.isArray(pendingInterventions) || pendingInterventions.length === 0) {
    return sections;
  }

  // 移除旧的同名节，更新为最新的组合指令
  const result = sections.filter(s => s && s.name !== GUIDANCE_SECTION_NAME);
  const guidanceTexts = pendingInterventions
    .map((item, idx) => `${idx + 1}. ${item.text || item}`)
    .join('\n');

  result.push({
    name: GUIDANCE_SECTION_NAME,
    order: 99,
    text: `【用户即时指导介入】\n用户在刚才的思考过程中提供了以下关键指导与纠偏要求，请在后续推演和生成中严格遵循：\n${guidanceTexts}`
  });

  return result;
}
