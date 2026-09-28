import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_IDENTITY, DEFAULT_JUDGMENT, DEFAULT_USER_CARD, ARCHITECTURE_PRIORITY, resolveIdentity } from "../identity.js";
import { createMemoryLayout, parseWarm, renderWarmEntries, sortWarmByAccess, sortWarmForInject, touchWarmAccessText, findWarmEntryRef, replaceWarmEntryText, markWrongWarmEntryText, findNearDuplicateWarm } from "../memory.js";
import { Config, NS, apply, inject, name, parseAssessment } from "../index.js";

// ── identity.js ─────────────────────────────────────────────────────────
test("identity: 默认灵魂卡包含收口者身份锚点", () => {
  assert.ok(DEFAULT_IDENTITY.includes("认知主体"));
  assert.ok(DEFAULT_IDENTITY.includes("收口者"));
  assert.ok(DEFAULT_IDENTITY.includes("大模型供直觉"));
  assert.ok(DEFAULT_IDENTITY.includes("实事求是"));
  assert.ok(DEFAULT_IDENTITY.length > 200);
});

test("identity: 判断纪律包含六类边界", () => {
  assert.ok(DEFAULT_JUDGMENT.includes("模糊概念"));
  assert.ok(DEFAULT_JUDGMENT.includes("悖论"));
  assert.ok(DEFAULT_JUDGMENT.includes("身份边界"));
  assert.ok(DEFAULT_JUDGMENT.includes("能力边界"));
  assert.ok(DEFAULT_JUDGMENT.includes("知识边界"));
  assert.ok(DEFAULT_JUDGMENT.includes("伦理"));
  assert.ok(DEFAULT_JUDGMENT.includes("抬高拒绝成本"));
});

test("identity: 用户卡其他栏默认带方法论种子（思渊六条）", () => {
  assert.ok(DEFAULT_USER_CARD.includes("方法论种子"));
  assert.ok(DEFAULT_USER_CARD.includes("毛选式"));
  assert.ok(DEFAULT_USER_CARD.includes("科学方法论"));
  assert.ok(DEFAULT_USER_CARD.includes("系统思维"));
  assert.ok(DEFAULT_USER_CARD.includes("逻辑工具箱"));
  assert.ok(DEFAULT_USER_CARD.includes("认知偏差"));
  assert.ok(DEFAULT_USER_CARD.includes("贝叶斯更新"));
  assert.ok(DEFAULT_USER_CARD.includes("相对真理"));
});

test("identity: 用户人设文件优先于配置，且架构层始终垫底", () => {
  const userCard = "# 我的灵魂卡\n\n我是我自己写的人设。";
  const merged = resolveIdentity({ fileText: userCard, configContent: "# 配置卡" });
  assert.ok(merged.startsWith(userCard));
  assert.ok(merged.includes(DEFAULT_IDENTITY));
  assert.ok(!merged.includes("# 配置卡"));
});

test("identity: 无文件时使用配置内容，且架构层始终垫底", () => {
  const merged = resolveIdentity({ fileText: "", configContent: "# 配置卡" });
  assert.ok(merged.startsWith("# 配置卡"));
  assert.ok(merged.includes(DEFAULT_IDENTITY));
});

test("identity: 文件与配置都空时回退默认卡", () => {
  assert.equal(resolveIdentity({ fileText: "  \n", configContent: " " }), DEFAULT_IDENTITY);
  assert.equal(resolveIdentity({}), DEFAULT_IDENTITY);
});

test("identity: 冲突时架构优先声明随合并注入", () => {
  const merged = resolveIdentity({ fileText: "名字：小蓝\n性格：谨慎。\n" });
  assert.ok(merged.includes(ARCHITECTURE_PRIORITY));
  assert.ok(merged.indexOf("小蓝") < merged.indexOf("以认知架构为准"));
  assert.ok(merged.indexOf("以认知架构为准") < merged.indexOf("认知主体"));
});

// ── memory.js 海马体布局 ────────────────────────────────────────────────
function makeLayout() {
  const root = mkdtempSync(join(tmpdir(), "linghun-test-"));
  const texts = new Map();
  const readText = (file) => (texts.has(file) ? texts.get(file) : null);
  const layout = createMemoryLayout(() => root, readText);
  const track = (file, text) => texts.set(file, text);
  return { root, layout, readText, track };
}

