(function () {
  if (window.__dshThoughtFlowLoaded) return;
  window.__dshThoughtFlowLoaded = true;

  // 动态引入样式
  var link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/dsh-thought-flow/thought-flow.css';
  document.head.appendChild(link);

  var STORAGE_KEY = '__dsh_thought_flow_state_v1__';

  var state = {
    enabled: true,
    visible: false,
    rounds: [],
    activeRoundIndex: 0,
    isPaused: false,
    editingBlockId: null,
    dualView: false,
    panelWidth: 960,
    panelHeight: 640
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
          if (typeof parsed.visible === 'boolean') state.visible = parsed.visible;
          if (typeof parsed.isPaused === 'boolean') state.isPaused = parsed.isPaused;
          if (typeof parsed.dualView === 'boolean') state.dualView = parsed.dualView;
          if (typeof parsed.panelWidth === 'number' && parsed.panelWidth >= 400) state.panelWidth = parsed.panelWidth;
          if (typeof parsed.panelHeight === 'number' && parsed.panelHeight >= 300) state.panelHeight = parsed.panelHeight;
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
          visible: state.visible,
          isPaused: state.isPaused,
          dualView: state.dualView,
          panelWidth: state.panelWidth,
          panelHeight: state.panelHeight,
          savedAt: Date.now()
        }));
      } catch (e) {}
    }, 300);
  }

  loadPersistedState();

  // 创建 DOM 容器 (使用隔离的前缀，解决 Issue 9 全局 ID 污染)
  var root = document.createElement('div');
  root.id = '__dsh_tf__root';
  root.className = 'tf-plugin-root';
  document.body.appendChild(root);

  // 1. 悬浮胶囊控制条 (靠左停靠)
  var floatBar = document.createElement('div');
  floatBar.id = '__dsh_tf__float_bar';
  floatBar.className = 'tf-float-bar';
  floatBar.innerHTML = `
    <div class="tf-pulse-dot"></div>
    <span style="font-size: 13px; font-weight: 600;">思维流</span>
    <span class="tf-round-indicator" id="__dsh_tf__indicator">准备就绪</span>
  `;
  root.appendChild(floatBar);
  var indicatorEl = floatBar.querySelector('#__dsh_tf__indicator');

  // 2. 核心毛玻璃画板面板
  var panel = document.createElement('div');
  panel.id = '__dsh_tf__flow_panel';
  panel.className = 'tf-flow-panel' + (state.visible ? ' tf-visible __dsh_tf__visible' : '');
  panel.innerHTML = `
    <div class="tf-panel-header">
      <div class="tf-panel-title">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
        <span>思维链沉淀画板</span>
      </div>
      <div class="tf-round-tabs" id="__dsh_tf__round_tabs">
        <!-- 动态轮次 Tab -->
      </div>
      <div class="tf-panel-actions">
        <button class="tf-dual-toggle-btn" id="__dsh_tf__btn_dual" title="切换思考与最终回复双栏对照">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="12" y1="3" x2="12" y2="21"></line></svg>
          <span>双栏对照</span>
        </button>
        <button class="tf-btn-icon" id="__dsh_tf__btn_clear" title="清空画板">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
        </button>
        <button class="tf-btn-icon" id="__dsh_tf__btn_close" title="收起面板">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>
    </div>
    <div class="tf-blocks-container" id="__dsh_tf__blocks_list">
      <div style="text-align: center; color: var(--tf-text-muted); font-size: 13px; margin: auto;">
        等待思维链启动推演...
      </div>
    </div>
    <div class="tf-intervene-bar">
      <div class="tf-input-row" style="display: flex; gap: 8px; width: 100%;">
        <input type="text" class="tf-input" id="__dsh_tf__intervene_input" placeholder="针对当前思考路线提出指导意见，实时修正..." />
        <button class="tf-action-btn tf-btn-primary" id="__dsh_tf__btn_submit_opinion">发送指导</button>
        <button class="tf-action-btn tf-btn-danger" id="__dsh_tf__btn_interrupt">
          <span id="__dsh_tf__interrupt_label">打断思考</span>
        </button>
      </div>
    </div>
  `;
  root.appendChild(panel);

  var tabsContainer = panel.querySelector('#__dsh_tf__round_tabs');
  var blocksContainer = panel.querySelector('#__dsh_tf__blocks_list');
  var btnDual = panel.querySelector('#__dsh_tf__btn_dual');
  var btnClear = panel.querySelector('#__dsh_tf__btn_clear');
  var btnClose = panel.querySelector('#__dsh_tf__btn_close');
  var inputOpinion = panel.querySelector('#__dsh_tf__intervene_input');
  var btnSubmitOpinion = panel.querySelector('#__dsh_tf__btn_submit_opinion');
  var btnInterrupt = panel.querySelector('#__dsh_tf__btn_interrupt');
  var lblInterrupt = panel.querySelector('#__dsh_tf__interrupt_label');

  if (state.dualView && btnDual) {
    btnDual.classList.add('active');
  }

  if (btnDual) {
    btnDual.addEventListener('click', function () {
      state.dualView = !state.dualView;
      btnDual.classList.toggle('active', state.dualView);
      saveState();
      renderRounds();
    });
  }

  // 绑定交互
  floatBar.addEventListener('dblclick', function () {
    // 双击快速最小化/恢复面板
    state.visible = false;
    panel.classList.remove('tf-visible');
    panel.classList.remove('__dsh_tf__visible');
    saveState();
  });
  floatBar.addEventListener('click', function () {
    state.visible = !state.visible;
    panel.classList.toggle('tf-visible', state.visible);
    panel.classList.toggle('__dsh_tf__visible', state.visible);
    saveState();
  });

  btnClose.addEventListener('click', function () {
    state.visible = false;
    panel.classList.remove('tf-visible');
    panel.classList.remove('__dsh_tf__visible');
    saveState();
  });

  btnClear.addEventListener('click', function () {
    state.rounds = [];
    state.activeRoundIndex = 0;
    saveState();
    fetch('/dsh-thought-flow/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'clear' })
    }).catch(function(){});
    renderRounds();
  });

  // 打断/恢复 (Issue 2)
  function updateInterruptUI() {
    if (state.isPaused) {
      lblInterrupt.textContent = '已暂停推演 (点击继续)';
      btnInterrupt.style.background = 'rgba(52, 199, 89, 0.2)';
      btnInterrupt.style.color = 'var(--tf-success)';
    } else {
      lblInterrupt.textContent = '打断思考';
      btnInterrupt.style.background = '';
      btnInterrupt.style.color = '';
    }
  }
  updateInterruptUI();

  btnInterrupt.addEventListener('click', function () {
    state.isPaused = !state.isPaused;
    updateInterruptUI();
    saveState();
    var actionType = state.isPaused ? 'pause' : 'resume';
    fetch('/dsh-thought-flow/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: actionType })
    }).catch(function(){});
  });

  // 发送人工意见 (Issue 1)
  function submitOpinion() {
    var val = inputOpinion.value.trim();
    if (!val) return;
    fetch('/dsh-thought-flow/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'opinion', text: val })
    }).then(function () {
      inputOpinion.value = '';
      // 在当前活跃轮次追加一条人工指导意见
      var curRound = state.rounds[state.activeRoundIndex];
      if (!curRound) {
        curRound = { roundId: 1, title: '第一次思考', blocks: [] };
        state.rounds.push(curRound);
      }
      curRound.blocks.push({
        id: 'block-human-' + Date.now(),
        step: '指导',
        title: '用户意见介入',
        content: val,
        isHuman: true
      });
      saveState();
      renderRounds();
    }).catch(function(){});
  }
  btnSubmitOpinion.addEventListener('click', submitOpinion);
  inputOpinion.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') submitOpinion();
  });

  // 纯文本防富文本污染过滤 (Issue 8)
  function sanitizePlainText(str) {
    return String(str || '')
      .replace(/<[^>]*>/g, '') // 去除 html 标签
      .replace(/&nbsp;/g, ' ')
      .replace(/\r\n/g, '\n')
      .trim();
  }

  // 渲染水平多轮推演画板 (Issue 5 增量与保护机制)
  var lastRenderedSig = '';
  function computeRoundsSignature(rounds) {
    if (!rounds || !rounds.length) return 'empty';
    return rounds.map(function (r, rIdx) {
      var bCount = r.blocks ? r.blocks.length : 0;
      var totalContentLen = 0;
      (r.blocks || []).forEach(function(b) { totalContentLen += (b.content || '').length; });
      return (r.roundId || rIdx) + ':' + bCount + ':' + totalContentLen;
    }).join('|');
  }

  function renderRounds() {
    var rounds = state.rounds || [];
    if (!rounds.length) {
      blocksContainer.innerHTML = '<div style="text-align: center; color: var(--tf-text-muted); font-size: 13px; margin: auto;">等待思维链启动推演...</div>';
      tabsContainer.innerHTML = '';
      if (indicatorEl) indicatorEl.textContent = '准备就绪';
      lastRenderedSig = 'empty';
      return;
    }

    if (indicatorEl) indicatorEl.textContent = '第 ' + rounds.length + ' 轮思考';

    // 检查是否有输入框正在获取焦点进行编辑 (保护用户编辑状态，Issue 5)
    var activeEl = document.activeElement;
    var isUserEditing = activeEl && activeEl.getAttribute('contenteditable') === 'true' && blocksContainer.contains(activeEl);
    if (isUserEditing) {
      return; // 用户正在输入编辑时，绝不突变重绘 DOM 打断输入
    }

    // 渲染顶部轮次快捷指示
    tabsContainer.innerHTML = '';
    rounds.forEach(function (r, rIdx) {
      var tab = document.createElement('div');
      tab.className = 'tf-round-tab' + (rIdx === state.activeRoundIndex ? ' active' : '');
      tab.textContent = r.title || ('第 ' + (rIdx + 1) + ' 次思考');
      tab.addEventListener('click', function () {
        state.activeRoundIndex = rIdx;
        saveState();
        var col = document.getElementById('__dsh_tf__col_' + rIdx);
        if (col) col.scrollIntoView({ behavior: 'smooth', inline: 'center' });
      });
      tabsContainer.appendChild(tab);
    });

    blocksContainer.innerHTML = '';

    // 水平生成各个思考轮次大卡片
    rounds.forEach(function (r, rIdx) {
      var col = document.createElement('div');
      col.className = 'tf-round-column';
      col.id = '__dsh_tf__col_' + rIdx;

      // 卡片顶部标题
      var colHeader = document.createElement('div');
      colHeader.className = 'tf-round-col-header';
      colHeader.innerHTML = `
        <div class="tf-round-col-title">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"></polyline></svg>
          <span>${escapeHtml(r.title)}</span>
        </div>
        <span style="font-size:11px; opacity:0.65; color:var(--tf-text-muted);">${r.blocks ? r.blocks.length : 0} 个核心要点</span>
      `;
      col.appendChild(colHeader);

      // 卡片内部的思考要点列表
      var subList = document.createElement('div');
      subList.className = 'tf-sub-blocks-list';

      // 渲染工具调用可视化卡片 (方向三: Tool Calls Visualization)
      if (r.tools && r.tools.length > 0) {
        var toolsContainer = document.createElement('div');
        toolsContainer.className = 'tf-tools-section';
        r.tools.forEach(function (tool) {
          var toolCard = document.createElement('div');
          toolCard.className = 'tf-tool-card';
          var icon = (tool.name.includes('exec') || tool.name.includes('terminal') || tool.name.includes('cmd')) ? '⚡' : ((tool.name.includes('file') || tool.name.includes('read') || tool.name.includes('write')) ? '📄' : '🔧');
          var statusClass = tool.status || 'running';
          var timeText = (tool.durationMs !== undefined) ? ((tool.durationMs / 1000).toFixed(1) + 's ') : '';
          var statusBadge = tool.status === 'running' ? '⏳ 运行中' : (tool.status === 'success' ? (timeText + '✅') : (timeText + '❌ 失败'));

          toolCard.innerHTML = `
            <div class="tf-tool-header">
              <div class="tf-tool-name-wrap">
                <span>${icon}</span>
                <span>${escapeHtml(tool.name)}</span>
              </div>
              <span class="tf-tool-status ${statusClass}">${statusBadge}</span>
            </div>
            <div class="tf-tool-details" style="display: none;">
              <div><strong>入参:</strong> ${escapeHtml(typeof tool.args === 'object' ? safeStringify(tool.args) : tool.args)}</div>
              ${tool.error ? `<div style="color:var(--tf-danger);margin-top:4px;"><strong>错误:</strong> ${escapeHtml(tool.error)}</div>` : ''}
              ${tool.result ? `<div style="margin-top:4px;"><strong>结果:</strong> ${escapeHtml(typeof tool.result === 'object' ? safeStringify(tool.result) : tool.result)}</div>` : ''}
            </div>
          `;
          toolCard.querySelector('.tf-tool-header').addEventListener('click', function () {
            var d = toolCard.querySelector('.tf-tool-details');
            d.style.display = d.style.display === 'none' ? 'block' : 'none';
          });
          toolsContainer.appendChild(toolCard);
        });
        subList.appendChild(toolsContainer);
      }

      if (!r.blocks || !r.blocks.length) {
        if (!r.tools || !r.tools.length) {
          subList.innerHTML += '<span style="font-size:12px; color:var(--tf-text-muted); margin:auto;">推演生成中...</span>';
        }
      } else {
        r.blocks.forEach(function (b, bIdx) {
          var card = document.createElement('div');
          card.className = 'tf-block-card';
          // 方向六: Stagger 阶梯入场延迟
          card.style.setProperty('--i', bIdx);

          if (b.isHuman) {
            card.style.borderColor = 'var(--tf-success)';
            card.style.background = 'rgba(52, 199, 89, 0.1)';
          }

          card.innerHTML = `
            <div class="tf-block-header">
              <div class="tf-block-tag">
                <span class="tf-block-step-num" style="${b.isHuman ? 'background: var(--tf-success);' : ''}">${escapeHtml(b.step)}</span>
                <span class="tf-block-title">${escapeHtml(b.title)}</span>
              </div>
              <button class="tf-block-copy-btn" title="复制此段思考内容">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
              </button>
            </div>
            <div class="tf-block-content" contenteditable="true" spellcheck="false">${escapeHtml(b.content)}</div>
          `;

          var copyBtn = card.querySelector('.tf-block-copy-btn');
          if (copyBtn) {
            copyBtn.addEventListener('click', function (ev) {
              ev.stopPropagation();
              navigator.clipboard.writeText(b.content || '').then(function () {
                copyBtn.classList.add('copied');
                setTimeout(function () { copyBtn.classList.remove('copied'); }, 1200);
              }).catch(function () {});
            });
          }

          var contentEl = card.querySelector('.tf-block-content');

          // Issue 8: 拦截富文本粘贴，仅保留纯文本
          contentEl.addEventListener('paste', function (e) {
            e.preventDefault();
            var text = (e.clipboardData || window.clipboardData).getData('text/plain');
            var clean = sanitizePlainText(text);
            var selection = window.getSelection();
            if (!selection.rangeCount) return;
            selection.deleteFromDocument();
            selection.getRangeAt(0).insertNode(document.createTextNode(clean));
            selection.collapseToEnd();
          });

          // 直接上手编辑修改：失焦时严格清洗并保存
          contentEl.addEventListener('blur', function () {
            var newVal = sanitizePlainText(contentEl.innerText);
            contentEl.textContent = newVal; // 消除多余 DOM 标签
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

          subList.appendChild(card);
        });
      }

      col.appendChild(subList);

      // 方向五: 渲染底部 Token 消耗 & 耗时瀑布条 (Langfuse 风格)
      var stats = r.stats || {};
      var statsBar = document.createElement('div');
      statsBar.className = 'tf-stats-bar';
      var durationSec = stats.durationMs ? (stats.durationMs / 1000).toFixed(1) + 's' : '0.0s';
      statsBar.innerHTML = `
        <div class="tf-stats-group">
          <span class="tf-stats-item" title="思考消耗 Token">🧠 ${stats.reasoningTokens || 0} tok</span>
          <span class="tf-stats-item" title="回复消耗 Token">💬 ${stats.completionTokens || 0} tok</span>
        </div>
        <div class="tf-stats-group">
          <span class="tf-stats-item" title="该轮耗时">⏱ ${durationSec}</span>
        </div>
      `;
      col.appendChild(statsBar);

      blocksContainer.appendChild(col);

      // 方向二: 双栏对照视图 (如果开启且该轮有最终回复，并排渲染回复卡片)
      if (state.dualView && r.finalReply) {
        var replyCol = document.createElement('div');
        replyCol.className = 'tf-reply-column';
        replyCol.id = '__dsh_tf__reply_' + rIdx;
        replyCol.innerHTML = `
          <div class="tf-round-col-header">
            <div class="tf-round-col-title" style="color: var(--tf-success);">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
              <span>${escapeHtml(r.title)} · 回复对照</span>
            </div>
            <span style="font-size:11px; opacity:0.65; color:var(--tf-text-muted);">最终输出</span>
          </div>
          <div class="tf-reply-body">${escapeHtml(r.finalReply)}</div>
        `;
        blocksContainer.appendChild(replyCol);
      }

      // 如果有后续轮次，渲染中间的水平大衔接箭头
      if (rIdx < rounds.length - 1) {
        var conn = document.createElement('div');
        conn.className = 'tf-round-connector';
        conn.innerHTML = `
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="4" y1="12" x2="20" y2="12"></line><polyline points="14 6 20 12 14 18"></polyline></svg>
        `;
        blocksContainer.appendChild(conn);
      }
    });

    // 默认滑向最右侧最新的思考大卡片
    blocksContainer.scrollLeft = blocksContainer.scrollWidth;
    lastRenderedSig = computeRoundsSignature(rounds);
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
      renderRounds();
      return;
    }

    var lastBlock = round.blocks[round.blocks.length - 1];
    lastBlock.content += deltaText;

    var rIdx = state.rounds.indexOf(round);
    var col = document.getElementById('__dsh_tf__col_' + rIdx);
    if (col) {
      var lastContentEl = col.querySelector('.tf-block-card:last-child .tf-block-content');
      if (lastContentEl && document.activeElement !== lastContentEl) {
        lastContentEl.textContent = lastBlock.content;
        return;
      }
    }
    renderRounds();
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
            renderRounds();
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
            renderRounds();
          }
        }
      });
      es.addEventListener('turn/start', function (e) {
        state.visible = true;
        panel.classList.add('tf-visible', '__dsh_tf__visible');
        saveState();
        var data = JSON.parse(e.data || '{}');
        if (data.round) {
          var exists = state.rounds.find(r => r.roundId === data.round.roundId);
          if (!exists) {
            state.rounds.push(data.round);
            state.activeRoundIndex = state.rounds.length - 1;
            renderRounds();
          }
        }
      });
      es.addEventListener('turn/end', function (e) {
        var data = JSON.parse(e.data || '{}');
        if (data.round) {
          var idx = state.rounds.findIndex(r => r.roundId === data.round.roundId);
          if (idx !== -1) {
            var existing = state.rounds[idx];
            if (data.round.blocks && data.round.blocks.length) existing.blocks = data.round.blocks;
            if (data.round.tools) existing.tools = data.round.tools;
            if (data.round.stats) existing.stats = data.round.stats;
            if (data.round.finalReply) existing.finalReply = data.round.finalReply;
            saveState();
            renderRounds();
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
          renderRounds();
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
          renderRounds();
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
          renderRounds();
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

        // Issue 4 修复：当推理启动时自动展开面板；推理结束时绝不强行自动隐藏面板，让用户从容审阅
        if (data.isThinking && !wasThinking) {
          state.visible = true;
          panel.classList.add('tf-visible');
          panel.classList.add('__dsh_tf__visible');
          saveState();
        }
        wasThinking = !!data.isThinking;

        if (typeof data.isPaused === 'boolean' && data.isPaused !== state.isPaused) {
          state.isPaused = data.isPaused;
          updateInterruptUI();
        }

        if (data.rounds && Array.isArray(data.rounds)) {
          var serverSig = computeRoundsSignature(data.rounds);
          if (serverSig !== lastRenderedSig) {
            state.rounds = data.rounds;
            if (state.activeRoundIndex >= state.rounds.length) {
              state.activeRoundIndex = Math.max(0, state.rounds.length - 1);
            }
            saveState();
            renderRounds();
          }
        }
      })
      .catch(function () {})
      .finally(function () {
        setTimeout(pollSync, 1200);
      });
  }

  // Esc 键快速关闭面板
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && state.visible && !e.target.closest('.tf-block-content')) {
      state.visible = false;
      panel.classList.remove('tf-visible');
      panel.classList.remove('__dsh_tf__visible');
      saveState();
    }
  });

  // 初始渲染已持久化的数据
  renderRounds();
  initSSE();
  pollSync();
  // ── 面板右下角拖拽改尺寸 ──
  (function initResize() {
    var handle = document.createElement('div');
    handle.id = '__dsh_tf__resize_handle';
    panel.appendChild(handle);

    var isResizing = false, startX, startY, startW, startH;

    handle.addEventListener('mousedown', function (e) {
      e.preventDefault();
      isResizing = true;
      startX = e.clientX;
      startY = e.clientY;
      startW = state.panelWidth || 960;
      startH = state.panelHeight || 640;
      document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', function (e) {
      if (!isResizing) return;
      var newW = Math.max(420, Math.min(window.innerWidth - 60, startW + (e.clientX - startX)));
      var maxH = Math.min(window.innerHeight - 200, parseInt(panel.style.maxHeight) || (window.innerHeight - 230));
      var newH = Math.max(320, Math.min(maxH, startH + (e.clientY - startY)));
      panel.style.width = newW + 'px';
      panel.style.height = newH + 'px';
      state.panelWidth = newW;
      state.panelHeight = newH;
    });

    document.addEventListener('mouseup', function () {
      if (!isResizing) return;
      isResizing = false;
      document.body.style.userSelect = '';
      saveState();
    });

    // 恢复已持久化的尺寸
    if (state.panelWidth !== 960) panel.style.width = state.panelWidth + 'px';
    if (state.panelHeight !== 640) panel.style.height = state.panelHeight + 'px';
  })();

})();
