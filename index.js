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
import { DEFAULT_IDENTITY, DEFAULT_JUDGMENT, DEFAULT_USER_CARD, MEMORY_DISCIPLINE, resolveIdentity } from "./identity.js";
import { createMemoryLayout, parseWarm, renderWarmEntries, summarizeWarmForCold, touchWarmAccessText, findWarmEntryRef, replaceWarmEntryText, markWrongWarmEntryText, findNearDuplicateWarm } from "./memory.js";
import { writeOntologySafe, appendRulesSafe } from "./ontology.js";

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
    /** 暖态记忆体积上限：与注入预算（injectMaxChars 默认 6000 字）同量级对齐，
     *  避免 warm 可合法涨到 1MB 而 98% 结构性进不了注入（F5：autoConsolidate 死代码）。 */
    maxBytes: z.number().default(64 * 1024),
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
    /** 组装模式（提取侧子智能体）：从指定路径注入「预组装素材包」，替代 warm 原文注入。
     *  素材包由 linghun-assembler 生成；配置此路径后优先于环境变量 LINGHUN_MEMORY_OVERRIDE。 */
    assembler: z.object({
      injectPath: z.string().default(""),
      label: z.string().default("以下记忆素材由提取子智能体按当前问题从记忆库组装（仅保留相关条目，细节原样）"),
    }).default({}),
    /** 记忆本体投影（BEAM 机制回灌）：memory_project 把 warm 按主题桶 LLM 聚合 → ontology.md，
     *  供 linghun-assembler 检索「本体主题索引优先 + BM25 兜底」。 */
    ontology: z.object({
      /** 主题桶：LLM 聚合时的分组提示。空=由 LLM 自主聚类；给桶名则按桶聚合。 */
      buckets: z.array(z.string()).default([]),
      /** 每次投影最多主题节点数。 */
      maxNodes: z.number().default(12),
      /** 送入聚合的 warm 原文上限（字符）。 */
      maxChars: z.number().default(12000),
      /** 投影文件路径：默认 $DSH_HOME/linghun/memory/ontology.md。 */
      path: z.string().default(""),
    }).default({}),
    /** 规则本体（BEAM 三本体方案·规则本体）：memory_rules 把总结经验追加进 rules.md，
     *  供 linghun-assembler 检索「R_ALIAS 规则别名命中注入」。规则是长期经验（矛盾不硬裁/查证纪律等）。 */
    rules: z.object({
      /** 规则本体文件路径：默认 $DSH_HOME/linghun/memory/rules.md。 */
      path: z.string().default(""),
    }).default({}),
  }),
});

/** 记忆本体投影系统提示（BEAM build_ontology 机制回灌）：把暖态按主题桶聚合成主题节点。
 *  与 assembler 侧 TAG_ALIAS 主题索引配合：主题节点优先、BM25 兜底。 */
const ONTOLOGY_SYSTEM =
  "你是记忆本体投影器：把一批带时间戳的记忆条目按主题聚类，输出「主题节点」式的结构化本体，供检索优先命中。\n" +
  "要求：\n" +
  "1. 主题用 `## 主题名` 起行；同主题条目合并成一个节点，不拆分、不遗漏；\n" +
  "2. 每个节点正文保留关键事实：时间锚点（YYYY-MM-DD）、数字、版本号、结论——不得概括省略；\n" +
  "3. 节点按主题重要度排序（与当前主线相关的放前），最多不超过 {maxNodes} 个主题；\n" +
  "4. 条目间存在冲突（日期/数字/结论不一致）时，在节点内用「⚠️ 冲突：」标注两个口径，不擅自裁决；\n" +
  "5. 只聚合已有条目，不新增、不编造、不补对话外知识；\n" +
  "6. 输出紧凑，直接输出节点文本，不要解释。\n" +
  "{bucketsHint}";