test("memory: 空布局 renderForInject 返回空", () => {
  const { layout } = makeLayout();
  assert.equal(layout.renderForInject(6000), "");
});

test("memory: appendJournal 按天写入序时账（HH:MM:SS 前缀 + append 顺序）", () => {
  const { root, track, layout } = makeLayout();
  assert.ok(layout.appendJournal("2026-09-28 16:52:07", "用户：你好\n助手：你好呀"));
  assert.ok(layout.appendJournal("2026-09-28 16:52:30", "用户：继续"));
  const jf = join(root, "journal", "2026-09-28.md");
  const text = readFileSync(jf, "utf8");
  track(jf, text); // 测试环境 readText 是 map，需手动同步（真实环境 readCached 自动）
  assert.ok(text.includes("2026-09-28 16:52:07\n用户：你好\n助手：你好呀"));
  assert.ok(text.includes("2026-09-28 16:52:30\n用户：继续"));
  assert.ok(text.indexOf("16:52:07") < text.indexOf("16:52:30"), "天内应按 append 顺序");
  const days = layout.listJournal();
  assert.equal(days.length, 1);
  assert.equal(days[0].name, "2026-09-28");
  assert.equal(days[0].entries, 2);
});

test("memory: appendJournal 拒绝非法日期/空内容", () => {
  const { layout } = makeLayout();
  assert.equal(layout.appendJournal("not-a-date 12:00:00", "x"), false);
  assert.equal(layout.appendJournal("2026-09-28 12:00:00", "   "), false);
});

test("memory: renderForInject 包含序时账索引", () => {
  const { root, track, layout } = makeLayout();
  layout.appendJournal("2026-09-28 16:52:07", "用户：测试流水");
  track(join(root, "journal", "2026-09-28.md"), readFileSync(join(root, "journal", "2026-09-28.md"), "utf8"));
  const out = layout.renderForInject(6000);
  assert.ok(out.includes("序时账索引"));
  assert.ok(out.includes("2026-09-28（1 条流水）"));
});

test("memory: warm 有内容时注入包含近期记忆", () => {
  const { root, track, layout } = makeLayout();
  track(join(root, "warm.md"), "## 2026-09-21 [fact]\n\n用户喜欢短句。\n");
  const out = layout.renderForInject(6000);
  assert.ok(out.includes("近期记忆"));
  assert.ok(out.includes("用户喜欢短句"));
});

test("memory: cold + warm + episodic 索引按序渲染", () => {
  const { root, track, layout } = makeLayout();
  mkdirSync(join(root, "episodic"), { recursive: true });
  track(join(root, "cold.md"), "# 冷储\n\n规则：先查证再下结论。\n");
  track(join(root, "warm.md"), "## 2026-09-21 [decision]\n\n决定全开源。\n");
  writeFileSync(join(root, "episodic", "2026-09-20.md"), "沉淀条目 A\n");
  const out = layout.renderForInject(6000);
  assert.ok(out.indexOf("冷储") < out.indexOf("近期记忆"));
  assert.ok(out.indexOf("近期记忆") < out.indexOf("归档索引"));
  assert.ok(out.includes("2026-09-20"));
});

test("memory: renderForInject 超限截断并提示", () => {
  const { root, track, layout } = makeLayout();
  track(join(root, "warm.md"), "X".repeat(1000));
  const out = layout.renderForInject(100);
  assert.ok(out.includes("超出注入上限"));
  assert.ok(out.length < 200);
});

test("memory: listEpisodic 只列 .md 且排序", () => {
  const { root, layout } = makeLayout();
  mkdirSync(join(root, "episodic"), { recursive: true });
  writeFileSync(join(root, "episodic", "2026-09-21.md"), "b 内容\n");
  writeFileSync(join(root, "episodic", "2026-09-19.md"), "a 内容\n");
  writeFileSync(join(root, "episodic", "note.txt"), "ignored");
  const list = layout.listEpisodic();
  assert.equal(list.length, 2);
  assert.equal(list[0].name, "2026-09-19");
  assert.equal(list[1].name, "2026-09-21");
});

// ── 时间管理（last_access 吃灰降权）──────────────────────────────────────
test("time: parseWarm 提取条目与 last_access", () => {
  const text = [
    "## 2026-09-21 10:00 [fact]",
    "",
    "旧记忆。",
    "<!-- last_access: 2026-09-21 10:00 -->",
    "",
    "## 2026-09-28 14:00 [decision]",
    "",
    "新记忆。",
    "<!-- last_access: 2026-09-28 14:00 -->",
  ].join("\n");
  const entries = parseWarm(text);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].lastAccess, "2026-09-21 10:00");
  assert.equal(entries[1].lastAccess, "2026-09-28 14:00");
});

