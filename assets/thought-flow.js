(function () {
  if (window.__dshThoughtFlowLoaded) return;
  window.__dshThoughtFlowLoaded = true;

  // 动态引入样式
  var link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/dsh-thought-flow/thought-flow.css';
  document.head.appendChild(link);

  var STORAGE_KEY = '__dsh_thought_flow_state_v1__';

  var lastDeltaContent = '';
  var state = {
    rounds: [],
    activeRoundIndex: 0,
    isPaused: false,
    editingBlockId: null,
    thinkStyle: 'deep_think',
    thinkEffort: 'medium'
  };

  // 持久化存储与恢复 (Issue 7)
  function loadPersistedState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          if (Array.isArray(parsed.rounds)) state.rounds = parsed.rounds;
          if (typeof parsed.activeRoundIndex === 'number') state.activeRoundIndex = parsed.activeRoundIndex;
          if (typeof parsed.isPaused === 'boolean') state.isPaused = parsed.isPaused;
          if (typeof parsed.thinkStyle === 'string') state.thinkStyle = parsed.thinkStyle;
          if (typeof parsed.thinkEffort === 'string') state.thinkEffort = parsed.thinkEffort;
        }
      }
    } catch (e) {
      console.warn('[dsh-tf] Failed to load localStorage state', e);
    }
  }

  var saveTimer = null;
  function saveState() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          rounds: state.rounds,
          activeRoundIndex: state.activeRoundIndex,
          isPaused: state.isPaused,
          thinkStyle: state.thinkStyle || 'deep_think',
          thinkEffort: state.thinkEffort || 'medium',
          savedAt: Date.now()
        }));
      } catch (e) {}
    }, 300);
  }

  loadPersistedState();

  // 创建 DOM 容器
  var root = document.createElement('div');
  root.id = '__dsh_tf__root';
  root.className = 'tf-plugin-root';
  document.body.appendChild(root);

  // 1. 悬浮胶囊控制条 (默认隐藏)
  var floatBar = document.createElement('div');
  floatBar.id = '__dsh_tf__float_bar';
  floatBar.className = 'tf-float-bar';
  floatBar.style.display = 'none';
  floatBar.innerHTML = `
    <div class="tf-pulse-dot"></div>
    <span style="font-size: 13px; font-weight: 600;">思维流</span>
    <span class="tf-round-indicator" id="__dsh_tf__indicator">准备就绪</span>
    <button class="tf-memory-btn" id="__dsh_tf__btn_memory" title="长期记忆管理">🧠</button>
  `;
  
  root.appendChild(floatBar);

  // ── 全屏产物 Overlay ──
  var artifactOverlay = document.createElement('div');
  artifactOverlay.id = '__dsh_tf__artifact_overlay';
  artifactOverlay.innerHTML = [
    '<div class="tf-overlay-card">',
    '  <div class="tf-overlay-header">',
    '    <span class="tf-overlay-title" id="__dsh_tf__overlay_title">📦 结果</span>',
    '    <button class="tf-overlay-close">关闭</button>',
    '  </div>',
    '  <pre class="tf-overlay-body" id="__dsh_tf__overlay_body"></pre>',
    '</div>'
  ].join('\n');
  root.appendChild(artifactOverlay);
  artifactOverlay.querySelector('.tf-overlay-close').addEventListener('click', function () {
    artifactOverlay.classList.remove('tf-overlay-open');
  });
  artifactOverlay.addEventListener('click', function (e) {
    if (e.target === artifactOverlay) artifactOverlay.classList.remove('tf-overlay-open');
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && artifactOverlay.classList.contains('tf-overlay-open')) {
      artifactOverlay.classList.remove('tf-overlay-open');
    }
  });

  // ── 侧边产物面板与遮罩 ──
  var sidebarBackdrop = document.createElement('div');
  sidebarBackdrop.id = '__dsh_tf__sidebar_backdrop';
  root.appendChild(sidebarBackdrop);

  var artifactSidebar = document.createElement('div');
  artifactSidebar.id = '__dsh_tf__artifact_sidebar';
  artifactSidebar.innerHTML = [
    '<div class="tf-sidebar-header">',
    '  <div class="tf-sidebar-tabs" id="__dsh_tf__sidebar_tabs"></div>',
    '  <button class="tf-sidebar-close" id="__dsh_tf__btn_sidebar_close" title="关闭侧边栏">✕ 关闭</button>',
    '</div>',
    '<pre class="tf-sidebar-body" id="__dsh_tf__sidebar_body"></pre>'
  ].join('\n');
  root.appendChild(artifactSidebar);

  function closeArtifactSidebar() {
    artifactSidebar.classList.remove('tf-sidebar-open');
    sidebarBackdrop.classList.remove('tf-backdrop-open');
  }

  sidebarBackdrop.addEventListener('click', closeArtifactSidebar);
  var btnSbClose = artifactSidebar.querySelector('#__dsh_tf__btn_sidebar_close');
  if (btnSbClose) {
    btnSbClose.addEventListener('click', function (e) {
      e.stopPropagation();
      closeArtifactSidebar();
    });
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (artifactSidebar.classList.contains('tf-sidebar-open')) {
        closeArtifactSidebar();
      }
      var overlay = document.getElementById('__dsh_tf__artifact_overlay');
      if (overlay && overlay.classList.contains('tf-overlay-open')) {
        overlay.classList.remove('tf-overlay-open');
      }
    }
  });

  // 全局工具缓存（跨卡片共享，用于 Tab 切换）
  var allToolResults = [];

  function openToolInSidebar(tool, cardEl) {
    allToolResults.push({ tool: tool, card: cardEl || null });
    // 去重
    var seen = {};
    allToolResults = allToolResults.filter(function (x) {
      var key = x.tool.id || x.tool.name;
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });
    renderSidebarTabs();
    var idx = allToolResults.length - 1;
    switchSidebarTab(idx);
    artifactSidebar.classList.add('tf-sidebar-open');
    sidebarBackdrop.classList.add('tf-backdrop-open');
  }

  function renderSidebarTabs() {
    var tabsEl = document.getElementById('__dsh_tf__sidebar_tabs');
    if (!tabsEl) return;
    tabsEl.innerHTML = allToolResults.map(function (x, i) {
      return '<button class="tf-sidebar-tab" data-tf-sb-idx="' + i + '">⚡ ' + escapeHtml(x.tool.name || '工单' + (i+1)) + '</button>';
    }).join('');
    tabsEl.querySelectorAll('.tf-sidebar-tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        switchSidebarTab(parseInt(this.getAttribute('data-tf-sb-idx') || 0));
      });
    });
  }

  function switchSidebarTab(idx) {
    var body = document.getElementById('__dsh_tf__sidebar_body');
    var tabs = document.querySelectorAll('#__dsh_tf__sidebar_tabs .tf-sidebar-tab');
    tabs.forEach(function (t, i) { t.classList.toggle('active', i === idx); });
    var item = allToolResults[idx];
    if (body && item) {
      body.textContent = typeof item.tool.result === 'string' ? item.tool.result : safeStringify(item.tool.result || item.tool.error || '');
    }
  }
  var indicatorEl = floatBar.querySelector('#__dsh_tf__indicator');

  // 2. 抽屉面板 (默认隐藏)
  // =========================================================================
  // 原生接管：把官方 reasoning 块就地替换为精致的 Thought Flow 磨砂卡片
  // =========================================================================

  function buildInlineCard(round, isRunning, roundNum) {
    var card = document.createElement('div');
    card.className = 'tf-inline-card';
    card.setAttribute('data-tf-mounted', 'true');
    card.setAttribute('data-round-id', String((round && round.roundId) || roundNum || 1));
    card.setAttribute('data-expanded', isRunning ? 'true' : 'false');

    // 从全局 state 读取当前风格/努力度
    var styleLabel = (state.thinkStyle === 'relational') ? '对话反思' : '深度分析';
    var effortLabels = { low: '简要', medium: '标准', high: '深度' };
    var effortLabel = effortLabels[state.thinkEffort] || '标准';

    card.innerHTML = [
      '<div class="tf-inline-header">',
      '  <div class="tf-inline-title-group">',
      '    <div class="tf-pulse-dot ' + (isRunning ? 'running' : 'done') + '"></div>',
      '    <div class="tf-inline-title"><span>思考过程</span></div>',
      '    <div class="tf-inline-summary">推演准备就绪...</div>',
      '  </div>',
      '  <div class="tf-inline-meta">',
      '    <span class="tf-inline-badge tf-badge-style">' + styleLabel + '</span>',
      '    <span class="tf-inline-badge tf-badge-effort">' + effortLabel + '</span>',
      '    <button class="tf-inline-stop-btn" title="停止思考">⏹ 停止</button>',
      '    <span class="tf-inline-tag">' + (isRunning ? '推演中' : '完成') + '</span>',
      '    <svg class="tf-inline-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"></polyline></svg>',
      '  </div>',
      '</div>',
      '<div class="tf-inline-body">',
      '  <div class="tf-inline-tools-wrap"></div>',
      '  <div class="tf-inline-steps-wrap"></div>',
      '  <div class="tf-inline-intervene">',
      '    <textarea class="tf-inline-intervene-input" placeholder="补充指导意见，回车发送… (将在下轮自动注入模型提示词)" rows="1"></textarea>',
      '    <button class="tf-inline-intervene-send">发送</button>',
      '    <label class="tf-inline-save-mem"><input type="checkbox" class="tf-inline-save-chk"> 💾 存为记忆</label>',
      '  </div>',
      '  <div class="tf-pending-guidance-list"></div>',
      '  <div class="tf-inline-footer">',
      '    <div class="tf-inline-stats">',
      '      <span class="tf-stat-tok">🧠 0</span>',
      '      <span class="tf-stat-dur">⏱ 0.0 秒</span>',
      '    </div>',
      '    <div style="display: flex; align-items: center; gap: 10px; justify-content: space-between;">' +
      '      <span style="font-size: 11px; opacity: 0.65;">点击文字可就地修改思考步骤</span>' +
      '      <button class="tf-copy-think-btn" title="导出思考为 Markdown 文件">📋 导出 MD</button>' +
      '    </div>',
      '  </div>',
      '</div>'
    ].join('\n');

    var header = card.querySelector('.tf-inline-header');
    header.addEventListener('click', function (e) {
      if (e.target.closest('.tf-inline-stop-btn') || e.target.closest('.tf-inline-badge')) return;
      e.stopPropagation();
      var isExp = card.getAttribute('data-expanded') === 'true';
      card.setAttribute('data-expanded', !isExp ? 'true' : 'false');
    });

    // 停止按钮
    var stopBtn = card.querySelector('.tf-inline-stop-btn');
    if (stopBtn) {
      stopBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        var selectors = ['button[aria-label*="停止"]', 'button[aria-label*="Stop"]', '[data-action="stop"]'];
        for (var i = 0; i < selectors.length; i++) {
          var nb = document.querySelector(selectors[i]);
          if (nb && typeof nb.click === 'function') { try { nb.click(); } catch (ex) {} break; }
        }
        fetch('/dsh-thought-flow/action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'pause' })
        }).catch(function () {});
      });
    }

    // 补充指导 + 存记忆与待注入列表渲染
    var inputEl = card.querySelector('.tf-inline-intervene-input');
    var sendEl = card.querySelector('.tf-inline-intervene-send');
    var pendingListEl = card.querySelector('.tf-pending-guidance-list');

    function renderPendingGuidance(items) {
      if (!pendingListEl) return;
      pendingListEl.innerHTML = '';
      if (!Array.isArray(items) || !items.length) return;
      items.forEach(function (itm) {
        var el = document.createElement('div');
        el.className = 'tf-pending-guidance-item';
        el.innerHTML = [
          '<span class="tf-pending-badge">📌 待注入指导</span>',
          '<span class="tf-pending-text" title="' + escapeHtml(itm.text || '') + '">' + escapeHtml(itm.text || '') + '</span>',
          '<button class="tf-pending-del-btn" title="撤回此条意见">✕</button>'
        ].join('');
        el.querySelector('.tf-pending-del-btn').addEventListener('click', function (e) {
          e.stopPropagation();
          fetch('/dsh-thought-flow/action', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'remove_opinion', id: itm.id })
          }).then(function (r) { return r.json(); }).then(function (data) {
            renderPendingGuidance(data.pendingInterventions || []);
          }).catch(function () {});
        });
        pendingListEl.appendChild(el);
      });
    }

    if (inputEl && sendEl) {
      function doIntervene() {
        var val = inputEl.value.trim();
        if (!val) return;
        var saveChk = card.querySelector('.tf-inline-save-chk');
        if (saveChk && saveChk.checked) {
          fetch('/dsh-thought-flow/memory', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ op: 'add', target: 'memory', text: val })
          }).catch(function () {});
          saveChk.checked = false;
        }
        sendEl.disabled = true;
        sendEl.textContent = '发送中…';
        fetch('/dsh-thought-flow/action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'opinion', text: val })
        }).then(function (res) {
          return res.json();
        }).then(function (data) {
          inputEl.value = '';
          sendEl.disabled = false;
          sendEl.textContent = '✅ 已就绪';
          setTimeout(function () { sendEl.textContent = '发送'; }, 1800);
          if (data && Array.isArray(data.pendingInterventions)) {
            renderPendingGuidance(data.pendingInterventions);
          }
        }).catch(function () {
          sendEl.disabled = false;
          sendEl.textContent = '❌ 失败';
          setTimeout(function () { sendEl.textContent = '发送'; }, 1800);
        });
      }
      sendEl.addEventListener('click', function (e) { e.stopPropagation(); doIntervene(); });
      inputEl.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doIntervene(); }
      });
    }

    // 显隐：运行中显示停止按钮，结束后显示意见区
    var sBtn = card.querySelector('.tf-inline-stop-btn');
    var iBlock = card.querySelector('.tf-inline-intervene');
    if (sBtn) sBtn.style.display = isRunning ? '' : 'none';
    if (iBlock) iBlock.style.display = isRunning ? 'none' : '';

    // 复制/导出思考
  var copyThinkBtn = card.querySelector('.tf-copy-think-btn');
  if (copyThinkBtn) {
    copyThinkBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      var rid = card.getAttribute('data-round-id') || '1';
      
      // 收集思考步骤
      var lines = ['# 思考记录 · 第 ' + rid + ' 轮', ''];
      var steps = card.querySelectorAll('.tf-step-block');
      steps.forEach(function (step, i) {
        var titleEl = step.querySelector('.tf-step-num');
        var contentEl = step.querySelector('.tf-step-content');
        var title = (titleEl && titleEl.textContent) ? titleEl.textContent.trim() : ('步骤 ' + (i+1));
        var content = (contentEl && contentEl.textContent) ? contentEl.textContent.trim() : '';
        lines.push('## ' + title);
        lines.push('');
        lines.push(content);
        lines.push('');
      });

      // 收集工具调用
      var tools = card.querySelectorAll('.tf-tool-item');
      if (tools.length > 0) {
        lines.push('---');
        lines.push('## 工具调用');
        lines.push('');
        tools.forEach(function (tool, i) {
          var nameEl = tool.querySelector('.tf-tool-name');
          var name = (nameEl && nameEl.textContent) ? nameEl.textContent.trim() : ('工具 ' + (i+1));
          var codeEl = tool.querySelector('.tf-artifact-body code');
          var result = (codeEl && codeEl.textContent) ? codeEl.textContent.trim() : '';
          lines.push('### ' + name);
          lines.push('');
          if (result) {
            lines.push('```');
            lines.push(result.slice(0, 3000));
            lines.push('```');
            lines.push('');
          }
        });
      }

      var full = lines.join('\n');
      
      // 下载为 .md 文件
      var blob = new Blob([full], { type: 'text/markdown;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = '思考-第' + rid + '轮.md';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      // 同时入剪贴板
      if (navigator.clipboard) {
        navigator.clipboard.writeText(full).then(function () {}).catch(function () {});
      }
      copyThinkBtn.textContent = '✅ 已导出';
      setTimeout(function () { copyThinkBtn.textContent = '📋 导出 MD'; }, 1800);
    });
  }

  if (round) updateCardView(card, round, isRunning);
  return card;
}


  // 检测产物类型
  function detectResultType(text) {
    if (!text || typeof text !== 'string') return 'text';
    var trimmed = text.trim();
    try { JSON.parse(trimmed); return 'json'; } catch (e) {}
    if (/(function|class|const|let|var|import|export|return|async|await)/.test(trimmed)) return 'code';
    if (/(error|Error|exception|Exception|failed|Failed)/.test(trimmed)) return 'error';
    return 'text';
  }
