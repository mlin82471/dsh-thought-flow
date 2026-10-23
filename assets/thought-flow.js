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
    
    <!-- 详情/编辑 Modal 对话框 -->
    <div id="tf-modal-overlay">
      <div class="tf-modal-dialog">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <b id="tf-modal-title" style="font-size:15px;">操作思考方块</b>
          <button class="tf-btn-icon" id="tf-modal-close">✕</button>
        </div>
        <textarea class="tf-modal-textarea" id="tf-modal-text"></textarea>
        <div style="display:flex; justify-content:flex-end; gap:10px;">
          <button class="tf-action-btn" id="tf-modal-cancel" style="background:rgba(0,0,0,0.06);">取消</button>
          <button class="tf-action-btn tf-btn-primary" id="tf-modal-save">保存修改</button>
        </div>
      </div>
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

  // Modal 弹窗交互
  var modalOverlay = document.getElementById('tf-modal-overlay');
  var modalText = document.getElementById('tf-modal-text');
  var modalTitle = document.getElementById('tf-modal-title');
  document.getElementById('tf-modal-close').addEventListener('click', closeModal);
  document.getElementById('tf-modal-cancel').addEventListener('click', closeModal);
  function closeModal() {
    modalOverlay.classList.remove('active');
    state.editingBlock = null;
  }
  document.getElementById('tf-modal-save').addEventListener('click', function () {
    if (!state.editingBlock) return;
    var newVal = modalText.value.trim();
    if (newVal) {
      state.editingBlock.content = newVal;
      fetch('/dsh-thought-flow/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'edit_block', blockId: state.editingBlock.id, content: newVal })
      }).catch(function(){});
    }
    closeModal();
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

  // 渲染所有多轮思考（第1次思考 -> 第2次思考 -> 第3次思考...）
  function renderRounds() {
    var container = document.getElementById('tf-blocks-list');
    var tabs = document.getElementById('tf-round-tabs');
    var indicator = document.getElementById('tf-indicator');

    var rounds = state.rounds || [];
    if (!rounds.length) {
      container.innerHTML = `<div style="text-align: center; color: var(--tf-text-muted); font-size: 13px; margin-top: 50px;">等待思维链启动推演...</div>`;
      tabs.innerHTML = '';
      indicator.textContent = '准备就绪';
      return;
    }

    indicator.textContent = `第 ${rounds.length} 轮思考`;

    // 渲染顶部轮次切换 Tab
    tabs.innerHTML = '';
    rounds.forEach(function (r, rIdx) {
      var tab = document.createElement('div');
      tab.className = 'tf-round-tab' + (rIdx === state.activeRoundIndex ? ' active' : '');
      tab.textContent = r.title || `思考 #${rIdx + 1}`;
      tab.addEventListener('click', function () {
        state.activeRoundIndex = rIdx;
        renderRounds();
      });
      tabs.appendChild(tab);
    });

    container.innerHTML = '';

    // 展示历史与当前思考
    rounds.forEach(function (r, rIdx) {
      var isCurrent = (rIdx === state.activeRoundIndex);
      var group = document.createElement('div');
      group.className = 'tf-round-section';
      if (!isCurrent) {
        group.style.opacity = '0.75';
      }

      var header = document.createElement('div');
      header.className = 'tf-round-badge';
      header.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"></polyline></svg>
        <span>${escapeHtml(r.title)}</span>
        <span style="font-size:11px; opacity:0.6; font-weight:normal;">(${r.blocks.length} 个思维方块)</span>
      `;
      group.appendChild(header);

      var row = document.createElement('div');
      row.className = 'tf-round-row';

      if (!r.blocks.length) {
        row.innerHTML = `<span style="font-size:12px; color:var(--tf-text-muted); padding:8px 0;">该轮次暂无思考节点</span>`;
      } else {
        r.blocks.forEach(function (b, bIdx) {
          // 渲染方块
          var card = document.createElement('div');
          card.className = 'tf-block-card';
          card.draggable = true;

          if (b.isHuman) {
            card.style.borderColor = 'var(--tf-success)';
            card.style.background = 'rgba(52, 199, 89, 0.08)';
          }

          card.innerHTML = `
            <div class="tf-block-header">
              <div class="tf-block-tag">
                <span class="tf-block-num" style="${b.isHuman ? 'background: var(--tf-success);' : ''}">${b.step}</span>
                <span class="tf-block-title">${escapeHtml(b.title)}</span>
              </div>
              <button class="tf-btn-icon tf-block-btn-edit" style="width:22px;height:22px;" title="查看/编辑详细思考">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>
              </button>
            </div>
            <div class="tf-block-content" title="点击查看详情与直接修改">${escapeHtml(b.content)}</div>
            <div class="tf-block-footer">
              <span style="font-size:10.5px; color:var(--tf-text-muted);">步骤 ${bIdx + 1}</span>
              <button class="tf-action-link tf-open-modal">编辑 / 介入</button>
            </div>
          `;

          // 拖拽排序/移动交互
          card.addEventListener('dragstart', function (e) {
            e.dataTransfer.setData('text/plain', JSON.stringify({ rIdx: rIdx, bIdx: bIdx }));
          });
          card.addEventListener('dragover', function (e) {
            e.preventDefault();
          });
          card.addEventListener('drop', function (e) {
            e.preventDefault();
            try {
              var data = JSON.parse(e.dataTransfer.getData('text/plain'));
              if (data.rIdx === rIdx && data.bIdx !== bIdx) {
                var item = r.blocks.splice(data.bIdx, 1)[0];
                r.blocks.splice(bIdx, 0, item);
                renderRounds();
              }
            } catch (err) {}
          });

          // 点击打开详情 Modal
          function openBlockModal() {
            state.editingBlock = b;
            modalTitle.textContent = `${r.title} - ${b.title}`;
            modalText.value = b.content;
            modalOverlay.classList.add('active');
            modalText.focus();
          }
          card.querySelector('.tf-block-content').addEventListener('click', openBlockModal);
          card.querySelector('.tf-block-btn-edit').addEventListener('click', openBlockModal);
          card.querySelector('.tf-open-modal').addEventListener('click', openBlockModal);

          row.appendChild(card);

          // 步骤之间的箭头连接
          if (bIdx < r.blocks.length - 1) {
            var arrow = document.createElement('div');
            arrow.className = 'tf-flow-arrow';
            arrow.innerHTML = `
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
            `;
            row.appendChild(arrow);
          }
        });
      }

      group.appendChild(row);
      container.appendChild(group);
    });

    if (container.lastElementChild) {
      container.scrollTop = container.scrollHeight;
    }
  }

  function escapeHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // 轮询或事件监听
  function pollSync() {
    fetch('/dsh-thought-flow/sync', { cache: 'no-store' })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data && data.rounds) {
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