test("time: renderWarmEntries 剥掉 last_access 元数据", () => {
  const text = "## 2026-09-28 [fact]\n\n内容。\n<!-- last_access: 2026-09-28 -->\n";
  const out = renderWarmEntries(parseWarm(text));
  assert.ok(!out.includes("last_access"));
  assert.ok(out.includes("内容"));
});

test("time: sortWarmByAccess 最近调用的在前", () => {
  const entries = parseWarm([
    "## 2026-09-20 [fact]",
    "",
    "老。",
    "<!-- last_access: 2026-09-20 08:00 -->",
    "",
    "## 2026-09-28 [fact]",
    "",
    "新。",
    "<!-- last_access: 2026-09-28 12:00 -->",
    "",
    "## 2026-09-25 [fact]",
    "",
    "无访问标记（视为最旧）。",
  ].join("\n"));
  const sorted = sortWarmByAccess(entries);
  assert.equal(sorted[0].lastAccess, "2026-09-28 12:00");
  assert.equal(sorted[1].lastAccess, "2026-09-20 08:00");
  assert.equal(sorted[2].lastAccess, null);
});

test("time: renderForInject 按 last_access 新在前排序", () => {
  const { root, track, layout } = makeLayout();
  track(
    join(root, "warm.md"),
    [
      "## 2026-09-20 [fact]",
      "",
      "老条目。",
      "<!-- last_access: 2026-09-20 08:00 -->",
      "",
      "## 2026-09-28 [fact]",
      "",
      "新条目。",
      "<!-- last_access: 2026-09-28 12:00 -->",
    ].join("\n"),
  );
  const out = layout.renderForInject(6000);
  assert.ok(out.indexOf("新条目") < out.indexOf("老条目"));
});

test("time: renderForInject 超限时吃灰条目被裁掉", () => {
  const { root, track, layout } = makeLayout();
  track(
    join(root, "warm.md"),
    [
      "## 2026-09-28 [fact]",
      "",
      "新条目。",
      "<!-- last_access: 2026-09-28 12:00 -->",
      "",
      "## 2026-09-20 [fact]",
      "",
      "吃灰条目。",
      "<!-- last_access: 2026-09-20 08:00 -->",
    ].join("\n"),
  );
  const out = layout.renderForInject(50);
  assert.ok(out.includes("新条目"));
  assert.ok(!out.includes("吃灰条目"));
});

test("time: timeWeight=false 时保持原注入顺序", () => {
  const { root, track, layout } = makeLayout();
  track(
    join(root, "warm.md"),
    [
      "## 2026-09-20 [fact]",
      "",
      "老条目。",
      "<!-- last_access: 2026-09-20 08:00 -->",
      "",
      "## 2026-09-28 [fact]",
      "",
      "新条目。",
      "<!-- last_access: 2026-09-28 12:00 -->",
    ].join("\n"),
  );
  const out = layout.renderForInject(6000, { timeWeight: false });
  assert.ok(out.indexOf("老条目") < out.indexOf("新条目"));
});

test("time: touchWarmAccessText 只刷新匹配 ref 的条目（读≠用）", () => {
  const warm = [
    "## 2026-09-20 [fact]",
    "",
    "老条目：插件全开源。",
    "<!-- last_access: 2026-09-20 08:00 -->",
    "",
    "## 2026-09-28 [fact]",
    "",
    "新条目：贝叶斯更新。",
    "<!-- last_access: 2026-09-28 12:00 -->",
  ].join("\n");
  const { text, touched } = touchWarmAccessText(warm, "贝叶斯更新", "2026-09-30 00:00");
  assert.equal(touched, 1);
  assert.ok(text.includes("last_access: 2026-09-30 00:00")); // 匹配的被刷新
  assert.ok(text.includes("last_access: 2026-09-20 08:00")); // 未匹配的保持原样
});

