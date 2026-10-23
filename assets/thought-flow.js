(function () {
  if (window.__dshThoughtFlowLoaded) return;
  window.__dshThoughtFlowLoaded = true;

  // 动态引入样式
  var link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/dsh-thought-flow/thought-flow.css';
  document.head.appendChild(link);

  var state = {
    enabled: true,
    visible: false,
    rounds: [],
    activeRoundIndex: 0,
    isPaused: false,
    editingBlock: null
  };

  // 创建 DOM 容器
  var root = document.createElement('div');
  root.id = 'tf-plugin-root';
  document.body.appendChild(root);

  // 1. 悬浮胶囊控制条 (靠左停靠)
  var floatBar = document.createElement('div');
  floatBar.id = 'tf-float-bar';
  floatBar.innerHTML = `
    <div class="tf-pulse-dot"></div>
    <span style="font-size: 13px; font-weight: 600;">思维流</span>
    <span class="tf-round-indicator" id="tf-indicator">第 1 轮思考</span>
  `;
  root.appendChild(floatBar);

  // 2. 核心毛玻璃画板面板
  var panel = document.createElement('div');
  panel.id = 'tf-flow-panel';
  panel.innerHTML = `
    <div class="tf-panel-header">
      <div class="tf-panel-title">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
        <span>思维链沉淀画板</span>
      </div>
      <div class="tf-round-tabs" id="tf-round-tabs">
        <!-- 动态轮次 Tab -->
      </div>
      <div class="tf-panel-actions">
        <button class="tf-btn-icon" id="tf-btn-clear" title="清空画板">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
        </button>
        <button class="tf-btn-icon" id="tf-btn-close" title="收起面板">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>
    </div>
    <div class="tf-blocks-container" id="tf-blocks-list">
      <div style="text-align: center; color: var(--tf-text-muted); font-size: 13px; margin-top: 50px;">
        等待思维链启动推演...
      </div>
    </div>
    <div class="tf-intervene-bar">
      <input type="text" class="tf-input" id="tf-intervene-input" placeholder="针对当前思考路线提出指导意见，实时修正..." />
      <button class="tf-action-btn tf-btn-primary" id="tf-btn-submit-opinion">发送指导</button>
      <button class="tf-action-btn tf-btn-danger" id="tf-btn-interrupt">
        <span id="tf-interrupt-label">打断思考</span>
      </button>
    </div>
  `;
  root.appendChild(panel);

  // 绑定交互
  floatBar.addEventListener('click', function () {
    state.visible = !state.visible;
    panel.classList.toggle('tf-visible', state.visible);
  });

  document.getElementById('tf-btn-close').addEventListener('click', function () {
    state.visible = false;
    panel.classList.remove('tf-visible');
  });

  document.getElementById('tf-btn-clear').addEventListener('click', function () {
    state.rounds = [];
    state.activeRoundIndex = 0;
    fetch('/dsh-thought-flow/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'clear' })
    }).catch(function(){});
    renderRounds();
  });

  // 打断/恢复
  var btnInterrupt = document.getElementById('tf-btn-interrupt');
  var lblInterrupt = document.getElementById('tf-interrupt-label');
  btnInterrupt.addEventListener('click', function () {
    state.isPaused = !state.isPaused;
    if (state.isPaused) {
      lblInterrupt.textContent = '已暂停推演 (点击继续)';
      btnInterrupt.style.background = 'rgba(52, 199, 89, 0.2)';
      btnInterrupt.style.color = 'var(--tf-success)';
      fetch('/dsh-thought-flow/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'pause' })
      }).catch(function(){});
    } else {
      lblInterrupt.textContent = '打断思考';
      btnInterrupt.style.background = '';
      btnInterrupt.style.color = '';
      fetch('/dsh-thought-flow/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resume' })
      }).catch(function(){});
    }
  });

  // 发送意见
  var inputOpinion = document.getElementById('tf-intervene-input');
  var btnSubmitOpinion = document.getElementById('tf-btn-submit-opinion');
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
      renderRounds();
    }).catch(function(){});
  }
  btnSubmitOpinion.addEventListener('click', submitOpinion);
  inputOpinion.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') submitOpinion();
  });

  // 渲染水平多轮推演画板（第一次思考 -> 第二次思考 -> 第三次思考...）
  function renderRounds() {
    var container = document.getElementById('tf-blocks-list');
    var tabs = document.getElementById('tf-round-tabs');
    var indicator = document.getElementById('tf-indicator');

    var rounds = state.rounds || [];
    if (!rounds.length) {
      container.innerHTML = `<div style="text-align: center; color: var(--tf-text-muted); font-size: 13px; margin: auto;">等待思维链启动推演...</div>`;
      tabs.innerHTML = '';
      indicator.textContent = '准备就绪';
      return;
    }

    indicator.textContent = `第 ${rounds.length} 轮思考`;

    // 渲染顶部轮次快捷指示
    tabs.innerHTML = '';
    rounds.forEach(function (r, rIdx) {
      var tab = document.createElement('div');
      tab.className = 'tf-round-tab' + (rIdx === state.activeRoundIndex ? ' active' : '');
      tab.textContent = r.title || `第 ${rIdx + 1} 次思考`;
      tab.addEventListener('click', function () {
        state.activeRoundIndex = rIdx;
        var col = document.getElementById('tf-round-col-' + rIdx);
        if (col) col.scrollIntoView({ behavior: 'smooth', inline: 'center' });
      });
      tabs.appendChild(tab);
    });

    container.innerHTML = '';

    // 水平生成各个思考轮次大卡片
    rounds.forEach(function (r, rIdx) {
      var col = document.createElement('div');
      col.className = 'tf-round-column';
      col.id = 'tf-round-col-' + rIdx;

      // 卡片顶部标题
      var colHeader = document.createElement('div');
      colHeader.className = 'tf-round-col-header';
      colHeader.innerHTML = `
        <div class="tf-round-col-title">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"></polyline></svg>
          <span>${escapeHtml(r.title)}</span>
        </div>
        <span style="font-size:11px; opacity:0.65; color:var(--tf-text-muted);">${r.blocks.length} 个核心要点</span>
      `;
      col.appendChild(colHeader);

      // 卡片内部的思考要点列表
      var subList = document.createElement('div');
      subList.className = 'tf-sub-blocks-list';

      if (!r.blocks.length) {
        subList.innerHTML = `<span style="font-size:12px; color:var(--tf-text-muted); margin:auto;">推演生成中...</span>`;
      } else {
        r.blocks.forEach(function (b, bIdx) {
          var card = document.createElement('div');
          card.className = 'tf-block-card';

          if (b.isHuman) {
            card.style.borderColor = 'var(--tf-success)';
            card.style.background = 'rgba(52, 199, 89, 0.1)';
          }

          card.innerHTML = `
            <div class="tf-block-header">
              <div class="tf-block-tag">
                <span class="tf-block-step-num" style="${b.isHuman ? 'background: var(--tf-success);' : ''}">${b.step}</span>
                <span class="tf-block-title">${escapeHtml(b.title)}</span>
              </div>
            </div>
            <div class="tf-block-content" contenteditable="true" spellcheck="false">${escapeHtml(b.content)}</div>
          `;

          // 直接上手编辑修改：失焦时保存
          var contentEl = card.querySelector('.tf-block-content');
          contentEl.addEventListener('blur', function () {
            var newVal = contentEl.innerText.trim();
            if (newVal && newVal !== b.content) {
              b.content = newVal;
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
      container.appendChild(col);

      // 如果有后续轮次，渲染中间的水平大衔接箭头
      if (rIdx < rounds.length - 1) {
        var conn = document.createElement('div');
        conn.className = 'tf-round-connector';
        conn.innerHTML = `
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="4" y1="12" x2="20" y2="12"></line><polyline points="14 6 20 12 14 18"></polyline></svg>
        `;
        container.appendChild(conn);
      }
    });

    // 默认滑向最右侧最新的思考大卡片
    container.scrollLeft = container.scrollWidth;
  }

  function escapeHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // 轮询或事件监听
  var wasThinking = false;
  function pollSync() {
    fetch('/dsh-thought-flow/sync', { cache: 'no-store' })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (!data) return;

        // 只有正在思考时自动展开；思考完后若想再看需手动点击
        if (data.isThinking && !wasThinking) {
          state.visible = true;
          panel.classList.add('tf-visible');
        } else if (!data.isThinking && wasThinking) {
          state.visible = false;
          panel.classList.remove('tf-visible');
        }
        wasThinking = !!data.isThinking;

        if (data.rounds) {
          var roundsJson = JSON.stringify(data.rounds);
          if (roundsJson !== JSON.stringify(state.rounds)) {
            state.rounds = data.rounds;
            if (state.activeRoundIndex >= state.rounds.length) {
              state.activeRoundIndex = Math.max(0, state.rounds.length - 1);
            }
            renderRounds();
          }
        }
      })
      .catch(function () {})
      .finally(function () {
        setTimeout(pollSync, 1200);
      });
  }
  pollSync();
})();
