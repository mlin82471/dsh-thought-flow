# dsh-thought-flow

> DeepSeek Harness (DSH) 苹果毛玻璃质感思考流可视化与实时人机干预插件。

## ✨ 特性亮点

1. **思维方块链 (Progressive Thought Blocks)**：
   - 将模型复杂的单轮与多步推理过程，智能拆解为由浅入深、逻辑清晰的方块流。
   - 随思考逐步推入下一个方块，动效流畅丝滑。

2. **Apple 磨砂玻璃美学 (Frosted Glass Acrylic)**：
   - 采用苹果风格高斯模糊 (`backdrop-filter`)、高光倒角边缘与微投影。
   - 自适应 Dark / Light 深浅色模式。

3. **实时人机干预 (Human-in-the-loop)**：
   - **打断/暂停**：随时一键暂停当前推演。
   - **直接上手修改**：点击任意方块上的编辑按钮，可直接原地修改思考内容。
   - **插入指导意见**：随时追加人类意图，校准思考方向。

4. **强制中文约束与防膨胀**：
   - 系统级注入中文思考规则，确保 Reasoning 过程全程保持纯正中文。
   - 具备幂等去重检查，避免多轮装配时 System Prompt 指令无限叠加。

5. **实时人机干预与会话真正打断**：
   - **真实打断/暂停**：与底层 `session.abort()` / `session.cancel()` 深度打通，打断时真正中止模型推演请求。
   - **用户指导意见注入**：前端提交的指导建议直接进入下一次 `system-prompt/assemble`，真正指导后续模型生成。
   - **直接原地编辑**：点击任意方块原地修改思考内容，具备富文本纯文本清洗与防 XSS 保护。

6. **高性能增量渲染与离线持久化**：
   - 去除全量 DOM 销毁重建，增加轻量签名比对与输入焦点保护。
   - 前端集成 `localStorage` 状态持久化，刷新后自动恢复。
   - 思考结束后面板保持打开，供用户从容审阅。

7. **健康诊断与日志聚合**：
   - 提供 `/dsh-thought-flow/status` 诊断接口与轻量级环形日志缓冲。

## 🌐 接口协议

- `GET  /dsh-thought-flow/thought-flow.js`：前端脚本分发
- `GET  /dsh-thought-flow/thought-flow.css`：苹果毛玻璃样式表
- `GET  /dsh-thought-flow/sync`：实时思考轮次与状态同步
- `GET  /dsh-thought-flow/stream`：Server-Sent Events (SSE) 实时流式推送
- `POST /dsh-thought-flow/action`：控制操作（`pause`, `resume`, `opinion`, `edit_block`, `clear`）
- `GET  /dsh-thought-flow/status`：插件运行统计与错误日志

## 📦 安装与挂载

进入当前 DSH desktop profile 目录或通过软链接挂载：

```bash
cd ~/.dsh/profiles/desktop
pnpm add link:C:/Users/linhr/code/dsh-thought-flow
```

并在 `~/.dsh/profiles/desktop/package.json` 的 `dsh.profile.bundles` 中加入：
```json
"bundles": [
  "...",
  "dsh-thought-flow"
]
```