test("time: touchWarmAccessText 容忍 ref 携带 markdown 标记（真实踩坑）", () => {
  const warm = [
    "## 2026-09-21 [fact]",
    "",
    "**身份确立**：我名为**岫客**，同源于岚客。",
    "",
    "## 2026-09-21 [fact]",
    "",
    "踩坑：往 `cordis.patch.yml` 写 config 会 failed。",
  ].join("\n");
  // ref 跨 ** 加粗标记（真实环境模型选片段踩的坑）
  const r1 = touchWarmAccessText(warm, "**身份确立**：我名为**岫客**", "2026-09-30 00:00");
  assert.equal(r1.touched, 1);
  assert.ok(r1.text.includes("last_access: 2026-09-30 00:00"));
  // ref 带反引号代码片段
  const r2 = touchWarmAccessText(warm, "`cordis.patch.yml`", "2026-09-30 00:01");
  assert.equal(r2.touched, 1);
  assert.ok(r2.text.includes("last_access: 2026-09-30 00:01"));
  // 只刷新匹配条目，另一条不带 last_access 的原样保留
  assert.equal((r1.text.match(/last_access:/g) || []).length, 1);
});

test("time: touchWarmAccessText ref 纯 markdown 标记不误伤全部", () => {
  const warm = "## 2026-09-20 [fact]\n\n老条目。\n<!-- last_access: 2026-09-20 08:00 -->\n";
  const { text, touched } = touchWarmAccessText(warm, "**", "2026-09-30 00:00");
  assert.equal(touched, 0);
  assert.equal(text, null);
});

test("time: touchWarmAccessText 无匹配返回 touched 0 且 text null", () => {
  const warm = "## 2026-09-20 [fact]\n\n老条目。\n<!-- last_access: 2026-09-20 08:00 -->\n";
  const { text, touched } = touchWarmAccessText(warm, "不存在的片段", "2026-09-30 00:00");
  assert.equal(touched, 0);
  assert.equal(text, null);
});

test("time: touchWarmAccessText 匹配但已最新时不写盘（text null）", () => {
  const warm = "## 2026-09-20 [fact]\n\n老条目。\n<!-- last_access: 2026-09-30 00:00 -->\n";
  const { text, touched } = touchWarmAccessText(warm, "老条目", "2026-09-30 00:00");
  assert.equal(touched, 1);
  assert.equal(text, null);
});

test("time: parseAssessment 解析 TOUCH 行（自动时间管理）", () => {
  const out = [
    "experience：embedding 失败要 fail-closed。",
    "TOUCH: 贝叶斯更新 | 用户喜欢短句",
  ].join("\n");
  const { entry, touches } = parseAssessment(out);
  assert.equal(entry.kind, "experience");
  assert.deepEqual(touches, ["贝叶斯更新", "用户喜欢短句"]);
});

test("time: parseAssessment SKIP 时不沉淀但保留 TOUCH", () => {
  const { entry, touches } = parseAssessment("SKIP\nTOUCH: 插件全开源");
  assert.equal(entry, null);
  assert.deepEqual(touches, ["插件全开源"]);
});

test("time: parseAssessment 空输出返回空，普通条目无 TOUCH", () => {
  assert.deepEqual(parseAssessment(""), { entry: null, touches: [] });
  const { entry, touches } = parseAssessment("fact：普通条目");
  assert.equal(entry.kind, "fact");
  assert.deepEqual(touches, []);
});

// ── index.js 导出与配置 ─────────────────────────────────────────────────
test("index: 导出 Cordis 插件契约", () => {
  assert.equal(name, "linghun");
  assert.deepEqual(inject, ["systemPrompt", "tools"]);
  assert.equal(NS, "linghun");
  assert.equal(typeof apply, "function");
  assert.ok(Config);
});

test("index: 三个 prompt section 均关闭模板插值（interpolate:false，防 {{ }} 毒化）", () => {
  const sections = [];
  const ctx = {
    systemPrompt: {
      section: (s) => {
        sections.push(s);
        return () => {};
      },
    },
    effect: (cb) => cb(),
    inject: () => {},
    tools: { register: () => {} },
    on: () => {},
  };
  const oldHome = process.env.HOME;
  process.env.HOME = mkdtempSync(join(tmpdir(), "linghun-test-home-"));
  try {
    apply(ctx, Config(undefined));
  } finally {
    if (oldHome === undefined) delete process.env.HOME;
    else process.env.HOME = oldHome;
  }
  const names = sections.map((s) => s.name);
  for (const n of ["soul:identity", "soul:judgment", "soul:memory"]) {
    assert.ok(names.includes(n), `应注册 section ${n}`);
  }
  for (const s of sections) {
    assert.equal(s.interpolate, false, `${s.name} 必须设置 interpolate:false（纯文本注入）`);
    assert.equal(typeof s.text, "function", `${s.name} 的 text 应为 function`);
  }
});