// 增量渲染：检测到新的思考步骤分隔符时实时追加到卡片
  var _lastIncBlockCount = 0;
  
  // ── 思考块解析器（浏览器内联版） ──
  function parseThoughtIntoBlocks(text) {
    if (!text || typeof text !== 'string') return [];
    var t = text.trim();
    if (!t) return [];

    var pattern = /(?:^|[\n。！？!?])(?:(?:[0-9]{1,2}[.、\)）\s]|[一二三四五六七八九十]+[.、]|[（\(][0-9]{1,2}[\)）]|Step\s*[0-9]+[:：]?|Phase\s*[0-9]+[:：]?|阶段\s*[0-9一二三四五]+[:：]?|首先[，,、\s]?|然后[，,、\s]?|接着[，,、\s]?|再次[，,、\s]?|另外[，,、\s]?|最后[，,、\s]?|思考[0-9一二三四五]*[:：]?)\s*)/gi;

    var splits = [];
    var match, lastIdx = 0;
    while ((match = pattern.exec(t)) !== null) {
      if (match.index > lastIdx) { var seg = t.slice(lastIdx, match.index).trim(); if (seg) splits.push(seg); }
      lastIdx = match.index;
    }
    if (lastIdx < t.length) { var seg = t.slice(lastIdx).trim(); if (seg) splits.push(seg); }

    // 兜底：双换行/单换行拆分
    if (splits.length <= 1) {
      var paras = t.split(/\n{2,}/).map(function(p){return p.trim();}).filter(Boolean);
      if (paras.length > 1) { splits = paras; }
      else {
        var lines = t.split(/\n+/).map(function(p){return p.trim();}).filter(Boolean);
        if (lines.length > 1) { splits = lines; }
      }
    }
    // 兜底：单段长文本按句子切 120 字
    if (splits.length <= 1) {
      var sents = t.split(/(?<=[。！？!?\n])\s*/);
      var cur = ''; splits = [];
      for (var si = 0; si < sents.length; si++) { cur += sents[si]; if (cur.length >= 120) { splits.push(cur.trim()); cur = ''; } }
      if (cur.trim()) splits.push(cur.trim());
    }
    if (splits.length === 0) splits = [t];

    return splits.map(function(content, idx) {
      var cleaned = content.split('\n')[0]
        .replace(/^[\s#*>\-`[\]0-9.、()（），,、:：，]+/, '')
        .replace(/^(Step|Phase|阶段|首先|然后|接着|再次|另外|最后|思考|\d+[、.]?|[一二三四五六七八九十]+[、.]?)\s*[:：]?\s*/i, '')
        .trim();
      return { id: 'block-' + (idx+1), step: idx+1, title: cleaned.slice(0, 24) || ('步骤' + (idx+1)), content: content };
    });
  }

  function tryIncrementalRender(newChunk) {
    var card = document.querySelector('.tf-inline-card[data-expanded="true"]');
    if (!card) return;
    var stepsWrap = card.querySelector('.tf-inline-steps-wrap');
    if (!stepsWrap) return;
    var allBlocks = parseThoughtIntoBlocks(lastDeltaContent);

    // 更新已有块的内容（内容增长时实时反映）
    var existingSteps = stepsWrap.querySelectorAll('.tf-step-content');
    for (var j = 0; j < Math.min(existingSteps.length, allBlocks.length); j++) {
      if (allBlocks[j].content) existingSteps[j].textContent = allBlocks[j].content;
    }

    // 追加新增的块
    if (allBlocks.length > _lastIncBlockCount) {
      for (var i = _lastIncBlockCount; i < allBlocks.length; i++) {
        var b = allBlocks[i];
        var stepDiv = document.createElement('div');
        stepDiv.className = 'tf-step-block';
        var label = escapeHtml(b.title || ('步骤 ' + (i + 1)));
        stepDiv.innerHTML = [
          '<div class="tf-step-num">' + label + '</div>',
          '<div class="tf-step-content" contenteditable="true">' + escapeHtml(b.content || '') + '</div>',
          '<button class="tf-step-copy-btn">复制</button>'
        ].join('\n');
        // 复制按钮事件
        var cb = stepDiv.querySelector('.tf-step-copy-btn');
        if (cb) {
          cb.addEventListener('click', function (e2) {
            e2.stopPropagation();
            var ct = this.parentNode.querySelector('.tf-step-content');
            if (ct && navigator.clipboard) {
              navigator.clipboard.writeText(ct.textContent).then(function () {
                cb.textContent = '已复制';
                setTimeout(function () { cb.textContent = '复制'; }, 1200);
              }).catch(function () {});
            }
          });
        }
        stepsWrap.appendChild(stepDiv);
      }
      _lastIncBlockCount = allBlocks.length;
    }
  }

  function computeSingleRoundSig(round, isRunning) {
    if (!round) return '';
    var bCount = round.blocks ? round.blocks.length : 0;
    var totalLen = 0;
    (round.blocks || []).forEach(function(b) { totalLen += (b.content || '').length; });
    // 工具状态指纹：running -> success/error 时数量不变，必须把状态纳入签名
    var toolSig = (round.tools || []).map(function(t) {
      return (t.id || '') + '~' + (t.status || '') + '~' + (t.durationMs || 0);
    }).join(',');
    return [round.roundId, bCount, totalLen, isRunning ? 1 : 0, toolSig].join(':');
  }

  function updateCardView(card, round, isRunning) {
    if (!card || !round) return;

    var pulse = card.querySelector('.tf-pulse-dot');
    if (pulse) pulse.className = 'tf-pulse-dot ' + (isRunning ? 'running' : 'done');

    // 思考开始时强制展开卡片
    if (isRunning) {
      card.setAttribute('data-expanded', 'true');
    }

    // 停止按钮和意见框跟随思考状态
    var stopBtn = card.querySelector('.tf-inline-stop-btn');
    var interveneEl = card.querySelector('.tf-inline-intervene');
    if (stopBtn) stopBtn.style.display = isRunning ? '' : 'none';
    if (interveneEl) interveneEl.style.display = isRunning ? 'none' : '';

    var tag = card.querySelector('.tf-inline-tag');
    var durationSec = (round.stats && round.stats.durationMs) ? (round.stats.durationMs / 1000).toFixed(1) + ' 秒' : (isRunning ? '推演中' : '完成');
    if (tag) tag.textContent = durationSec;

    // 更新 style/effort badge
    var styleBadge = card.querySelector('.tf-badge-style');
    var effortBadge = card.querySelector('.tf-badge-effort');
    if (styleBadge && state.thinkStyle) {
      styleBadge.textContent = state.thinkStyle === 'relational' ? '对话反思' : '深度分析';
    }
    if (effortBadge && state.thinkEffort) {
      var effortLabels = { low: '简要', medium: '标准', high: '深度' };
      effortBadge.textContent = effortLabels[state.thinkEffort] || state.thinkEffort;
    }

    var summaryEl = card.querySelector('.tf-inline-summary');
    if (summaryEl) {
      if (isRunning && (!round.blocks || !round.blocks.length)) {
        summaryEl.textContent = '正在深度思考推演中...';
      } else if (round.blocks && round.blocks.length > 0) {
        var first = round.blocks[0];
        summaryEl.textContent = first.title || first.content || '推演完成';
      } else {
        summaryEl.textContent = '推演完成';
      }
    }

    var tokEl = card.querySelector('.tf-stat-tok');
    if (tokEl && round.stats) {
      tokEl.textContent = '🧠 ' + (round.stats.reasoningTokens || round.stats.totalTokens || 0);
    }
    var durEl = card.querySelector('.tf-stat-dur');
    if (durEl) {
      durEl.textContent = '⏱ ' + String(durationSec);
    }

    // 保护：用户正在该卡片内编辑时，绝不销毁重建 DOM
    if (card.contains(document.activeElement) && document.activeElement.getAttribute('contenteditable') === 'true') {
      return;
    }

    // 检查内容签名是否变化，未变化则不重复渲染内部列表
    var newSig = computeSingleRoundSig(round, isRunning);
    if (card.getAttribute('data-sig') === newSig) {
      return;
    }
    card.setAttribute('data-sig', newSig);

    // 渲染工具调用
    var toolsWrap = card.querySelector('.tf-inline-tools-wrap');
    if (toolsWrap) {
      var tools = round.tools || [];
      if (tools.length > 0) {
        toolsWrap.innerHTML = `
          <details class="tf-tools-fold" ${tools.some(t => t.status === 'running') ? 'open' : ''}>
            <summary class="tf-tools-summary">🔧 工具调用 (${tools.length} 项记录)</summary>
            <div class="tf-tools-list"></div>
          </details>
        `;
        var listEl = toolsWrap.querySelector('.tf-tools-list');
        tools.forEach(function (t) {
          var item = document.createElement('div');
          item.className = 'tf-tool-item';
          var resultText = (t.result || t.error) ? (typeof t.result === 'string' ? t.result : safeStringify(t.result || t.error || '')) : null;
          var resultType = resultText ? detectResultType(resultText) : 'text';
          var typeIcons = { json: '📦 JSON', code: '📄 代码', text: '📝 文本', error: '❌ 错误' };
          var resultSize = resultText ? (resultText.length > 1024 ? (resultText.length / 1024).toFixed(1) + ' KB' : resultText.length + ' 字符') : '';

          item.innerHTML = [
            '<div class="tf-tool-header">',
            '  <span class="tf-tool-name">⚡ ' + escapeHtml(t.name || '工具') + '</span>',
            '  <span class="tf-tool-status ' + (t.status || 'running') + '">' + (t.status === 'running' ? '运行中...' : (t.status === 'success' ? '完成 ✅' : '失败 ❌')) + '</span>',
            '  ' + (t.durationMs ? ('<span class="tf-artifact-size">' + (t.durationMs/1000).toFixed(1) + 's</span>') : ''),
            '</div>',
            // 入参默认折叠
            '<details class="tf-tool-args-fold">',
            '  <summary>入参 (点击展开)</summary>',
            '  <pre class="tf-tool-args-body">' + escapeHtml(typeof t.args === 'object' ? safeStringify(t.args) : String(t.args || '无')) + '</pre>',
            '</details>',
            // Artifact 产物区
            (resultText ? ('<div class="tf-tool-artifact">' +
              '<div class="tf-artifact-header">' +
                '<span class="tf-artifact-type ' + resultType + '">' + (typeIcons[resultType] || '📦 结果') + '</span>' +
                '<span class="tf-artifact-size">' + resultSize + '</span>' +
                '<button class="tf-artifact-expand" data-tf-fullscreen>⛶ 全屏</button>' +
                '<button class="tf-artifact-expand" data-tf-sidebar style="margin-left:2px">📌 侧边</button>' +
                '<button class="tf-artifact-copy" data-tf-copy>复制</button>' +
              '</div>' +
              '<pre class="tf-artifact-body"><code>' + escapeHtml(resultText) + '</code></pre>' +
            '</div>') : '')
          ].join('\n');
          item.querySelector('.tf-tool-header').addEventListener('click', function () {
            var box = item.querySelector('.tf-tool-detail-box');
            if (box) box.classList.toggle('expanded');
          });
          // Artifact 按钮事件
          var fsBtn = item.querySelector('[data-tf-fullscreen]');
          var sbBtn = item.querySelector('[data-tf-sidebar]');
          var cpBtn = item.querySelector('[data-tf-copy]');
          var codeEl = item.querySelector('.tf-artifact-body code');
          var rawText = codeEl ? codeEl.textContent : '';

          // 全屏
          if (fsBtn) {
            fsBtn.addEventListener('click', function (e) {
              e.stopPropagation();
              var overlay = document.getElementById('__dsh_tf__artifact_overlay');
              var titleEl = document.getElementById('__dsh_tf__overlay_title');
              var bodyEl = document.getElementById('__dsh_tf__overlay_body');
              if (overlay && bodyEl) {
                if (titleEl) titleEl.textContent = (typeIcons[resultType] || '📦 结果') + ' · ' + escapeHtml(t.name || '工具');
                bodyEl.textContent = rawText;
                overlay.classList.add('tf-overlay-open');
              }
            });
          }

          // 侧边停靠
          if (sbBtn) {
            sbBtn.addEventListener('click', function (e) {
              e.stopPropagation();
              openToolInSidebar(t, card);
            });
          }

          // 复制
          if (cpBtn && navigator.clipboard) {
            cpBtn.addEventListener('click', function (e) {
              e.stopPropagation();
              navigator.clipboard.writeText(rawText).then(function () {
                cpBtn.textContent = '已复制';
                setTimeout(function () { cpBtn.textContent = '复制'; }, 1500);
              }).catch(function () {});
            });
          }
          listEl.appendChild(item);
        });
      } else {
        toolsWrap.innerHTML = '';
      }
    }

    // 渲染思考步骤
    var stepsWrap = card.querySelector('.tf-inline-steps-wrap');
    if (stepsWrap) {
      stepsWrap.innerHTML = '';
      var blocks = round.blocks || [];
      if (blocks.length === 0) {
        stepsWrap.innerHTML = '<div style="font-size: 12px; color: var(--tf-text-muted); padding: 8px 0;">推演进行中...</div>';
      } else {
        blocks.forEach(function (b, idx) {
          var blockEl = document.createElement('div');
          blockEl.className = 'tf-step-block';
          blockEl.innerHTML = `
            <div class="tf-step-header">
              <span class="tf-step-badge">
                <span class="tf-step-num">${escapeHtml(String(b.step || (idx + 1)))}</span>
                <span>${escapeHtml(b.title || '推演步骤')}</span>
              </span>
              <button class="tf-step-copy-btn" title="复制此段思考">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
              </button>
            </div>
            <div class="tf-step-content" contenteditable="true" spellcheck="false">${escapeHtml(b.content || '')}</div>
          `;

          // 复制
          blockEl.querySelector('.tf-step-copy-btn').addEventListener('click', function (e) {
            e.stopPropagation();
            navigator.clipboard.writeText(b.content || '').then(function () {});
          });

          // 纯文本粘贴
          var contentEl = blockEl.querySelector('.tf-step-content');
          contentEl.addEventListener('paste', function (e) {
            e.preventDefault();
            var text = (e.clipboardData || window.clipboardData).getData('text/plain');
            var clean = sanitizePlainText(text);
            var sel = window.getSelection();
            if (!sel.rangeCount) return;
            sel.deleteFromDocument();
            sel.getRangeAt(0).insertNode(document.createTextNode(clean));
            sel.collapseToEnd();
          });

          // 直接编辑失焦保存
          contentEl.addEventListener('blur', function () {
            var newVal = sanitizePlainText(contentEl.innerText);
            contentEl.textContent = newVal;
            if (newVal && newVal !== b.content) {
              b.content = newVal;
              saveState();
              fetch('/dsh-thought-flow/action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'edit_block', blockId: b.id, content: newVal })
              }).catch(function(){});
            }
          });

          stepsWrap.appendChild(blockEl);
        });
      }
    }
  }

  // 仅挂载未挂载的思考节点（MutationObserver 调用，单向幂等，绝无重入循环）
  var mountScheduled = false;
  function scheduleMountCheck() {
    if (mountScheduled) return;
    mountScheduled = true;
    requestAnimationFrame(function () {
      mountScheduled = false;
      mountPendingThinkNodes();
    });
  }

  function mountPendingThinkNodes() {
    _lastIncBlockCount = 0;
    // 严格匹配尚未挂载的节点：兼容 [data-turn-process]（整轮折叠条）与 [data-variant="think"]（行内推理块）
    var unmounted = document.querySelectorAll(
      '[data-turn-process]:not([data-tf-has-card="true"]), [data-variant="think"]:not([data-tf-has-card="true"]), ._4AI11G_root:not([data-tf-has-card="true"]), ._3GBCTG_root:not([data-tf-has-card="true"])'
    );
    if (!unmounted || !unmounted.length) return;

    var allRoots = Array.from(document.querySelectorAll('[data-turn-process], [data-variant="think"], ._4AI11G_root, ._3GBCTG_root'));
    var rounds = state.rounds || [];

    unmounted.forEach(function (thinkEl) {
      // 避免重复嵌套：如果祖先节点已被挂载，子级不重复插入
      if (thinkEl.closest('[data-tf-has-card="true"]')) {
        thinkEl.setAttribute('data-tf-has-card', 'true');
        return;
      }
      thinkEl.setAttribute('data-tf-has-card', 'true');

      // 从 data-turn-process 属性优先提取 roundId
      var turnAttr = thinkEl.getAttribute('data-turn-process');
      var turnNum = turnAttr ? parseInt(turnAttr, 10) : NaN;
      var idx = allRoots.indexOf(thinkEl);
      var round = (!isNaN(turnNum) && rounds.find(r => r.roundId === turnNum)) || (idx >= 0 && rounds[idx]) || rounds[rounds.length - 1];
      var isRunning = thinkEl.getAttribute('data-state') === 'running' || thinkEl.getAttribute('data-open') === 'true';

      var card = buildInlineCard(round, isRunning, !isNaN(turnNum) ? turnNum : (idx >= 0 ? (idx + 1) : 1));
      thinkEl.appendChild(card);
    });
  }

  // 更新所有已挂载卡片内容（仅由 SSE / 轮询数据更新驱动，严禁在 MutationObserver 中触发）
  function updateAllMountedCards() {
    mountPendingThinkNodes();
    var allCards = document.querySelectorAll('.tf-inline-card');
    if (!allCards.length) return;

    var rounds = state.rounds || [];
    allCards.forEach(function (card, idx) {
      var roundId = parseInt(card.getAttribute('data-round-id'), 10);
      var round = (roundId && rounds.find(r => r.roundId === roundId)) || rounds[idx] || rounds[rounds.length - 1];
      var parent = card.parentElement;
      var isRunning = parent ? (parent.getAttribute('data-state') === 'running') : false;
      updateCardView(card, round, isRunning);
    });
  }

  // DOM 观察器：只通过 requestAnimationFrame 调度 mountPendingThinkNodes，永不触发内容更新
  var observer = new MutationObserver(function () {
    scheduleMountCheck();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  setTimeout(scheduleMountCheck, 100);

  // 渲染水平多轮推演画板 (保留状态同步逻辑)
  // 清理文本中的 HTML 标签和多余空白
  function sanitizePlainText(text) {
    if (typeof text !== 'string') return '';
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim();
  }

  function safeStringify(obj) {
    try { return JSON.stringify(obj, null, 2); } catch(e) { return '[无法序列化: ' + e.message + ']'; }
  }
  function escapeHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // 方向一: 流式实时追加推理 Delta (不重建整个 DOM)
  function appendReasoningDelta(roundId, deltaText) {
    if (!deltaText) return;
    var round = state.rounds.find(r => r.roundId === roundId) || state.rounds[state.rounds.length - 1];
    if (!round) {
      round = { roundId: roundId || 1, title: '第一次思考', blocks: [], tools: [] };
      state.rounds.push(round);
    }
    if (!round.blocks) round.blocks = [];
    if (!round.blocks.length) {
      round.blocks.push({
        id: 'block-1',
        step: 1,
        title: '实时思考中...',
        content: deltaText,
        timestamp: Date.now()
      });
      updateAllMountedCards();
      return;
    }

    var lastBlock = round.blocks[round.blocks.length - 1];
    lastBlock.content += deltaText;

    // 增量更新对应轮次卡片的文本，避免全量重建
    // 必须按 roundId 精确匹配：多轮场景下"最后一张卡"未必是当前轮次
    var allCards = document.querySelectorAll('.tf-inline-card');
    var activeCard = document.querySelector('.tf-inline-card[data-round-id="' + round.roundId + '"]')
                   || allCards[allCards.length - 1];
    if (activeCard) {
      var lastStepContent = activeCard.querySelector('.tf-step-block:last-child .tf-step-content');
      if (lastStepContent && document.activeElement !== lastStepContent) {
        lastStepContent.textContent = lastBlock.content;
        var summary = activeCard.querySelector('.tf-inline-summary');
        if (summary) summary.textContent = '正在深度思考推演中...';
        return;
      }
    }
    updateAllMountedCards();
  }

  // 记忆按钮脉冲呼吸提醒 (Issue: 结束脉冲提醒)
  function triggerMemoryPulse() {
    var btn = document.getElementById('__dsh_tf__btn_memory');
    if (btn) {
      btn.classList.remove('tf-memory-pulse');
      void btn.offsetWidth;
      btn.classList.add('tf-memory-pulse');
    }
  }

  // 方向一: SSE 实时长连接
  var sseConnected = false;
  function initSSE() {
    if (typeof EventSource === 'undefined') return false;
    try {
      var es = new EventSource('/dsh-thought-flow/stream');
      es.addEventListener('init', function (e) {
        sseConnected = true;
        var data = JSON.parse(e.data || '{}');
        if (data.rounds && data.rounds.length) {
          if (!state.rounds.length) {
            state.rounds = data.rounds;
            updateAllMountedCards();
          } else {
            // 本地已有数据，仅合并补充缺失轮次，保留用户编辑
            data.rounds.forEach(function(sr) {
              var exists = state.rounds.find(function(lr) { return lr.roundId === sr.roundId; });
              if (!exists) {
                state.rounds.push(sr);
              } else if (!exists.blocks || !exists.blocks.length) {
                exists.blocks = sr.blocks;
                exists.tools = sr.tools;
                exists.stats = sr.stats;
                exists.finalReply = sr.finalReply;
              }
            });
            updateAllMountedCards();
          }
        }
      });
      es.addEventListener('turn/start', function (e) {
        if (indicatorEl) indicatorEl.textContent = '思考中...';
        _lastIncBlockCount = 0;
        lastDeltaContent = '';
        var data = JSON.parse(e.data || '{}');
        if (data.round) {
          var exists = state.rounds.find(r => r.roundId === data.round.roundId);
          if (!exists) {
            state.rounds.push(data.round);
            state.activeRoundIndex = state.rounds.length - 1;
          }
          updateAllMountedCards();
        }
      });
      triggerMemoryPulse();
      es.addEventListener('turn/end', function (e) {
        var data = JSON.parse(e.data || '{}');
        triggerMemoryPulse();
        if (data.round) {
          var idx = state.rounds.findIndex(r => r.roundId === data.round.roundId);
          if (idx !== -1) {
            var existing = state.rounds[idx];
            if (data.round.blocks && data.round.blocks.length) { existing.blocks = data.round.blocks; _lastIncBlockCount = 0; }
            if (data.round.tools) existing.tools = data.round.tools;
            if (data.round.stats) existing.stats = data.round.stats;
            if (data.round.finalReply) existing.finalReply = data.round.finalReply;
            saveState();
            updateAllMountedCards();
          }
        }
      });
      es.addEventListener('tool/start', function (e) {
        var data = JSON.parse(e.data || '{}');
        var round = state.rounds.find(r => r.roundId === data.roundId) || state.rounds[state.rounds.length - 1];
        if (round) {
          if (!round.tools) round.tools = [];
          round.tools.push(data.tool);
          saveState();
          updateAllMountedCards();
        }
      });
      es.addEventListener('tool/end', function (e) {
        var data = JSON.parse(e.data || '{}');
        var round = state.rounds.find(r => r.roundId === data.roundId) || state.rounds[state.rounds.length - 1];
        if (round && round.tools) {
          var tIdx = round.tools.findIndex(t => t.id === data.tool.id);
          if (tIdx !== -1) round.tools[tIdx] = data.tool;
          else round.tools.push(data.tool);
          saveState();
          updateAllMountedCards();
        }
      });
      es.addEventListener('reasoning/delta', function (e) {
        var data = JSON.parse(e.data || '{}');
        appendReasoningDelta(data.roundId, data.delta);
      });
      es.addEventListener('round/update', function (e) {
        var data = JSON.parse(e.data || '{}');
        if (data.round) {
          var idx = state.rounds.findIndex(r => r.roundId === data.round.roundId);
          if (idx !== -1) {
            var existing = state.rounds[idx];
            if (data.round.blocks && data.round.blocks.length) existing.blocks = data.round.blocks;
            if (data.round.tools) existing.tools = data.round.tools;
            if (data.round.stats) existing.stats = data.round.stats;
            if (data.round.finalReply) existing.finalReply = data.round.finalReply;
          } else {
            state.rounds.push(data.round);
          }
          saveState();
          updateAllMountedCards();
        }
      });
      es.onerror = function () {
        sseConnected = false;
        try { es.close(); } catch (err) {}
      };
      window.addEventListener('beforeunload', function () {
        try { es.close(); } catch (err) {}
      });
      return true;
    } catch (err) {
      return false;
    }
  }

  // 轮询兜底 (SSE 未连接时作为平滑 fallback)
  var wasThinking = false;
  function pollSync() {
    if (sseConnected) {
      setTimeout(pollSync, 3000);
      return;
    }
    fetch('/dsh-thought-flow/sync', { cache: 'no-store' })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (!data) return;

        if (data.isThinking && indicatorEl) {
          indicatorEl.textContent = '思考中...';
        }
        if (wasThinking && !data.isThinking) {
          triggerMemoryPulse();
        }
        wasThinking = !!data.isThinking;

        if (typeof data.isPaused === 'boolean' && data.isPaused !== state.isPaused) {
          state.isPaused = data.isPaused;
        }

        if (data.rounds && Array.isArray(data.rounds)) {
          state.rounds = data.rounds;
          if (state.activeRoundIndex >= state.rounds.length) {
            state.activeRoundIndex = Math.max(0, state.rounds.length - 1);
          }
          saveState();
          updateAllMountedCards();
        }
      })
      .catch(function () {})
      .finally(function () {
        setTimeout(pollSync, 1200);
      });
  }

  // Esc 键快速关闭面板
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      memoryPanel.classList.remove('tf-memory-open');
    }
  });


  // =========================================================================
  // 长期记忆管理面板（Hermes 风格双层记忆）
  // =========================================================================
  var memoryPanel = document.createElement('div');
  memoryPanel.id = '__dsh_tf__memory_panel';
  memoryPanel.className = 'tf-memory-panel';
  memoryPanel.innerHTML = `
    <div class="tf-memory-header">
      <span class="tf-memory-title">🧠 长期记忆</span>
      <button class="tf-memory-close" id="__dsh_tf__memory_close" title="关闭">✕</button>
    </div>
    <div class="tf-memory-tabs">
      <button class="tf-memory-tab active" data-target="memory">项目与经验</button>
      <button class="tf-memory-tab" data-target="user">用户偏好</button>
    </div>
    <div class="tf-memory-usage">
      <div class="tf-memory-bar"><div class="tf-memory-bar-fill" id="__dsh_tf__mem_fill"></div></div>
      <span class="tf-memory-usage-text" id="__dsh_tf__mem_usage">0 / 2200 chars</span>
    </div>
    <div class="tf-memory-search">
        <input type="text" id="__dsh_tf__mem_search" placeholder="🔍 搜索记忆…" style="display:none" />
      </div>
      <div class="tf-memory-list" id="__dsh_tf__mem_list"></div>
    <div class="tf-memory-add">
      <textarea id="__dsh_tf__mem_input" placeholder="添加一条记忆（回车提交，Shift+回车换行）" rows="2"></textarea>
      <button class="tf-memory-add-btn" id="__dsh_tf__mem_add">添加</button>
    </div>
    <div class="tf-memory-row">
      <span class="tf-memory-label">思考风格</span>
      <select id="__dsh_tf__style_select">
        <option value="deep_think">深度分析</option>
        <option value="relational">对话反思</option>
      </select>
    </div>
    <div class="tf-memory-row">
      <span class="tf-memory-label">努力程度</span>
      <select id="__dsh_tf__effort_select">
        <option value="low">简要</option>
        <option value="medium" selected>标准</option>
        <option value="high">深度</option>
      </select>
    </div>
    <div class="tf-memory-footer">
      <label class="tf-memory-switch">
        <input type="checkbox" id="__dsh_tf__clarify_toggle" checked>
        <span>任务前澄清提问</span>
      </label>
      <span class="tf-memory-hint">记忆会注入 System Prompt，只保留关键事实</span>
    </div>
  `;
  root.appendChild(memoryPanel);

  var memTarget = 'memory';
  var memSearchInput = document.getElementById('__dsh_tf__mem_search');
  if (memSearchInput) {
    memSearchInput.addEventListener('input', function () {
      renderMemoryPanel();
    });
  }
  var memState = { memory: { entries: [], used: 0, limit: 2200, percent: 0 }, user: { entries: [], used: 0, limit: 1375, percent: 0 } };

  function renderMemoryPanel() {
    var t = memTarget;
    var data = memState[t] || { entries: [], used: 0, limit: 2200, percent: 0 };

    var fill = document.getElementById('__dsh_tf__mem_fill');
    var usage = document.getElementById('__dsh_tf__mem_usage');
    if (fill) {
      fill.style.width = Math.min(100, data.percent) + '%';
      fill.className = 'tf-memory-bar-fill' + (data.percent >= 90 ? ' danger' : (data.percent >= 70 ? ' warn' : ''));
    }
    if (usage) {
      usage.textContent = data.used + ' / ' + data.limit + ' chars (' + data.percent + '%)';
    }

    var list = document.getElementById('__dsh_tf__mem_list');
    var searchInput = document.getElementById('__dsh_tf__mem_search');
    if (!list) return;
    if (searchInput && data.entries && data.entries.length > 0) searchInput.style.display = '';
    else if (searchInput) searchInput.style.display = 'none';
    list.innerHTML = '';

    if (!data.entries.length) {
      list.innerHTML = '<div class="tf-memory-empty">还没有记忆条目。模型会跨会话记住你在这里写下的内容。</div>';
      return;
    }

    var searchTerm = (document.getElementById('__dsh_tf__mem_search') && document.getElementById('__dsh_tf__mem_search').value || '').toLowerCase();
    data.entries.forEach(function (entry, idx) {
      if (searchTerm && entry.toLowerCase().indexOf(searchTerm) === -1) return;
      var row = document.createElement('div');
      row.className = 'tf-memory-item';
      row.innerHTML = '<span class="tf-memory-item-text"></span><button class="tf-memory-del" title="删除">✕</button>';
      row.querySelector('.tf-memory-item-text').textContent = entry;
      row.querySelector('.tf-memory-del').addEventListener('click', function () {
        fetch('/dsh-thought-flow/memory', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ op: 'remove', target: memTarget, match: entry })
        }).then(function (r) { return r.json(); }).then(function () { loadMemory(); }).catch(function () {});
      });
      list.appendChild(row);
    });
  }

  function loadMemory() {
    fetch('/dsh-thought-flow/memory', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data || !data.ok) return;
        memState.memory = { entries: data.entries.memory || [], used: data.stats.memory.used, limit: data.stats.memory.limit, percent: data.stats.memory.percent };
        memState.user = { entries: data.entries.user || [], used: data.stats.user.used, limit: data.stats.user.limit, percent: data.stats.user.percent };
        var toggle = document.getElementById('__dsh_tf__clarify_toggle');
        if (toggle) toggle.checked = !!data.clarifyEnabled;
        if (data.thinkStyle) {
          state.thinkStyle = data.thinkStyle;
          var ss = document.getElementById('__dsh_tf__style_select');
          if (ss) ss.value = data.thinkStyle;
        }
        if (data.thinkEffort) {
          state.thinkEffort = data.thinkEffort;
          var es = document.getElementById('__dsh_tf__effort_select');
          if (es) es.value = data.thinkEffort;
        }
        renderMemoryPanel();
      })
      .catch(function () {});
  }

  // 打开/关闭
  var btnMemory = document.getElementById('__dsh_tf__btn_memory');
  if (btnMemory) {
    btnMemory.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = memoryPanel.classList.toggle('tf-memory-open');
      if (open) loadMemory();
    });
  }
  var btnMemClose = document.getElementById('__dsh_tf__memory_close');
  if (btnMemClose) {
    btnMemClose.addEventListener('click', function () { memoryPanel.classList.remove('tf-memory-open'); });
  }

  // tab 切换
  Array.prototype.forEach.call(memoryPanel.querySelectorAll('.tf-memory-tab'), function (tab) {
    tab.addEventListener('click', function () {
      memTarget = tab.getAttribute('data-target') || 'memory';
      Array.prototype.forEach.call(memoryPanel.querySelectorAll('.tf-memory-tab'), function (t) {
        t.classList.toggle('active', t === tab);
      });
      renderMemoryPanel();
    });
  });

  // 添加
  function submitMemory() {
    var input = document.getElementById('__dsh_tf__mem_input');
    if (!input) return;
    var text = input.value.trim();
    if (!text) return;

    fetch('/dsh-thought-flow/memory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'add', target: memTarget, text: text })
    }).then(function (r) { return r.json(); }).then(function (res) {
      if (res && res.ok) {
        input.value = '';
        loadMemory();
      } else if (res && res.error === 'limit exceeded') {
        alert('记忆已达上限（' + res.used + '/' + res.limit + ' chars），请先删除或合并旧条目。');
      } else {
        alert('添加失败：' + ((res && res.error) || '未知错误'));
      }
    }).catch(function () {});
  }

  var btnMemAdd = document.getElementById('__dsh_tf__mem_add');
  if (btnMemAdd) btnMemAdd.addEventListener('click', submitMemory);

  var memInput = document.getElementById('__dsh_tf__mem_input');
  if (memInput) {
    memInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submitMemory();
      }
    });
  }

  // 风格选择器
  var styleSelect = document.getElementById('__dsh_tf__style_select');
  var effortSelect = document.getElementById('__dsh_tf__effort_select');
  if (styleSelect && effortSelect) {
    function sendStyleEffort() {
    fetch('/dsh-thought-flow/memory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'set_style', style: styleSelect.value })
    }).catch(function () {});
    fetch('/dsh-thought-flow/memory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'set_effort', effort: effortSelect.value })
    }).catch(function () {});
    // 更新本地 state，刷新卡片标签
    state.thinkStyle = styleSelect.value;
    state.thinkEffort = effortSelect.value;
    saveState();
    // 同步更新所有已挂载卡片的标签
    document.querySelectorAll('.tf-inline-card').forEach(function (c) {
      var sb = c.querySelector('.tf-badge-style');
      var eb = c.querySelector('.tf-badge-effort');
      if (sb) sb.textContent = styleSelect.value === 'relational' ? '对话反思' : '深度分析';
      if (eb) {
        var el = { low: '简要', medium: '标准', high: '深度' };
        eb.textContent = el[effortSelect.value] || effortSelect.value;
      }
    });
  }
    styleSelect.addEventListener('change', sendStyleEffort);
    effortSelect.addEventListener('change', sendStyleEffort);
  }

  // 澄清开关
  var clarifyToggle = document.getElementById('__dsh_tf__clarify_toggle');
  if (clarifyToggle) {
    clarifyToggle.addEventListener('change', function () {
      fetch('/dsh-thought-flow/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'toggle_clarify' })
      }).catch(function () {});
    });
  }

  // 初始渲染已持久化的数据
  initSSE();
  pollSync();
  

})();
