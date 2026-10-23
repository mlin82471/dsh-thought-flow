/**
 * 解析模型思维链并拆分为由浅入深的步骤方块
 */
export function parseThoughtIntoBlocks(rawText) {
  if (!rawText || typeof rawText !== 'string') return [];
  const text = rawText.trim();
  if (!text) return [];

  // 1. 如果有明确的序号 (1. / 一、/ Step 1 / 首先、然后、接着、最后等)
  const pattern = /(?:^|\n+)(?:(?:[0-9]{1,2}[.、\s]|[一二三四五六七八九十]+[、.]|Step\s*[0-9]+[:：]?|阶段\s*[0-9一二三四五]+[:：]?|首先[，,、]?|然后[，,、]?|接着[，,、]?|再次[，,、]?|另外[，,、]?|最后[，,、]?|思考[0-9一二三四五]*[:：]?)\s*)/g;

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

  // 兜底：如果没匹配到序号，按连续换行双回车拆分，或长段落拆分
  if (splits.length <= 1) {
    const paragraphs = text.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
    if (paragraphs.length > 1) {
      splits = paragraphs;
    } else {
      // 单长段落，按句子句号切块（每 150-200 字一段）
      const sentences = text.split(/(?<=[。！？\n])/);
      let cur = '';
      splits = [];
      for (const s of sentences) {
        cur += s;
        if (cur.length >= 120) {
          splits.push(cur.trim());
          cur = '';
        }
      }
      if (cur.trim()) splits.push(cur.trim());
    }
  }

  return splits.map((content, idx) => {
    // 提炼简明标题
    const firstLine = content.split('\n')[0].replace(/^[^a-zA-Z0-9\u4e00-\u9fa5]+/, '').slice(0, 24);
    const title = firstLine || `思考节点 #${idx + 1}`;
    return {
      id: `block-${idx + 1}`,
      step: idx + 1,
      title: title,
      content: content,
      timestamp: Date.now()
    };
  });
}

/**
 * 注入强制中文思维链与回复的系统指令
 */
export function enforceChineseRule(sections = []) {
  const result = [...sections];
  const chineseDirective = {
    name: 'thought-flow:chinese-constraint',
    order: 10,
    text: `【强制语言规范】
1. 你的所有思考链过程（Thinking / Reasoning Process）必须且只能使用简体中文表达与推演，严禁在思考过程中夹杂无必要的英文词汇或通篇英文思考。
2. 保持逻辑结构清晰、条理分明，善于分步规划并明确分块推导。`
  };
  result.push(chineseDirective);
  return result;
}
