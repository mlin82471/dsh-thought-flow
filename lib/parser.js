import {
  CHINESE_SECTION_NAME,
  GUIDANCE_SECTION_NAME,
  MEMORY_SECTION_NAME,
  CLARIFY_SECTION_NAME,
  FRAMEWORK_SECTION_NAME,
  THINK_STYLES,
  THINK_EFFORTS
} from './constants.js';

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
    // 两步清理：先去掉符号数序，再去掉中文分隔词（避免字符类误吃单字如"考"）
    const cleaned = content.split('\n')[0]
      .replace(/^[\s#*>\-`[\]0-9.、()（），,、:：，]+/, '')
      .replace(/^(Step|Phase|阶段|首先|然后|接着|再次|另外|最后|思考|\d+[、.]?|[一二三四五六七八九十]+[、.]?)\s*[:：]?\s*/i, '')
      .trim();
    const firstLine = cleaned;
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

/**
 * 注入 Hermes 风格的双层记忆快照。
 *
 * 关键设计：
 *   - 空快照不产生任何 section —— 没有记忆时零 token 开销
 *   - 快照文本由 MemoryStore 生成，格式稳定 => system prompt 前缀稳定 => prefix cache 可命中
 *   - 幂等：已存在的记忆节会先被移除再重建，避免多轮累积
 */
export function injectMemorySections(sections = [], snapshots = {}) {
  if (!Array.isArray(sections)) return sections;

  const memoryText = String(snapshots.memory || '').trim();
  const userText = String(snapshots.user || '').trim();

  // 一次性清掉所有记忆相关节（含 :user 后缀），保证更新而非累积
  const result = sections.filter(
    (s) => s && !String(s.name || '').startsWith(MEMORY_SECTION_NAME)
  );

  if (memoryText) {
    result.push({
      name: MEMORY_SECTION_NAME,
      order: 90,
      text: `【长期记忆 · 项目与经验】
以下是你此前积累的项目上下文、环境事实与踩坑经验。请直接当作已知前提使用，不要重复向用户确认：
${memoryText}`
    });
  }

  if (userText) {
    result.push({
      name: MEMORY_SECTION_NAME + ':user',
      order: 91,
      text: `【长期记忆 · 用户偏好】
以下记录该用户的稳定偏好与沟通习惯，请默认遵循（用户当轮明确指示优先）：
${userText}`
    });
  }

  return result;
}

/**
 * 注入任务前澄清策略。
 *
 * 参考两处实践：
 *   1. ChatGPT 的主动反问形式 —— 先澄清再执行
 *   2. Hermes 工作流规范 —— "最多提出两个必要问题，不为凑数提问"
 *
 * 核心是抑制过度提问：只在答案会改变实现方向时才问。
 */
export function injectClarifyPolicy(sections = [], enabled = true) {
  if (!Array.isArray(sections)) return sections;

  // 幂等：已注入过则跳过
  if (sections.some((s) => s && s.name === CLARIFY_SECTION_NAME)) return sections;
  if (!enabled) return sections;

  const result = [...sections];
  result.push({
    name: CLARIFY_SECTION_NAME,
    order: 95,
    text: `【任务澄清策略】
开始执行非平凡任务前，若存在会改变实现方向的关键歧义，先调用 ask_user_question 提出澄清问题，再动手。

必须提问的情况（命中任一）：
- 需求存在多种合理解读，且不同解读对应完全不同的实现路径
- 涉及删除、覆盖或迁移用户的已有数据
- 涉及不可逆操作、外部发布、付费或生产环境变更
- 交付物形态不明确（要文件还是代码，要方案还是直接改）

不要提问的情况：
- 答案能通过读代码、读文件、运行命令自行确认
- 用户已给出明确且完整的指令
- 只是实现细节的选择（自行选最合理方案，并在回复中说明所作假设即可）

提问要求：
- 一次最多问 2 个问题，不为凑数而提问
- 每个问题给出 2-3 个候选选项，把推荐项放第一个并标注"(推荐)"
- 提问前用一句话说明为什么需要这个信息`
  });

  return result;
}

/**
 * 注入结构化思考框架、思考风格与努力度指令。
 * 包含 6 步引导：重述目标 → 边界约束 → 关键信息 → 方案对比 → 不确定性 → 执行决策
 * 并根据选定的风格（深度分析/对话反思）与努力度（简要/标准/深度）动态调整推演重心与长度。
 */
export function injectThinkingFramework(sections = [], options = {}) {
  if (!Array.isArray(sections)) return sections;

  const style = options.style === THINK_STYLES.RELATIONAL ? THINK_STYLES.RELATIONAL : THINK_STYLES.DEEP_THINK;
  const effort = options.effort === THINK_EFFORTS.LOW ? THINK_EFFORTS.LOW : (options.effort === THINK_EFFORTS.HIGH ? THINK_EFFORTS.HIGH : THINK_EFFORTS.MEDIUM);

  // 幂等：先移除已有的框架节
  const result = sections.filter(s => s && s.name !== FRAMEWORK_SECTION_NAME);

  // 风格指南
  let styleGuidance = '';
  if (style === THINK_STYLES.RELATIONAL) {
    styleGuidance = `【思考风格 · 对话反思】\n- 重点站在用户视角推敲交互意图与隐性需求，多做反思与假设验证，注重沟通体验与渐进式交付。`;
  } else {
    styleGuidance = `【思考风格 · 深度分析】\n- 重点保持技术逻辑严谨，穷举边界条件与异常分支，从底层机制和因果推导进行技术论证。`;
  }

  // 努力度与长度约束
  let effortGuidance = '';
  if (effort === THINK_EFFORTS.LOW) {
    effortGuidance = `【思考努力度 · 简要 (≤500字)】\n- 快速聚焦关键决策与动作，避免冗长展开，精简推理过程，直奔落地。`;
  } else if (effort === THINK_EFFORTS.HIGH) {
    effortGuidance = `【思考努力度 · 深度 (1000-2000字)】\n- 展开长程严密推演，做全量代码沙盘推演与穷尽验证，详尽论证每一步的技术合理性与风险。`;
  } else {
    effortGuidance = `【思考努力度 · 标准 (500-1000字)】\n- 保持深度与速度的平衡，步骤完备、论证清晰、脉络结构完整。`;
  }

  const text = `【结构化思考框架 (6 步推演引导)】
在给出最终回答或调用工具之前，请在思维链（Reasoning）中按以下步骤推进推演：
1. 【重述目标】：用自己的一句话准确重构用户的核心意图与交付标准。
2. 【边界约束】：盘点技术边界、环境事实、硬性限制与禁止事项。
3. 【关键信息】：梳理已知事实、代码/数据上下文与待探明盲区。
4. 【方案对比】：列出可行路径并对比权衡利弊与复杂度。
5. 【不确定性】：明确潜在风险、回退路径与边缘极端情况。
6. 【执行决策】：收敛确定最终行动计划与分步落地策略。

${styleGuidance}

${effortGuidance}`;

  result.push({
    name: FRAMEWORK_SECTION_NAME,
    order: 15,
    text
  });

  return result;
}
