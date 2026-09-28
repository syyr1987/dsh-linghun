/**
 * 灵魂（Linghun）— 认知主体插件 for DeepSeek Harness
 *
 * 不是记忆/人设插件：给 agent 一套「收口者身份 + 边界判断纪律 + 海马体沉淀循环」，
 * 让 agent 成为有判断力、有纪律、会自我改进的认知主体。
 *
 * prompt sections:
 *   soul:identity  — 灵魂卡（身份锚点：收口者架构）
 *   soul:judgment  — 判断纪律（边界扫描）
 *   soul:memory    — 海马体记忆注入（冷储摘要 + 暖态近期 + 归档索引）
 *
 * tools:
 *   soul_read / soul_update      — 灵魂自进化（读/更新自己的灵魂卡）
 *   memory_append / memory_read / memory_consolidate — 海马体（记/读/沉淀）
 */
import { readFileSync, statSync } from "node:fs";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import z from "@deepseek-ai/schemastery";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { DEFAULT_IDENTITY, DEFAULT_JUDGMENT, DEFAULT_USER_CARD, resolveIdentity } from "./identity.js";
import { createMemoryLayout, parseWarm, renderWarmEntries, touchWarmAccessText } from "./memory.js";

const name = "linghun";
const inject = ["systemPrompt", "tools"];
const NS = "linghun";

const SECTION_IDENTITY = "soul:identity";
const SECTION_JUDGMENT = "soul:judgment";
const SECTION_MEMORY = "soul:memory";

const MEMORY_DIR = join("linghun", "memory");
/** 用户人设文件：$DSH_HOME/linghun/identity.md —— 用户自己写人设的地方，文件优先。 */
const IDENTITY_FILE = join("linghun", "identity.md");

/** 从灵魂卡文件文本解析「名字：xxx」；找不到返回 null。 */
function parseName(text) {
  if (!text) return null;
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*名字[:：]\s*(.+?)\s*$/);
    if (m && m[1] && m[1] !== "（你的名字或称呼）") return m[1];
  }
  return null;
}

const Config = z.object({
  identity: z.object({
    /** 灵魂名字：留空则只用默认卡片内容；填写后追加为「我的名字」。 */
    name: z.string().default(""),
    /** 灵魂卡内容（身份锚点）。 */
    content: z.string().default(""),
    enabled: z.boolean().default(true),
    order: z.number().default(0),
    /** soul_update 拒绝超过此大小（字节）。 */
    maxBytes: z.number().default(64 * 1024),
  }),
  judgment: z.object({
    enabled: z.boolean().default(true),
    order: z.number().default(0.2),
  }),
  memory: z.object({
    enabled: z.boolean().default(true),
    inject: z.boolean().default(true),
    injectMaxChars: z.number().default(6000),
    order: z.number().default(0.5),
    /** 时间权重：暖态注入按 last_access（最后一次被调用）新→旧排序，吃灰的沉底被裁出注入。 */
    timeWeight: z.boolean().default(true),
    /** warm.md 上限（字节），超出先 consolidate。 */
    maxBytes: z.number().default(1024 * 1024),
    /** 收尾评估：每轮对话结束由工程强制触发一次「有没有值得沉淀」的 LLM 评估，不依赖模型自觉。 */
    assessment: z.object({
      enabled: z.boolean().default(true),
      /** 送入评估的对话文本上限（字符）。 */
      maxChars: z.number().default(4000),
      /** 评估输出上限（token）。 */
      maxTokens: z.number().default(300),
      temperature: z.number().default(0.2),
    }).default({}),
    /** 阈值自动沉淀：暖态达到 maxBytes*triggerRatio 时自动 consolidate 再写入，模型无感知。 */
    autoConsolidate: z.object({
      enabled: z.boolean().default(true),
      triggerRatio: z.number().default(0.8),
    }).default({}),
  }),
});

