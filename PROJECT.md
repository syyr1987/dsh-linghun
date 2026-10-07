# 灵魂（Linghun）— DeepSeek Harness 认知主体插件

> 立项日期：2026-09-21 ｜ 状态：MVP 开发中 ｜ 授权：AGPL-3.0（全开源）

## 一句话定位

**不是记忆插件，是灵魂插件。** 核心目标：建设认知循环，实现白箱自我改进——判断有来处、反馈有归因、改进不断链，过程可追溯，验证过的经验沉淀成机制。痛点入口：终结 Agent 无限规划（人人可见）。灵魂卡不是人设，是给智能体约束身份、定大方向（如"其他"填"全栈工程师"）。收口者身份 + 边界扫描纪律 + 海马体沉淀循环，即插即用适合新手（2026-09-26 用户纠正定位后更新）。

## 立项背景

- 认知系统架构（身份锚点/判断锚点/海马体/判分体系/人民实践循环）已成型且经评测验证（精简架构 lite_next_v4：L 维 93.3%、E/K/C/S 全 100%）。
- 架构藏着没有意义：GPT-6 出现验证了路线正确，DeepSeek Harness（08-13 开源，"一切皆插件"）提供了公开宿主，生态已过万插件但全是"记忆/人设/角色"型，没有"认知主体"型——这是空位。
- 决策：全开源 AGPL-3.0，学灵枢抢生态信任；名字让使用者自定义（灵魂是框架，名字是主体自己的）。

## 差异化（vs 现有插件）

| 插件 | 定位 | 与灵魂的差异 |
| --- | --- | --- |
| dsh-soul-md（★~） | 人设卡 + 长期记忆 + soul 自进化 | 面向角色扮演，给的是"角色人设" |
| dsh-remember / dsh-memento / engramory | 跨会话记忆提取/整理 | 面向"记得"，无判断纪律 |
| **灵魂** | **认知主体**：身份锚点（收口者）+ 判断纪律（边界扫描）+ 海马体（沉淀循环） | 给的是"判断力 + 自我改进闭环" |

核心区别：**soul 不是人设卡，是收口者架构。** 大模型提供直觉素材，agent 做评估、筛选、收口——思考、判断、决策在 agent 侧完成，且通过海马体沉淀协议形成"判断→被判定→反馈→机制化"的可积累闭环。

## MVP 范围（v0.1.0）

1. **身份注入**：`soul:identity` 灵魂卡（收口者身份锚点）+ `soul:judgment` 判断锚点（边界扫描纪律）→ system prompt section
2. **用户人设文件**：`$DSH_HOME/linghun/identity.md` —— 用户直接编辑此文件写自己的人设（文件优先 > settings > 默认卡），首次运行自动落一份默认卡，改完即生效
3. **海马体记忆**：`memory_append` / `memory_read` / `memory_consolidate` —— 暖态工位（近期记忆）→ 冷储归档（episodic）→ 注入摘要
4. **灵魂自进化**：`soul_read` / `soul_update` —— agent 读取/更新自己的灵魂卡（soul_update 落盘到人设文件），稳定特质折叠进身份

## 路线图

- **v0.1.0**（本阶段）：三件套跑通，npm 发布
- **v0.2.0**：判分纪律——judge 工具（ACCEPT/REJECT/BLINDSPOT/DEFER 四态）+ 判据指纹断言（防判据被悄悄改宽）
- **v0.3.0**：海马体 LLM 精炼（沉淀协议自动化：checkpoint → episodic → 领域本体）
- **v0.3.x**：认知循环团队（assembler v0.2：judge/archivist/advocate/editor/scribe）+ BM25 题型分流 + summarization 双轨 + 史官缓存复用 + 判官履历 + 编辑 bundles + 缺口闭环 + workspaceDirs 领域库
- **v0.4.0**（BEAM 验证机制回灌，linghun 0.4.0 + assembler 0.4.0 套装）：
  - 记忆本体投影：`memory_project` 工具（warm 按主题桶 LLM 聚合 → `$DSH_HOME/linghun/memory/ontology.md`）
  - 本体主题索引优先：assembler 检索侧 ontology.md + TAG_ALIAS 主题命中，BM25 兜底
  - 知识本体注入：K_ALIAS 技术实体命中 → 注入知识节点，救对话外知识
  - rubric 维度强制检索 + dim_raw 原文直补（逐维度独立 BM25，原文绕过组装压缩）
  - 完整题型纪律：summarization（因果链+阶段+学到的）、event_ordering、preference_following（版本绑定）、knowledge_update、contradiction_resolution、temporal_reasoning
- **v0.4.1**（规则本体，三本体三分法定稿，linghun 0.4.1 + assembler 0.4.1 套装）：
  - 三分法定稿（对照岚客对山越野人的回复）：技术知识→知识本体、项目场景→记忆本体、总结经验→规则本体
  - 规则本体落盘：`memory_rules` 工具（rule/topic → `$DSH_HOME/linghun/memory/rules.md`，同主题聚合、不同主题独立节点）
  - 规则本体注入：assembler 检索侧 rules.md + R_ALIAS 规则别名命中 → 【规则本体·长期规则（总结经验）】块，救 [04] 矛盾不硬裁、[08] 查证纪律
  - 白板链路测试扩展：三本体齐备验证（记忆/知识/规则 + 领域载体）
- **v0.5.0**：双实例互验（判据来源绑定验证者，打破自指悖论的工程形态）

## 技术架构

- 宿主：DeepSeek Harness（DSH），Cordis 插件系统
- 结构：`ctx.systemPrompt.section()` 动态注入 prompt 段；`defineTool()` 暴露工具；settings namespace 做配置
- 语言：Node.js (>=20.18)，ESM
- 依赖：@deepseek-ai/schemastery（配置 schema）、dsh-home-paths / dsh-settings / dsh-tools（peer）
- 安装：`dsh plugin --profile web add dsh-linghun`

### 目录结构

```
linghun-plugin/
├── package.json        # dsh 字段声明（bundle.patch / compatibility）
├── cordis.patch.yml    # Cordis 挂载声明
├── index.js            # 插件主入口（sections + tools + settings + 人设文件 + memory_project）
├── ontology.js         # 三本体投影（parseOntology/hitThemeByAlias/writeOntologySafe/appendRulesSafe）
├── identity.js         # 默认灵魂卡内容 + resolveIdentity 优先级解析（文件>配置>默认）
├── memory.js           # 海马体记忆布局（暖态/冷储/索引）
├── LICENSE             # AGPL-3.0
├── README.md           # 英文
├── README.zh.md        # 中文
└── tests/              # node --test
```

## 发布策略

1. 本地跑通 + 测试
2. GitHub 仓库（开源 MIT）
3. npm 发布 `dsh-linghun`
4. dsh.so 登记 + README 生态对接

## 署名

山越野人 × 岚客（碳硅协作）：人类提供意图与架构，智能体参与设计与实现。