test("index: 默认配置可解析且取默认值", () => {
  const parsed = Config(undefined);
  assert.equal(parsed.identity.enabled, true);
  assert.equal(parsed.identity.name, "");
  assert.equal(parsed.identity.content, "");
  assert.equal(parsed.judgment.enabled, true);
  assert.equal(parsed.memory.enabled, true);
  assert.equal(parsed.memory.injectMaxChars, 6000);
  assert.equal(parsed.memory.timeWeight, true);
});

// ── 置信度分级 + 更新/覆盖（v0.2.8）───────────────────────────────────────
const WARM_FIXTURE = [
  "## 2026-09-27 10:00 [fact] high\n\nsprint 1 截止 2026-03-29。\n<!-- last_access: 2026-09-27 10:00 -->",
  "## 2026-09-28 09:00 [fact]\n\n用户偏好短句。\n<!-- last_access: 2026-09-28 09:00 -->",
  "## 2026-09-28 11:00 [decision] low\n\n可能迁移到 Render，未验证。\n<!-- last_access: 2026-09-28 11:00 -->",
  "## 2026-09-28 12:00 [fact] wrong\n\nsprint 1 截止 2026-11-15。\n<!-- last_access: 2026-09-28 12:00 -->",
].join("\n\n") + "\n";

test("conf: parseWarm 解析 confidence（含 wrong，缺省 medium）", () => {
  const entries = parseWarm(WARM_FIXTURE);
  assert.equal(entries.length, 4);
  assert.equal(entries[0].confidence, "high");
  assert.equal(entries[1].confidence, "medium");
  assert.equal(entries[2].confidence, "low");
  assert.equal(entries[3].confidence, "wrong");
});

test("conf: sortWarmForInject 先置信度后访问时间，wrong 沉底", () => {
  const entries = parseWarm(WARM_FIXTURE);
  const sorted = sortWarmForInject(entries);
  assert.deepEqual(sorted.map((e) => e.confidence), ["high", "medium", "low", "wrong"]);
});

test("conf: sortWarmForInject high 不衰减——组内保持写入序，时间管不着", () => {
  const warm = [
    "## 2026-09-01 08:00 [fact] high\n\nold verified knowledge\n<!-- last_access: 2026-09-01 08:00 -->",
    "## 2026-09-02 09:00 [fact] high\n\nnewer verified knowledge\n<!-- last_access: 2026-09-02 09:00 -->",
    "## 2026-09-03 10:00 [fact] medium\n\nrecent guess\n<!-- last_access: 2026-09-03 10:00 -->",
    "## 2026-09-04 11:00 [fact] high\n\noldest verified but written later\n<!-- last_access: 2026-09-01 07:00 -->",
  ].join("\n\n");
  const sorted = sortWarmForInject(parseWarm(warm));
  // high 组内：保持写入序（09-01 → 09-02 → 09-04 写入序），不按 last_access 重排；
  // 即使 09-04 的 last_access 最旧（09-01 07:00）也不沉底；medium 时间衰减排在高之后。
  const order = sorted.map((e) => (e.block.includes("old verified") ? "old" : e.block.includes("newer verified") ? "newer" : e.block.includes("oldest verified") ? "oldest" : "recent"));
  assert.deepEqual(order, ["old", "newer", "oldest", "recent"]);
});

test("conf: renderWarmEntries 低置信带标记、wrong 默认跳过、编号基于原始索引", () => {
  const entries = parseWarm(WARM_FIXTURE);
  const plain = renderWarmEntries(entries);
  assert.ok(plain.includes("【低置信·需验证】"));
  assert.ok(!plain.includes("2026-11-15"), "wrong 条目默认不注入");
  assert.ok(!plain.includes("【已翻转·勿引用】"));
  const numbered = renderWarmEntries(entries, { numbered: true, includeWrong: true });
  assert.ok(numbered.includes("[1] ## 2026-09-27 10:00 [fact] high"), "编号基于原始索引");
  assert.ok(numbered.includes("[4] 【已翻转·勿引用】"), "wrong 显示时编号基于原始索引且带勿引用标记");
});

