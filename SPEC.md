# SPEC: dsh-thought-flow (DSH 思考流可视化与干预插件)

## 1. 目标与定位
为 DeepSeek Harness (DSH) 提供高级的思维链 (Reasoning) 可视化、干预与中文语言约束插件。
- 视觉风格：Apple macOS/iOS 磨砂玻璃（Frosted Glass / Liquid Acrylic 拟物美学、微光边框、平滑弹簧动效）。
- 思维可视化：单轮或多步骤思考自动分段解析为由浅入深推进的“思维方块链 (Thought Blocks)”。
- 人机共生交互：
  1. 随时打断/暂停并输入人类指导意见；
  2. 随时点击任意方块直接编辑修改思考内容；
  3. 支持插件总开关与全局一键折叠/展开。
- 语言保证：通过 System Prompt 注入强制模型思维与表达统一使用中文输出。

## 2. 架构设计与技术栈
- **后端架构 (Cordis Plugin)**：
  - 包名：`dsh-thought-flow`
  - 接入层：通过 `system-prompt/assemble` 与 `ctx.on('session/event')` 捕获推理流，并注入强制中文提示词。
  - Web 桥接：注册 `/dsh-thought-flow/*` 路由，并使用 `webserver/index-inject` 将前端注入脚本加载入 DSH 客户端。
  - 状态同步：提供实时思考流与用户干预命令（打断、修改、追加意图）双向 REST/轮询或 WebSocket 通道。
- **前端架构 (Vanilla ES6 + Modern CSS Glassmorphism)**：
  - 零外部重量级依赖，保证渲染极致流畅与高帧率。
  - 玻璃拟态特效：`backdrop-filter: blur(24px) saturate(180%)`，高光倒角，动态高斯模糊。
  - 动效：Spring-like bezier 动画（cubic-bezier(0.25, 1, 0.5, 1)），思维方块依次推入并附带脉冲光效。

## 3. 验收标准
1. [ ] 插件满足 DSH Cordis bundle 契约（包含 package.json, cordis.patch.yml, lib/index.js, assets/ 等）。
2. [ ] 前端包含完整苹果毛玻璃风格组件，可自由开关、移动/折叠。
3. [ ] 思考步骤切分为可视化方块流程（第一阶段 -> 第二阶段），支持点击展开/直接编辑。
4. [ ] 具备“打断/批注”、“继续生成”、“注入新指导意见”的功能面板。
5. [ ] 包含完整的单元测试与端到端模拟测试。
