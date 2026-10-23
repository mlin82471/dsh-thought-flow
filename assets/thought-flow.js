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
    blocks: [],
    isPaused: false,
    currentThoughtText: ''
  };

  // 创建 DOM 容器
  var root = document.createElement('div');
  root.id = 'tf-plugin-root';
  document.body.appendChild(root);

  // 1. 悬浮胶囊控制条
  var floatBar = document.createElement('div');
  floatBar.id = 'tf-float-bar';
  floatBar.innerHTML = `
    <div class="tf-pulse-dot"></div>
    <span style="font-size: 13px; font-weight: 600;">思考流</span>
    <span class="tf-badge" id="tf-block-count">0 节点</span>
  `;
  root.appendChild(floatBar);

  // 2. 核心毛玻璃面板
  var panel = document.createElement('div');
  panel.id = 'tf-flow-panel';
  panel.innerHTML = `
    <div class="tf-panel-header">
      <div class="tf-panel-title">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
        <span>思维链可视化流 (Apple Glass)</span>
      </div>
      <div class="tf-panel-actions">
        <button class="tf-btn-icon" id="tf-btn-clear" title="清空记录">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
        </button>
        <button class="tf-btn-icon" id="tf-btn-close" title="收起面板">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>
    </div>
    <div class="tf-blocks-container" id="tf-blocks-list">
      <div style="text-align: center; color: var(--tf-text-muted); font-size: 13px; margin-top: 40px;">
        等待新的推理流输入...
      </div>
    </div>
    <div class="tf-intervene-bar">
      <div class="tf-input-row">
        <input type="text" class="tf-input" id="tf-intervene-input" placeholder="输入人类指导意见，实时修正思考路线..." />
        <button class="tf-action-btn tf-btn-primary" id="tf-btn-submit-opinion">发送指导</button>
      </div>
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <button class="tf-action-btn tf-btn-danger" id="tf-btn-interrupt">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12"></rect></svg>
          <span id="tf-interrupt-label">打断思考</span>
        </button>
        <span style="font-size: 11px; color: var(--tf-text-muted);">点击方块可直接在线修改内容</span>
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
    state.blocks = [];
    renderBlocks();
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
      // 本地追加一条人工意见卡片
      state.blocks.push({
        id: 'block-human-' + Date.now(),
        step: '人类意见',
        title: '用户实时指导介入',
        content: val,
        isHuman: true
      });
      renderBlocks();
    }).catch(function(){});
  }
  btnSubmitOpinion.addEventListener('click', submitOpinion);
  inputOpinion.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') submitOpinion();
  });

  // 渲染思维方块列表
  function renderBlocks() {
    var list = document.getElementById('tf-blocks-list');
    var countBadge = document.getElementById('tf-block-count');
    countBadge.textContent = state.blocks.length + ' 节点';

    if (!state.blocks.length) {
      list.innerHTML = `<div style="text-align: center; color: var(--tf-text-muted); font-size: 13px; margin-top: 40px;">等待新的推理流输入...</div>`;
      return;
    }

    list.innerHTML = '';
    state.blocks.forEach(function (b, idx) {
      var card = document.createElement('div');
      card.className = 'tf-block-card';
      if (b.isHuman) {
        card.style.borderColor = 'var(--tf-success)';
        card.style.background = 'rgba(52, 199, 89, 0.08)';
      }
      card.innerHTML = `
        <div class="tf-block-header">
          <div class="tf-block-tag">
            <span class="tf-block-step-num" style="${b.isHuman ? 'background: var(--tf-success);' : ''}">${b.step}</span>
            <span class="tf-block-title">${escapeHtml(b.title)}</span>
          </div>
          <button class="tf-btn-icon tf-btn-edit" style="width:22px;height:22px;" title="编辑修改此思考">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>
          </button>
        </div>
        <div class="tf-block-content">${escapeHtml(b.content)}</div>
      `;

      // 点击直接修改
      var editBtn = card.querySelector('.tf-btn-edit');
      var contentEl = card.querySelector('.tf-block-content');
      editBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (card.querySelector('.tf-block-editor')) return;
        var curContent = b.content;
        var textarea = document.createElement('textarea');
        textarea.className = 'tf-block-editor';
        textarea.value = curContent;
        contentEl.style.display = 'none';
        card.appendChild(textarea);
        textarea.focus();

        textarea.addEventListener('blur', function () {
          var newVal = textarea.value.trim();
          if (newVal) {
            b.content = newVal;
            fetch('/dsh-thought-flow/action', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'edit_block', blockId: b.id, content: newVal })
            }).catch(function(){});
          }
          renderBlocks();
        });
      });

      list.appendChild(card);
    });

    // 自动滚到底部
    list.scrollTop = list.scrollHeight;
  }

  function escapeHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // 轮询或事件监听
  function pollSync() {
    fetch('/dsh-thought-flow/sync', { cache: 'no-store' })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data && data.blocks && data.blocks.length !== state.blocks.length) {
          state.blocks = data.blocks;
          renderBlocks();
        }
      })
      .catch(function () {})
      .finally(function () {
        setTimeout(pollSync, 1200);
      });
  }
  pollSync();
})();
