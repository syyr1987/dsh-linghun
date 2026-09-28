import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_IDENTITY, DEFAULT_JUDGMENT, DEFAULT_USER_CARD, ARCHITECTURE_PRIORITY, resolveIdentity } from "../identity.js";
import { createMemoryLayout, parseWarm, refreshWarmAccessText, renderWarmEntries, sortWarmByAccess } from "../memory.js";
import { Config, NS, apply, inject, name } from "../index.js";

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

test("time: refreshWarmAccessText 刷新全部条目 last_access", () => {
  const warm = [
    "## 2026-09-20 [fact]",
    "",
    "老条目。",
    "<!-- last_access: 2026-09-20 08:00 -->",
    "",
    "## 2026-09-28 [fact]",
    "",
    "新条目。",
    "<!-- last_access: 2026-09-28 12:00 -->",
  ].join("\n");
  const next = refreshWarmAccessText(warm, "2026-09-30 00:00");
  assert.ok(next.includes("last_access: 2026-09-30 00:00"));
  assert.ok(!next.includes("last_access: 2026-09-20"));
  assert.ok(!next.includes("last_access: 2026-09-28"));
});

test("time: refreshWarmAccessText 全部已最新时返回 null（不写盘）", () => {
  const warm = [
    "## 2026-09-20 [fact]",
    "",
    "老条目。",
    "<!-- last_access: 2026-09-30 00:00 -->",
  ].join("\n");
  assert.equal(refreshWarmAccessText(warm, "2026-09-30 00:00"), null);
});

// ── index.js 导出与配置 ─────────────────────────────────────────────────
test("index: 导出 Cordis 插件契约", () => {
  assert.equal(name, "linghun");
  assert.deepEqual(inject, ["systemPrompt", "tools"]);
  assert.equal(NS, "linghun");
  assert.equal(typeof apply, "function");
  assert.ok(Config);
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