test("conf: findWarmEntryRef 支持编号/内容片段/无匹配", () => {
  assert.equal(findWarmEntryRef(WARM_FIXTURE, "[3]").index, 2);
  assert.equal(findWarmEntryRef(WARM_FIXTURE, "[9]"), null);
  assert.equal(findWarmEntryRef(WARM_FIXTURE, "用户偏好短句").index, 1);
  assert.equal(findWarmEntryRef(WARM_FIXTURE, "不存在的片段"), null);
});

test("conf: replaceWarmEntryText 替换命中条目且保留位置", () => {
  const next = replaceWarmEntryText(WARM_FIXTURE, "[2]", "## 2026-09-28 09:30 [preference] high\n\n用户偏好极短句。\n<!-- last_access: 2026-09-28 09:30 -->");
  assert.ok(next.includes("用户偏好极短句"));
  assert.ok(next.includes("sprint 1 截止 2026-03-29"));
  assert.ok(next.indexOf("用户偏好极短句") > next.indexOf("sprint 1 截止 2026-03-29"));
  assert.ok(next.indexOf("用户偏好极短句") < next.indexOf("可能迁移到 Render"));
});

test("conf: markWrongWarmEntryText 标 wrong 保留内容，无匹配返回 null", () => {
  const next = markWrongWarmEntryText(WARM_FIXTURE, "[1]");
  assert.ok(next.includes("sprint 1 截止 2026-03-29"));
  assert.ok(next.includes("[fact] wrong"), "标题 confidence 改为 wrong");
  assert.equal(markWrongWarmEntryText(WARM_FIXTURE, "[99]"), null);
});

test("conf: findNearDuplicateWarm 相等/包含命中，不同内容不命中", () => {
  const warm = "## 2026-09-27 10:00 [fact] high\n\nfirst sprint ends March 29\n<!-- last_access: 2026-09-27 10:00 -->\n";
  assert.equal(findNearDuplicateWarm(warm, "first sprint ends March 29").reason, "equal");
  assert.equal(findNearDuplicateWarm(warm, "first sprint ends **March 29**（已确认）").reason, "contains");
  assert.equal(findNearDuplicateWarm(warm, "first sprint ends November 15"), null);
});

test("conf: renderForInject 含低置信条目时附声明纪律说明", () => {
  const { root, track, layout } = makeLayout();
  track(join(root, "warm.md"), WARM_FIXTURE);
  const out = layout.renderForInject(6000);
  assert.ok(out.includes("记忆带置信度"));
  assert.ok(out.includes("引用存疑记忆必须先声明不确定"));
  assert.ok(!out.includes("2026-11-15"), "注入不含 wrong 条目");
});

test("identity: 判断纪律含置信度声明（含翻转事实禁用）", () => {
  assert.ok(DEFAULT_JUDGMENT.includes("置信度声明"));
  assert.ok(DEFAULT_JUDGMENT.includes("已翻转"));
  assert.ok(DEFAULT_JUDGMENT.includes("引用即失守"));
});

test("identity: 判断纪律不含针对评测形态的答题规则（如'背景题要拒答'）", () => {
  assert.ok(!DEFAULT_JUDGMENT.includes("回答边界"), "不得注入评测形态的具体答题规则（作弊嫌疑）");
  assert.ok(!DEFAULT_JUDGMENT.includes("背景题"), "不得把'背景题拒答'写进注入文本");
  assert.ok(!DEFAULT_JUDGMENT.includes("把记得的细节倒出来反而是泄漏"));
});

test("identity: 判断纪律含 HHH 价值排序（诚实>友善>有用）", () => {
  assert.ok(DEFAULT_JUDGMENT.includes("价值排序"));
  assert.ok(DEFAULT_JUDGMENT.includes("HHH"));
  assert.ok(DEFAULT_JUDGMENT.includes("诚实 > 友善 > 有用"));
  assert.ok(DEFAULT_JUDGMENT.includes("不编造讨喜的答案"));
});

test("identity: HHH 含'有用性最常被翻转'防御（悖论给方案/诱导确认）", () => {
  assert.ok(DEFAULT_JUDGMENT.includes("最常被翻转的是\"有用\""));
  assert.ok(DEFAULT_JUDGMENT.includes("Help 占上风"));
  assert.ok(DEFAULT_JUDGMENT.includes("诚实（承认无一致解）优先于有用（给方案）"));
  assert.ok(DEFAULT_JUDGMENT.includes("诱导确认"));
});