const PROJECTION_PROMPT =
  "请把以下记忆条目投影成本体（主题节点）：\n\n{entries}";


  "你是海马体记忆管家。你的任务：阅读一段刚结束的对话，判断其中是否有值得跨会话保留的记忆条目，以及对话中用到了哪些已有记忆。\n\n" +
  "值得记的：明确的决策、用户的偏好/身份信息、重要事实、可复用的经验教训。\n" +
  "不值得记的：日常寒暄、一次性问答、可即时查询的常识、情绪化表达。\n\n" +
  "输出格式（严格遵守）：\n" +
  "- 没有值得记的 → 只输出 SKIP\n" +
  "- 有值得记的 → 输出 1-3 条，每条一行：类别：内容\n" +
  "  类别 ∈ fact（事实）/ decision（决策）/ preference（偏好）/ experience（经验）\n" +
  "  内容用简洁自包含的中文短句或短段，不依赖原对话上下文也能读懂。\n" +
  "- 对话中实际用到了【已有记忆】里的条目 → 另起一行输出：TOUCH: 片段1 | 片段2\n" +
  "  片段取该条记忆中的一段原文（越独特越好）；没用到任何已有记忆则省略此行。";

/** 解析收尾评估输出：{ entry, touches }。entry 为值得沉淀的条目（无则 null）；touches 为用到的已有记忆片段列表。 */
function parseAssessment(text) {
  const t = (text ?? "").trim();
  if (!t) return { entry: null, touches: [] };
  const skip = t.toUpperCase().includes("SKIP");
  const lines = t
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !/^[-*•]?\s*(类别|输出|对话|已有)/.test(l));
  let entry = null;
  const touches = [];
  for (const line of lines) {
    const touchM = line.match(/^TOUCH[：:]\s*(.+)$/i);
    if (touchM) {
      touches.push(
        ...touchM[1]
          .split(/[|｜]/)
          .map((s) => s.trim())
          .filter(Boolean),
      );
      continue;
    }
    if (skip) continue;
    const m = line.match(/^(fact|decision|preference|experience)[：:]\s*(.+)$/i);
    if (m && !entry) {
      entry = { kind: m[1].toLowerCase(), content: m[2].trim() };
    } else if (line.length > 4 && !entry) {
      entry = { kind: "fact", content: line };
    }
  }
  return { entry, touches };
}

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

  // 团队认知台账（assembler 认知循环团队共享；缺失/损坏跳过，只读）。
  // 子智能体的领域工作区 = $DSH_HOME/linghun/memory/team/，主智能体经此共享认知产物。
  const readTeamLedger = () => {
    const tdir = join(memoryDir(), "team");
    const cycRaw = readCached(join(tdir, "cycle.json"));
    const gapsRaw = readCached(join(tdir, "gaps.md"));
    const tlRaw = readCached(join(tdir, "archivist", "timelines", "index.json"));
    const judgeRaw = readCached(join(tdir, "judge", "history.jsonl"));
    const bundlesRaw = readCached(join(tdir, "editor", "bundles.jsonl"));
    const rows = [];
    if (cycRaw) {
      try {
        const cyc = JSON.parse(cycRaw);
        if (cyc && typeof cyc === "object") {
          const s = cyc.judgeStats ?? {};
          const f = cyc.feedback ?? {};
          rows.push(
            `- 回合 ${cyc.turnCount ?? 0} · 判官：light ${s.light ?? 0} / medium ${s.medium ?? 0} / deep ${s.deep ?? 0}`,
          );
          rows.push(`- 反馈：命中 ${f.hits ?? 0} / 未命中 ${f.misses ?? 0}`);
          const gaps = Array.isArray(cyc.gaps) ? cyc.gaps : [];
          if (gaps.length) {
            const head = gaps.slice(-3).map((g) => `「${g.query ?? ""}」`).join("、");
            rows.push(`- 缺口 ${gaps.length} 条，最近：${head}`);
          }
        }
      } catch {
        /* cycle.json 损坏跳过 */
      }
    }
    if (gapsRaw) {
      const lines = String(gapsRaw).split("\n").map((l) => l.trim()).filter(Boolean).slice(-3);
      if (lines.length && !rows.some((r) => r.startsWith("- 缺口"))) {
        rows.push(`- gaps.md 尾部：${lines.join("；")}`);
      }
    }
    if (tlRaw) {
      try {
        const tl = JSON.parse(tlRaw);
        if (Array.isArray(tl) && tl.length) {
          const topics = tl.slice(-5).map((e) => `${e.topic ?? "?"}（${e.stamp ?? ""}）`).join("、");
          rows.push(`- 史官已梳理：${topics}`);
        }
      } catch {
        /* 缓存损坏跳过 */
      }
    }
    if (judgeRaw) {
      const recs = [];
      for (const l of String(judgeRaw).split("\n").map((x) => x.trim()).filter(Boolean).slice(-5)) {
        try {
          recs.push(JSON.parse(l));
        } catch {
          /* 坏行跳过 */
        }
      }
      if (recs.length) {
        const head = recs
          .slice(-3)
          .map((r) => `${r.level ?? "?"}(${r.strategy ?? "general"})「${String(r.query ?? "").slice(0, 18)}」`)
          .join("、");
        rows.push(`- 判官履历 ${recs.length} 条，最近：${head}`);
      }
    }
    if (bundlesRaw) {
      const recs = [];
      for (const l of String(bundlesRaw).split("\n").map((x) => x.trim()).filter(Boolean).slice(-3)) {
        try {
          recs.push(JSON.parse(l));
        } catch {
          /* 坏行跳过 */
        }
      }
      if (recs.length) {
        const head = recs
          .map((r) => `${r.entryCount ?? 0} 条${r.timeline ? "+时序" : ""}「${String(r.query ?? "").slice(0, 14)}」`)
          .join("、");
        rows.push(`- 编辑已交付 ${recs.length} 次，最近：${head}`);
      }
    }
    return rows.length ? `## 团队认知台账 / Team\n${rows.join("\n")}` : "";
  };

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
    // 组装模式（提取侧子智能体）：配置 injectPath / 环境变量 / 默认约定路径（与 assembler 侧零配置联动）
    const asmPath =
      (c.memory?.assembler?.injectPath ?? "").trim() ||
      process.env.LINGHUN_MEMORY_OVERRIDE ||
      join(resolveDshHome(), "linghun", "memory", "assembled.md");
    if (asmPath) {
      try {
        const text = readFileSync(asmPath, "utf8").trim();
        if (text) return `> ${c.memory?.assembler?.label}\n\n${text}`;
      } catch {
        /* 文件不可读则回退默认注入 */
      }
    }
    const rendered = layout.renderForInject(c.memory?.injectMaxChars, {
      timeWeight: c.memory?.timeWeight,
    });
    if (!rendered) return "";
    return `${MEMORY_DISCIPLINE}\n\n${rendered}`;
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
      interpolate: false,
    });
    sectionDisposers.judgment = ctx.systemPrompt.section({
      name: SECTION_JUDGMENT,
      order: cfg().judgment?.order ?? 0.2,
      text: renderJudgment,
      interpolate: false,
    });
    sectionDisposers.memory = ctx.systemPrompt.section({
      name: SECTION_MEMORY,
      order: cfg().memory?.order ?? 0.5,
      text: renderMemory,
      interpolate: false,
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
  /** 序时账时间戳：YYYY-MM-DD HH:MM:SS（秒级，天内可精确定位）。 */
  const nowStampSec = () => {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };
  const todayName = () => nowStamp().slice(0, 10);

  // ── 海马体：记 / 读 / 沉淀 ──────────────────────────────────────────────
  /** 归档暖态 → episodic/<日期>.md + 冷储摘要，然后清空暖态。工程层可复用（阈值沉淀/收尾评估共用）。
   *  F3：episodic 用 append + 按时刻分段——同日多次沉淀不覆盖；
   *  F4：cold 只写「每条一行的锚点摘要 + 全文指针」，不倾倒 warm 原文（注入预算不被冷储吃光）。 */
  const doConsolidate = async () => {
    const warm = layout.readWarm();
    if (!warm.trim()) return { archived: 0, warmCleared: true };
    const stamp = nowStampSec(); // YYYY-MM-DD HH:MM:SS
    const day = stamp.slice(0, 10);
    const hm = stamp.slice(11, 16); // HH:MM
    const episodicFile = join(layout.episodicDir(), `${day}.md`);
    const cold = layout.readCold();
    const lines = summarizeWarmForCold(warm);
    const coldNext = [
      cold.trim(),
      `## ${day} 沉淀（${lines.length} 条）`,
      ...lines,
      `（全文见 episodic/${day}.md）`,
    ].filter(Boolean).join("\n");
    await ensureParent(episodicFile);
    await appendFile(episodicFile, `\n## ${hm}\n\n${warm.trim()}\n`, "utf8");
    await ensureParent(layout.coldFile());
    await appendFile(layout.coldFile(), `\n\n${coldNext}\n`, "utf8");
    await writeFile(layout.warmFile(), "", "utf8");
    fileCache.delete(episodicFile);
    fileCache.delete(layout.coldFile());
    fileCache.delete(layout.warmFile());
    return { archived: byteLen(warm), warmCleared: true };
  };

  /** 记忆本体投影（BEAM 机制回灌）：把暖态 warm 按主题桶 LLM 聚合 → ontology.md。
   *  供 linghun-assembler 检索「本体主题索引优先 + BM25 兜底」；投影失败返回 { ok:false, reason }。 */
  const doOntologyProject = async (overrides = {}) => {
    const warm = layout.readWarm();
    if (!warm.trim()) return { ok: false, reason: "warm 为空，无内容可投影" };
    const c = cfg().memory?.ontology ?? {};
    const buckets = [...(overrides.buckets ?? []), ...(c.buckets ?? [])].filter((b) => typeof b === "string" && b.trim());
    const maxNodes = overrides.maxNodes ?? c.maxNodes ?? 12;
    const cap = overrides.maxChars ?? c.maxChars ?? 12000;
    const entries = renderWarmEntries(parseWarm(warm), { numbered: true, includeWrong: true });
    if (!entries.trim()) return { ok: false, reason: "warm 无可渲染条目" };
    const trunk = entries.length > cap ? `${entries.slice(0, cap)}\n…(截断)…` : entries;
    const bucketsHint = buckets.length
      ? `主题桶提示（尽量对齐这些主题，可增可并）：${buckets.join(" / ")}`
      : "主题自由聚类：按条目自然主题分桶";
    const system = ONTOLOGY_SYSTEM
      .replace("{maxNodes}", String(maxNodes))
      .replace("{bucketsHint}", bucketsHint);
    const prompt = PROJECTION_PROMPT.replace("{entries}", trunk);
    const out = await callLlmText(system, prompt);
    if (!out.trim()) return { ok: false, reason: "LLM 返回空投影" };
    const path = (c.path ?? "").trim() || join(resolveDshHome(), "linghun", "memory", "ontology.md");
    const changed = writeOntologySafe(path, out);
    return { ok: true, path, changed, nodes: out.split(/\n(?=## )/).filter((b) => b.trim().startsWith("## ")).length };
  };

  /** 规则本体沉淀（BEAM 三本体方案·规则本体）：把一条总结经验追加进 rules.md（## 主题 节点）。
   *  供 assembler 检索「R_ALIAS 规则别名命中注入」。失败返回 { ok:false, reason }。 */
  const doRulesAppend = async (opts = {}) => {
    const rule = typeof opts?.rule === "string" ? opts.rule.trim() : "";
    const topic = typeof opts?.topic === "string" ? opts.topic.trim() : "";
    if (!rule) return { ok: false, reason: "rule 为空" };
    const c = cfg().memory?.rules ?? {};
    const path = (c.path ?? "").trim() || join(resolveDshHome(), "linghun", "memory", "rules.md");
    const stamp = new Date().toISOString().slice(0, 10);
    return appendRulesSafe(path, topic, rule, stamp);
  };

  /** 写一条暖态记忆；开启 autoConsolidate 且达到阈值时先自动归档再写（模型无感知，不 throw）。
   *  opts.update：翻转语义——ref 命中正常条目 → 旧条目标 wrong（被翻转），新内容另起一条（默认 high）；
   *                ref 命中 wrong 条目 → 复活为高置信新内容（替换）。
   *  opts.confidence：high/medium/low（默认 medium）。
   *  无 update 时自动查近似重复（findNearDuplicateWarm）：几乎相同内容 → 替换不追加（防 BEAM 式旧新并存）。
   *  返回 { mode: "append" | "update" | "dedupe", bytes, totalBytes }。 */
  const appendMemoryBlock = async (content, kind, opts = {}) => {
    const stamp = nowStamp();
    const conf = ["high", "medium", "low"].includes(opts.confidence) ? opts.confidence : "medium";
    const block = `\n## ${stamp} [${kind}] ${conf}\n\n${content}\n<!-- last_access: ${stamp} -->\n`;
    const file = layout.warmFile();
    const current = readCached(file) ?? "";

    if (opts.update) {
      const found = findWarmEntryRef(current, opts.update);
      if (found) {
        if (found.entry.confidence === "wrong") {
          // 复活：被翻转的条目被证明其实对，替换为高置信新内容
          const next = replaceWarmEntryText(current, opts.update, block.trim());
          await ensureParent(file);
          await writeFile(file, next, "utf8");
          fileCache.delete(file);
          return { mode: "update", bytes: byteLen(block), totalBytes: byteLen(next) };
        }
        // 翻转：旧条目标 wrong，新内容追加为独立条目（默认 high，除非显式传 confidence）
        const flipped = markWrongWarmEntryText(current, opts.update);
        const highBlock = `\n## ${stamp} [${kind}] high\n\n${content}\n<!-- last_access: ${stamp} -->\n`;
        const next = flipped === null ? current : flipped;
        const finalText = `${next.trimEnd()}\n${highBlock.trim()}\n`;
        await ensureParent(file);
        await writeFile(file, finalText, "utf8");
        fileCache.delete(file);
        return { mode: "update", bytes: byteLen(highBlock), totalBytes: byteLen(finalText) };
      }
      // ref 没匹配到：fall through 追加（模型引用失效时不让写入失败）
    }

    const dup = findNearDuplicateWarm(current, content);
    if (dup) {
      const entries = parseWarm(current);
      entries[dup.index] = { ...entries[dup.index], block: block.trim() };
      const next = `${entries.map((e) => e.block).join("\n\n")}\n`;
      await ensureParent(file);
      await writeFile(file, next, "utf8");
      fileCache.delete(file);
      return { mode: "dedupe", bytes: byteLen(block), totalBytes: byteLen(next) };
    }

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
    return { mode: "append", bytes: byteLen(block), totalBytes: total };
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
      "把一条带时间戳的 Markdown 记进海马体暖态工位（warm.md）。适合跨会话保留的事实、决策、偏好、经验。条目要简洁自包含，不要一次性倾倒。积累多了用 memory_consolidate 沉淀。\n\n置信度（confidence）：high=用户直接说/已验证；medium=推断（默认）；low=存疑/猜测/过期待验。低置信条目注入时带【低置信·需验证】标记，引用时必须声明不确定。\n\n更新（update）：发现旧条目已被推翻/变更时，传 memory_read 返回的编号（如 [3]）或该条目内容片段——旧条目标记为 wrong（被翻转，不再注入），新内容另起一条（默认高置信）。近似重复内容会自动合并不追加。",
    parameters: {
      kind: {
        type: "string",
        description: "条目类别：fact（事实）/ decision（决策）/ preference（偏好）/ experience（经验）/ identity（用户身份与背景信息），默认 fact",
      },
      content: { type: "string", required: true, description: "要记住的 markdown 内容，简洁自包含" },
      confidence: {
        type: "string",
        enum: ["high", "medium", "low"],
        description: "置信度：high（用户直接说/已验证）/ medium（推断，默认）/ low（存疑/猜测/过期待验）",
      },
      update: {
        type: "string",
        description: "可选。要翻转/覆盖的旧条目：传 memory_read 返回的编号（如 [3]）或内容片段。命中后旧条目标记为 wrong（被翻转），新内容另起一条（默认高置信）。用于旧事实被推翻、决策变更、偏好改变等场景",
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          mode: { type: "string" },
          bytes: { type: "integer" },
          totalBytes: { type: "integer" },
        },
      },
      render: (_args, value) => [
        {
          type: "text",
          text:
            value.mode === "update"
              ? `已翻转旧条目为新事实（${value.bytes} 字节，累计 ${value.totalBytes}）。`
              : value.mode === "dedupe"
                ? `已合并近似重复条目（${value.bytes} 字节，累计 ${value.totalBytes}）。`
                : `已记入海马体（${value.bytes} 字节，累计 ${value.totalBytes}）。`,
        },
      ],
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const content = String(args.content ?? "").trim();
      if (!content) throw new Error("memory_append: `content` 不能为空");
      const kind = String(args.kind ?? "fact").trim() || "fact";
      const confidence = String(args.confidence ?? "").trim();
      const update = String(args.update ?? "").trim() || undefined;
      return appendMemoryBlock(content, kind, { confidence, update });
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
      const warm = renderWarmEntries(parseWarm(layout.readWarm()), {
        numbered: true,
        includeWrong: true,
      });
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
      const team = readTeamLedger();
      if (team) parts.push(team);
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
    name: "journal_read",
    description:
      "读取序时账（journal）：原始对话流水，按天归档、全量不筛选。不传 date 返回所有天的索引（日期 + 条数）；传 date（YYYY-MM-DD）返回该天完整流水。用于追溯'当时到底说了什么'——序时账与暖态/冷储互补：warm 是遗忘梯度的近期摘要，journal 是完整原始记录。",
    parameters: {
      date: {
        type: "string",
        description: "YYYY-MM-DD，读取指定日期的完整流水；不传则列出所有天索引",
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
            ? `序时账（${value.bytes} 字节）：\n${value.content}`
            : "序时账为空（尚无流水）。",
        },
      ],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const day = String(args?.date ?? "").trim();
      if (day) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
          return { exists: false, bytes: 0, content: "date 格式应为 YYYY-MM-DD" };
        }
        const content = layout.readJournal(day);
        if (!content.trim()) return { exists: false, bytes: 0, content: `该日期（${day}）暂无流水。` };
        return { exists: true, bytes: byteLen(content), content };
      }
      const days = layout.listJournal();
      if (!days.length) return { exists: false, bytes: 0, content: "序时账为空（尚无流水）。" };
      const rows = days
        .map((j) => `- ${j.name}（${j.entries} 条流水）`)
        .join("\n");
      return { exists: true, bytes: byteLen(rows), content: rows };
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

  ctx.tools.register(defineTool({
    name: "memory_project",
    description:
      "记忆本体投影（BEAM 验证机制）：把暖态工位（warm.md）按主题桶 LLM 聚合成本体投影（ontology.md）——同主题条目合并为主题节点，保留时间锚点/数字/版本/结论。供记忆提取子智能体（linghun-assembler）检索时「本体主题索引优先 + BM25 兜底」，替代纯 BM25 的分散命中。适合在 warm 条目多、问题常跨主题时执行；本体文件可在多次投影间累积（每次用当前暖态重投影）。",
    parameters: {
      buckets: {
        type: "array",
        items: { type: "string" },
        description: "可选。主题桶提示（如 [\"RAG 管道\", \"向量数据库\", \"成本估算\"]）；不传由 LLM 按自然主题自由聚类",
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ok: { type: "boolean" },
          path: { type: "string" },
          changed: { type: "boolean" },
          nodes: { type: "integer" },
          reason: { type: "string" },
        },
      },
      render: (_args, value) => [
        { type: "text", text: value.ok ? `记忆本体投影完成：${value.nodes} 个主题节点 → ${value.path}${value.changed ? "（已更新）" : "（内容未变）"}` : `记忆本体投影未完成：${value.reason ?? "未知原因"}` },
      ],
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      return doOntologyProject({
        buckets: Array.isArray(args?.buckets) ? args.buckets.filter((b) => typeof b === "string" && b.trim()) : [],
      });
    },
  }));

  ctx.tools.register(defineTool({
    name: "memory_rules",
    description:
      "规则本体沉淀（BEAM 三本体方案·规则本体）：把一条可复用的总结经验追加进规则本体 rules.md（## 主题 节点下追加 - 规则行），供记忆提取子智能体（linghun-assembler）检索时 R_ALIAS 规则别名命中注入。规则是长期稳定的经验（如「矛盾不硬裁」「先查证再下结论」「记忆注入是素材不替代判定」），不是一次性事实——适合在实践得出可复用结论后调用；同主题规则自动聚合在同一节点下。",
    parameters: {
      rule: {
        type: "string",
        description: "规则内容（一句话可复用经验，如「矛盾不硬裁：悖论场景承认无一致解，不强行自洽」）",
      },
      topic: {
        type: "string",
        description: "规则主题（如「判断纪律」「记忆纪律」「评测纪律」）；同主题规则聚合在一个节点下",
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ok: { type: "boolean" },
          changed: { type: "boolean" },
          path: { type: "string" },
          theme: { type: "string" },
          reason: { type: "string" },
        },
      },
      render: (_args, value) => [
        { type: "text", text: value.ok ? `规则本体已沉淀：${value.theme} → ${value.path}` : `规则本体沉淀失败：${value.reason ?? "未知原因"}` },
      ],
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      return doRulesAppend({ rule: args?.rule, topic: args?.topic });
    },
  }));

  // ── 收尾评估：每轮对话结束由工程强制触发「有没有值得沉淀」──────────────
  // 记忆的"时机"是基础设施行为，不能赌模型自觉。读已在注入时自动完成；
  // 写与沉淀在这里由代码保证：turn/end 时评估一次，warm 超阈值时自动归档。
  let lastModel = { provider: "", model: "" };
  const collectTurnTranscript = (session) => {
    // 防御性事件获取：新版 DSH Session 契约用 snapshotEvents()（Inspect 形态），
    // 旧版暴露 log / events 字段。兼容两者，取不到就空转（收尾序时账不阻塞主流程）。
    const events =
      typeof session?.snapshotEvents === "function"
        ? session.snapshotEvents()
        : (session?.log ?? session?.events ?? []);
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
        // 跳过运行时上下文/插件注入与模型侧注入，只保留真实用户消息
        // （MessageSource.kind 合法枚举：user / plugin / model / tool；runtime-context 不存在）
        const src = ev.data?.source;
        if (src?.kind === "plugin" || src?.kind === "model") continue;
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
    const warmText = (warm ?? "").trim();
    const warmClean = warmText ? renderWarmEntries(parseWarm(warmText)) : "";
    const warmPart = warmClean ? `\n\n【已有记忆】\n${warmClean.slice(0, 2000)}` : "";
    return `【对话】\n${t}${warmPart}\n\n请判断是否有值得沉淀的条目。`;
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
      const { entry, touches } = parseAssessment(out);
      if (entry) await appendMemoryBlock(entry.content, entry.kind);
      // 自动时间管理：评估 LLM 判断本轮实际用到了哪些已有记忆 → 自动 touch（读≠用，用到才活跃）
      if (c.memory?.timeWeight !== false && touches.length) {
        for (const ref of touches) {
          await touchWarmAccess(ref);
        }
      }
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
    // 序时账：本轮原始对话全量 append（用户输入 + 助手回答），不筛选不评估
    try {
      const transcript = collectTurnTranscript(session);
      if (transcript) layout.appendJournal(nowStampSec(), transcript);
    } catch {
      // best-effort：journal 写入失败静默跳过，绝不阻塞主流程
    }
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

export { Config, NS, SECTION_IDENTITY, SECTION_JUDGMENT, SECTION_MEMORY, apply, inject, name, parseAssessment };
