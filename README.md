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

## 🧠 长期记忆（Hermes 风格双层冻结快照）

参考 [Hermes Agent](https://github.com/NousResearch/hermes-agent) 的生产级记忆设计，实现两层有界记忆：

| 层 | 文件 | 上限 | 内容 |
|---|---|---|---|
| `MEMORY` | `~/.dsh/thought-flow/memory/MEMORY.md` | 2200 字符 | 项目上下文、环境事实、踩坑经验 |
| `USER` | `~/.dsh/thought-flow/memory/USER.md` | 1375 字符 | 用户偏好、沟通习惯 |

**四个省 token 的机制**：

1. **硬性字符上限** —— 有界记忆本身就是压缩，迫使主动策展而非无限堆砌
2. **格式稳定** —— 条目顺序与快照格式固定，System Prompt 前缀不变，prefix cache 才能命中
3. **空则零开销** —— 没有记忆时不注入任何 section
4. **使用率可视** —— 快照头部显示 `[7% — 166/2,200 chars]`，模型知道还剩多少空间

写入采用 `§` 分节号分隔，超限时返回可诊断信息（当前用量、超出量、合并建议），而不是静默丢弃。

## ❓ 任务前澄清提问

注入一段澄清策略，引导模型在动手前对**会改变实现方向**的关键歧义主动反问：

- **会问**：需求有多种合理解读、涉及删除用户数据、不可逆操作、交付物形态不明
- **不会问**：答案能通过读代码自行确认、用户指令已明确、纯实现细节
- 一次最多 2 个问题，每个给出 2-3 个选项并把推荐项放第一位
- 可在记忆面板底部的开关里随时关闭

## 🌐 接口协议

- `GET  /dsh-thought-flow/thought-flow.js`：前端脚本分发
- `GET  /dsh-thought-flow/thought-flow.css`：苹果毛玻璃样式表
- `GET  /dsh-thought-flow/sync`：实时思考轮次与状态同步
- `GET  /dsh-thought-flow/stream`：Server-Sent Events (SSE) 实时流式推送
- `POST /dsh-thought-flow/action`：控制操作（`pause`, `resume`, `opinion`, `edit_block`, `clear`）
- `GET  /dsh-thought-flow/status`：插件运行统计与错误日志
- `GET  /dsh-thought-flow/memory`：读取双层记忆用量与全部条目
- `POST /dsh-thought-flow/memory`：记忆操作（`add` / `replace` / `remove` / `clear` / `toggle_clarify`）

## 📦 安装与挂载

### 方式一：直接在线安装（推荐）

通过 DSH 自带的插件管理命令一键拉取并安装：

```bash
dsh plugin --profile desktop add https://github.com/mlin82471/dsh-thought-flow.git
```

> **说明**：DSH 内置包管理器会自动解析依赖并将插件注册到 `desktop` profile 中，无需手动修改任何配置文件。

---

### 方式二：本地克隆与开发挂载

如果你想对插件代码进行本地调试与二次开发：

```bash
# 1. 克隆代码仓库
git clone https://github.com/mlin82471/dsh-thought-flow.git
cd dsh-thought-flow

# 2. 通过 DSH 原生 link 命令软链挂载到 desktop profile
# Linux / macOS / Git Bash:
dsh plugin --profile desktop add link:$(pwd)

# Windows PowerShell:
dsh plugin --profile desktop add link:$PWD

# Windows CMD:
dsh plugin --profile desktop add link:%cd%
```

---

### 验证与卸载

- **查看已安装插件**：
  ```bash
  dsh plugin --profile desktop list
  ```
- **卸载插件**：
  ```bash
  dsh plugin --profile desktop remove dsh-thought-flow
  ```
