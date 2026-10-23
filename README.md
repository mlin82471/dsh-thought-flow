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

4. **强制中文约束**：
   - 系统级注入中文思考规则，确保 Reasoning 过程全程保持纯正中文。

5. **无缝集成与随时开关**：
   - 右下角精美悬浮胶囊控制条，支持一键呼出与折叠。

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