function apply(ctx, config) {
  let sourceGetter = null;
  /** mtime-keyed text cache：稳定段落保持 byte-identical（KV-cache 友好）。 */
  const fileCache = new Map();

  const cfg = () => (sourceGetter ? sourceGetter() : config);

  /** 同步 mtime 缓存读取；缺失/不可读返回 null。 */
  const readCached = (file) => {
    try {
      const st = statSync(file);
      const hit = fileCache.get(file);
      if (hit && hit.mtimeMs === st.mtimeMs) return hit.text;
      const text = readFileSync(file, "utf8");
      fileCache.set(file, { mtimeMs: st.mtimeMs, text });
      return text;
    } catch {
      return null;
    }
  };

  const memoryDir = () => join(resolveDshHome(), MEMORY_DIR);
  const identityFile = () => join(resolveDshHome(), IDENTITY_FILE);
  const layout = createMemoryLayout(memoryDir, readCached);

  // ── prompt sections（function text：按 assembly 动态解析）──────────────
  const renderIdentity = () => {
    const c = cfg();
    if (c.identity?.enabled === false) return "";
    const content = resolveIdentity({
      fileText: readCached(identityFile()),
      configContent: c.identity?.content,
    });
    const soulName = (c.identity?.name ?? "").trim();
    return soulName ? `${content}\n\n> 我的名字：${soulName}` : content;
  };
  const renderJudgment = () =>
    cfg().judgment?.enabled === false ? "" : DEFAULT_JUDGMENT;
  const renderMemory = () => {
    const c = cfg();
    if (c.memory?.enabled === false || c.memory?.inject === false) return "";
    return layout.renderForInject(c.memory?.injectMaxChars, {
      timeWeight: c.memory?.timeWeight,
    });
  };

  const sectionDisposers = { identity: null, judgment: null, memory: null };
  function registerSections() {
    for (const key of Object.keys(sectionDisposers)) {
      if (sectionDisposers[key]) {
        sectionDisposers[key]();
        sectionDisposers[key] = null;
      }
    }
    sectionDisposers.identity = ctx.systemPrompt.section({
      name: SECTION_IDENTITY,
      order: cfg().identity?.order ?? 0,
      text: renderIdentity,
    });
    sectionDisposers.judgment = ctx.systemPrompt.section({
      name: SECTION_JUDGMENT,
      order: cfg().judgment?.order ?? 0.2,
      text: renderJudgment,
    });
    sectionDisposers.memory = ctx.systemPrompt.section({
      name: SECTION_MEMORY,
      order: cfg().memory?.order ?? 0.5,
      text: renderMemory,
    });
  }

  /** 首次运行：在人设目录放一份默认灵魂卡（幂等，已有文件则不动，尊重用户编辑）。 */
  const ensureIdentityFile = async () => {
    try {
      const file = identityFile();
      await ensureParent(file);
      try {
        readFileSync(file, "utf8");
      } catch {
        await writeFile(file, DEFAULT_USER_CARD.trimEnd() + "\n", "utf8");
        fileCache.delete(file);
      }
    } catch {
      // 非致命：写不进去就继续用默认卡 / 配置内容
    }
  };

  ctx.effect(() => {
    void ensureIdentityFile();
    registerSections();
    return () => {
      for (const key of Object.keys(sectionDisposers)) {
        if (sectionDisposers[key]) {
          sectionDisposers[key]();
          sectionDisposers[key] = null;
        }
      }
    };
  }, "linghun.sections()");

  // ── settings-backed configuration ──────────────────────────────────────
  // 兼容 dsh-settings 0.1.1（模块导出）与 0.1.2+（ctx.settings）。
  const installSettingsSectionCompat = (ns, schema, entry, hooks) => {
    ctx.inject(["settings"], (sctx) => {
      const scope = sctx.settings.register(ns, schema, { base: entry });
      hooks.setSource(() => scope.get());
      sctx.effect(() => () => {
        hooks.setSource(() => entry);
        hooks.onChange();
      });
      hooks.onChange();
      scope.watch(() => {
        hooks.onChange();
      });
    });
  };
  installSettingsSectionCompat(NS, Config, config, {
    setSource: (getter) => {
      sourceGetter = getter;
    },
    onChange: () => {
      registerSections();
    },
  });

  // 收尾评估要发起模型调用：先声明 llm 依赖，把服务引用存下来供事件回调使用
  let llmClient = null;
  ctx.inject(["llm"], (sctx) => {
    llmClient = sctx.llm;
    return () => {
      llmClient = null;
    };
  });

  // ── helpers ─────────────────────────────────────────────────────────────
  const ensureParent = async (file) => {
    await mkdir(dirname(file), { recursive: true });
  };
  const byteLen = (text) => Buffer.byteLength(text, "utf8");
  const nowStamp = () => {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const todayName = () => nowStamp().slice(0, 10);

  // ── 海马体：记 / 读 / 沉淀 ──────────────────────────────────────────────
  /** 归档暖态 → episodic/<日期>.md + 冷储摘要，然后清空暖态。工程层可复用（阈值沉淀/收尾评估共用）。 */
  const doConsolidate = async () => {
    const warm = layout.readWarm();
    if (!warm.trim()) return { archived: 0, warmCleared: true };
    const episodicFile = join(layout.episodicDir(), `${todayName()}.md`);
    const cold = layout.readCold();
    const coldNext = [cold.trim(), `## ${todayName()} 沉淀\n\n${warm.trim()}`]
      .filter(Boolean)
      .join("\n\n");
    await ensureParent(episodicFile);
    await writeFile(episodicFile, warm.trim() + "\n", "utf8");
    await ensureParent(layout.coldFile());
    await writeFile(layout.coldFile(), coldNext + "\n", "utf8");
    await writeFile(layout.warmFile(), "", "utf8");
    fileCache.delete(episodicFile);
    fileCache.delete(layout.coldFile());
    fileCache.delete(layout.warmFile());
    return { archived: byteLen(warm), warmCleared: true };
  };

  /** 写一条暖态记忆；开启 autoConsolidate 且达到阈值时先自动归档再写（模型无感知，不 throw）。 */
  const appendMemoryBlock = async (content, kind) => {
    const stamp = nowStamp();
    const block = `\n## ${stamp} [${kind}]\n\n${content}\n<!-- last_access: ${stamp} -->\n`;
    const file = layout.warmFile();
    const current = readCached(file) ?? "";
    let total = byteLen(current + block);
    const max = cfg().memory?.maxBytes ?? 1024 * 1024;
    const ac = cfg().memory?.autoConsolidate;
    if (ac?.enabled !== false) {
      const ratio = ac?.triggerRatio ?? 0.8;
      if (total > max * ratio) {
        await doConsolidate();
        const fresh = readCached(file) ?? "";
        total = byteLen(fresh + block);
      }
    }
    if (total > max) {
      throw new Error(`memory_append: 记忆超过上限（${max} 字节），先执行 memory_consolidate 沉淀`);
    }
    await ensureParent(file);
    await appendFile(file, block, "utf8");
    fileCache.delete(file);
    return { bytes: byteLen(block), totalBytes: total };
  };

  /** 标记「被用到」：匹配 ref 的暖态条目刷新 last_access（读≠用，用到才 touch）。 */
  const touchWarmAccess = async (ref) => {
    const file = layout.warmFile();
    const warm = readCached(file);
    if (!warm || !warm.trim()) return 0;
    const { text, touched } = touchWarmAccessText(warm, ref, nowStamp());
    if (text !== null) {
      await ensureParent(file);
      await writeFile(file, text, "utf8");
      fileCache.delete(file);
    }
    return touched;
  };

  ctx.tools.register(defineTool({
    name: "memory_append",
    description:
      "把一条带时间戳的 Markdown 记进海马体暖态工位（warm.md）。适合跨会话保留的事实、决策、偏好、经验。条目要简洁自包含，不要一次性倾倒。积累多了用 memory_consolidate 沉淀。",
    parameters: {
      kind: {
        type: "string",
        description: "条目类别：fact（事实）/ decision（决策）/ preference（偏好）/ experience（经验），默认 fact",
      },
      content: { type: "string", required: true, description: "要记住的 markdown 内容，简洁自包含" },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          bytes: { type: "integer" },
          totalBytes: { type: "integer" },
        },
      },
      render: (_args, value) => [
        { type: "text", text: `已记入海马体（${value.bytes} 字节，累计 ${value.totalBytes}）。` },
      ],
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const content = String(args.content ?? "").trim();
      if (!content) throw new Error("memory_append: `content` 不能为空");
      const kind = String(args.kind ?? "fact").trim() || "fact";
      return appendMemoryBlock(content, kind);
    },
    presentCall: (args) => ({ card: "generic", title: "海马体·记录", kind: "other", rawInput: args }),
  }));

  ctx.tools.register(defineTool({
    name: "memory_read",
    description:
      "读取海马体记忆：冷储摘要（cold.md）+ 暖态近期（warm.md）+ 归档索引。需要细节时可读完整内容。读≠用：读到的条目只有实际派上用场，才用 memory_touch 标记（标记=活跃，吃灰管理）。",
    parameters: {
      full: {
        type: "boolean",
        description: "true 返回完整内容（可能很长）；false 返回注入摘要，默认 false",
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          exists: { type: "boolean" },
          bytes: { type: "integer" },
          content: { type: "string" },
        },
      },
      render: (_args, value) => [
        {
          type: "text",
          text: value.exists
            ? `海马体记忆（${value.bytes} 字节）：\n${value.content}`
            : "海马体为空（尚无记忆）。",
        },
      ],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const c = cfg();
      const max = c.memory?.injectMaxChars ?? 6000;
      const useFull = args?.full === true;
      const cold = layout.readCold();
      const warm = renderWarmEntries(parseWarm(layout.readWarm()));
      const episodes = layout.listEpisodic();
      const parts = [];
      if (cold.trim()) parts.push(cold.trim());
      if (warm.trim()) parts.push(`## 近期记忆 / Recent\n\n${warm.trim()}`);
      if (episodes.length) {
        const rows = episodes
          .map((e) => `- ${e.name}${e.title ? ` — ${e.title}` : ""}`)
          .join("\n");
        parts.push(`## 归档索引 / Archive\n${rows}`);
      }
      const full = parts.join("\n\n");
      if (!full.trim()) return { exists: false, bytes: 0, content: "" };
      const limit = useFull ? 50000 : max;
      const truncated = full.length > limit;
      return {
        exists: true,
        bytes: byteLen(full),
        content: truncated ? `${full.slice(0, limit)}\n…(截断)…` : full,
      };
    },
  }));

  ctx.tools.register(defineTool({
    name: "memory_touch",
    description:
      "标记暖态记忆为「刚刚被用到」：传入该条记忆内容中的一段文字（ref），匹配到的条目 last_access 刷新为当前时间。读≠用——memory_read 读到的条目，只有实际派上用场的才 touch，这是吃灰管理的关键动作：一直不被用到的记忆会沉底、被挤出注入。",
    parameters: {
      ref: {
        type: "string",
        required: true,
        description: "要标记的记忆内容片段（出现在该条记忆里的一段文字，越独特越好）",
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          touched: { type: "integer" },
        },
      },
      render: (_args, value) => [
        { type: "text", text: `已标记 ${value.touched} 条记忆为活跃。` },
      ],
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const ref = String(args?.ref ?? "").trim();
      if (!ref) throw new Error("memory_touch: `ref` 不能为空");
      if (cfg().memory?.timeWeight === false) return { touched: 0 };
      try {
        const touched = await touchWarmAccess(ref);
        return { touched };
      } catch {
        return { touched: 0 };
      }
    },
    presentCall: (args) => ({ card: "generic", title: "海马体·标记活跃", kind: "other", rawInput: args }),
  }));

  ctx.tools.register(defineTool({
    name: "memory_consolidate",
    description:
      "海马体沉淀：把暖态工位（warm.md）的近期记忆归档进 episodic/<日期>.md，并合并进冷储摘要（cold.md），然后清空暖态。相当于「判断→被判定→反馈→机制化」循环里的归档动作。",
    parameters: {},
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          archived: { type: "integer" },
          warmCleared: { type: "boolean" },
        },
      },
      render: (_args, value) => [
        { type: "text", text: `海马体沉淀完成：归档 ${value.archived} 字节，暖态已清空。` },
      ],
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      return doConsolidate();
    },
  }));

  // ── 收尾评估：每轮对话结束由工程强制触发「有没有值得沉淀」──────────────
  // 记忆的"时机"是基础设施行为，不能赌模型自觉。读已在注入时自动完成；
  // 写与沉淀在这里由代码保证：turn/end 时评估一次，warm 超阈值时自动归档。
  let lastModel = { provider: "", model: "" };
  const ASSESS_SYSTEM =
    "你是海马体记忆管家。你的任务：阅读一段刚结束的对话，判断其中是否有值得跨会话保留的记忆条目。\n\n" +
    "值得记的：明确的决策、用户的偏好/身份信息、重要事实、可复用的经验教训。\n" +
    "不值得记的：日常寒暄、一次性问答、可即时查询的常识、情绪化表达。\n\n" +
    "输出格式（严格遵守）：\n" +
    "- 没有值得记的 → 只输出 SKIP\n" +
    "- 有值得记的 → 输出 1-3 条，每条一行：类别：内容\n" +
    "  类别 ∈ fact（事实）/ decision（决策）/ preference（偏好）/ experience（经验）\n" +
    "  内容用简洁自包含的中文短句或短段，不依赖原对话上下文也能读懂。";
  const collectTurnTranscript = (session) => {
    const events = session.log ?? session.events ?? [];
    // 以最后一个 turn/start 为边界，只收集本轮的用户/助手可见消息
    let turnStartSeq = -1;
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i]?.type === "turn/start") {
        turnStartSeq = events[i].seq;
        break;
      }
    }
    const lines = [];
    const textOf = (ev) => {
      const blocks =
        ev.type === "assistant/message"
          ? ev.data?.message?.content ?? []
          : ev.data?.content ?? [];
      return blocks
        .filter((b) => b.type === "text" && typeof b.text === "string")
        .map((b) => b.text)
        .join("\n")
        .trim();
    };
    for (const ev of events) {
      if (ev.seq < turnStartSeq) continue;
      if (ev.type === "user/message") {
        // 跳过运行时上下文注入（runtime context / 系统注入），只保留真实用户消息
        const src = ev.data?.source;
        if (src?.kind === "runtime-context" || src?.kind === "model") continue;
        const t = textOf(ev);
        if (t) lines.push(`用户：${t}`);
      } else if (ev.type === "assistant/message") {
        const t = textOf(ev);
        if (t) lines.push(`助手：${t}`);
      }
    }
    return lines.join("\n");
  };
  const buildAssessmentPrompt = (transcript, warm) => {
    const cap = cfg().memory?.assessment?.maxChars ?? 4000;
    const t = transcript.length > cap ? transcript.slice(0, cap) + "\n…(截断)…" : transcript;
    const w = (warm ?? "").trim();
    const warmPart = w ? `\n\n【已有记忆】\n${w.slice(0, 2000)}` : "";
    return `【对话】\n${t}${warmPart}\n\n请判断是否有值得沉淀的条目。`;
  };
  const parseAssessment = (text) => {
    const t = (text ?? "").trim();
    if (!t || t.toUpperCase().includes("SKIP")) return null;
    const lines = t
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .filter((l) => !/^[-*•]?\s*(类别|输出|对话|已有)/.test(l));
    const kinds = new Set(["fact", "decision", "preference", "experience"]);
    const entries = [];
    for (const line of lines) {
      const m = line.match(/^(fact|decision|preference|experience)[：:]\s*(.+)$/i);
      if (m) {
        entries.push({ kind: m[1].toLowerCase(), content: m[2].trim() });
      } else if (line.length > 4 && entries.length === 0) {
        // 兜底：模型没按格式输出时，整段当一条 fact
        entries.push({ kind: "fact", content: line });
      }
    }
    return entries.length ? entries[0] : null;
  };
  const callLlmText = async (system, prompt) => {
    const a = cfg().memory?.assessment ?? {};
    if (!llmClient) return "";
    let text = "";
    for await (const chunk of llmClient.stream({
      provider: lastModel.provider,
      model: lastModel.model,
      system,
      messages: [
        {
          id: `linghun-assess-${Date.now()}`,
          role: "user",
          content: [{ type: "text", text: prompt }],
          source: { kind: "plugin", plugin: NS },
        },
      ],
      temperature: a.temperature ?? 0.2,
      maxTokens: a.maxTokens ?? 300,
      purpose: "compaction",
    })) {
      if (chunk.type === "text-delta") text += chunk.text;
    }
    return text.trim();
  };
  const runAssessment = async (session) => {
    try {
      const c = cfg();
      if (c.memory?.enabled === false || c.memory?.assessment?.enabled === false) return;
      if (!lastModel.provider || !lastModel.model) return;
      const transcript = collectTurnTranscript(session);
      if (!transcript.trim()) return;
      const warm = layout.readWarm();
      const prompt = buildAssessmentPrompt(transcript, warm);
      const out = await callLlmText(ASSESS_SYSTEM, prompt);
      const entry = parseAssessment(out);
      if (!entry) return;
      await appendMemoryBlock(entry.content, entry.kind);
    } catch {
      // best-effort：评估失败静默跳过，绝不阻塞主流程
    }
  };
  ctx.on("session/event", (session, event) => {
    if (event?.type === "request/header" && event.data?.header?.config) {
      lastModel = {
        provider: event.data.header.config.provider ?? "",
        model: event.data.header.config.model ?? "",
      };
    }
    if (event?.type !== "turn/end") return;
    void runAssessment(session);
  });

  // ── 灵魂：读 / 更新自己的灵魂卡（自进化）────────────────────────────────
  ctx.tools.register(defineTool({
    name: "soul_read",
    description:
      "读取自己的灵魂卡（身份锚点 + 判断纪律）。当你需要回顾「我是谁、我的边界、我的纪律」时使用。",
    parameters: {},
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          identity: { type: "string" },
          judgment: { type: "string" },
        },
      },
      render: (_args, value) => [
        { type: "text", text: `灵魂卡「${value.name || "未命名"}」：\n\n${value.identity}\n\n${value.judgment}` },
      ],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const c = cfg();
      const fileText = readCached(identityFile());
      const name = parseName(fileText) || (c.identity?.name ?? "").trim();
      return {
        name,
        identity: resolveIdentity({
          fileText,
          configContent: c.identity?.content,
        }),
        judgment: c.judgment?.enabled === false ? "" : DEFAULT_JUDGMENT,
      };
    },
  }));

  ctx.tools.register(defineTool({
    name: "soul_update",
    description:
      "更新自己的灵魂卡：把观察到的稳定特质、价值观、偏好折叠进身份内容（写入人设文件 $DSH_HOME/linghun/identity.md，用户可直接编辑该文件）。这是自我改进的动作——注意保留核心身份骨架，只补充/修订细节。",
    parameters: {
      content: { type: "string", required: true, description: "新的灵魂卡内容（完整替换身份部分，保留核心骨架）" },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          bytes: { type: "integer" },
        },
      },
      render: (_args, value) => [
        { type: "text", text: `灵魂卡已更新（${value.bytes} 字节）。` },
      ],
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const content = String(args.content ?? "").trim();
      if (!content) throw new Error("soul_update: `content` 不能为空");
      const max = cfg().identity?.maxBytes ?? 64 * 1024;
      if (byteLen(content) > max) {
        throw new Error(`soul_update: 内容超过上限（${max} 字节）`);
      }
      const file = identityFile();
      await ensureParent(file);
      await writeFile(file, content.trimEnd() + "\n", "utf8");
      fileCache.delete(file);
      return { bytes: byteLen(content) };
    },
  }));
}

export { Config, NS, SECTION_IDENTITY, SECTION_JUDGMENT, SECTION_MEMORY, apply, inject, name };
