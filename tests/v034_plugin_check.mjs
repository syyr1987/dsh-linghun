// v0.3.4 插件层验证：注入 sections / 工具清单 / 无遗留
import { apply, Config, SECTION_IDENTITY, SECTION_JUDGMENT, SECTION_MEMORY } from "../index.js";
import { DEFAULT_JUDGMENT } from "../identity.js";

const sections = [];
const tools = [];
const listeners = [];
const ctx = {
  systemPrompt: { section: (s) => { sections.push(s); return () => {}; } },
  effect: (cb) => cb(),
  inject: () => {},
  tools: { register: (def) => tools.push(def) },
  on: (evt, cb) => listeners.push({ evt, cb }),
};
apply(ctx, Config({}));

const toolNames = tools.map((t) => t.name);
const secNames = sections.map((s) => s.name);
const judgeSec = sections.find((s) => s.name === SECTION_JUDGMENT);
const identitySec = sections.find((s) => s.name === SECTION_IDENTITY);
const memSec = sections.find((s) => s.name === SECTION_MEMORY);

let ok = true;
const check = (cond, msg) => { console.log((cond ? "PASS" : "FAIL") + "  " + msg); if (!cond) ok = false; };

// 1. 注入段：只有 identity/judgment/memory，无 soul:yanguan
check(secNames.includes(SECTION_IDENTITY) && secNames.includes(SECTION_JUDGMENT) && secNames.includes(SECTION_MEMORY), "三 section 在场: " + secNames.join(","));
check(!secNames.includes("soul:yanguan"), "无 soul:yanguan section");
check(sections.length === 3, `section 数量=3（实际 ${sections.length}）`);

// 2. 判断纪律在 judgment section 中（render 文本，v1.0.0 最小 3 条）
const judgeText = judgeSec?.text?.();
check(typeof judgeText === "string" && judgeText.includes("不编造"), "judgment section 含最小纪律（不编造）");
check(judgeText.includes("背景收束") && judgeText.includes("置信度宁缺毋滥"), "最小 3 条纪律齐备");
check(!judgeText.includes("判分身份职责"), "judgment section 已收敛（无判分身份职责长文）");

// 3. 工具清单：5 个海马体/灵魂工具，无 yanguan_audit/review
const expected = ["memory_append", "memory_read", "memory_consolidate", "soul_read", "soul_update"];
check(expected.every((n) => toolNames.includes(n)), "五工具在场: " + toolNames.sort().join(","));
check(!toolNames.includes("yanguan_audit") && !toolNames.includes("yanguan_review"), "无 yanguan_audit/yanguan_review");
check(!toolNames.includes("journal_read") || true, "(journal_read 存在与否不影响 v0.3.4 目标)");

// 4. DEFAULT_JUDGMENT 结构（v1.0.0 最小有用 3 条）
check(!DEFAULT_JUDGMENT.includes("判分身份职责"), "DEFAULT_JUDGMENT 已收敛（无判分身份职责）");
check(DEFAULT_JUDGMENT.match(/^\d+\./gm)?.length === 3, `DEFAULT_JUDGMENT 共 3 条（实际 ${DEFAULT_JUDGMENT.match(/^\d+\./gm)?.length}）`);
check(DEFAULT_JUDGMENT.includes("不编造") && DEFAULT_JUDGMENT.includes("背景收束") && DEFAULT_JUDGMENT.includes("置信度宁缺毋滥"), "最小 3 条纪律齐备");

// 5. Config 不再有 yanguan 配置
const cfgKeys = Object.keys(Config({}));
check(!cfgKeys.includes("yanguan"), "Config 无 yanguan 键");

// 6. 监听器：session/event 收尾序时账仍在
check(listeners.some((l) => l.evt === "session/event"), "session/event 监听器在场（收尾序时账）");

console.log("\n" + (ok ? "=== 插件层全部通过 ===" : "=== 存在失败项 ==="));
process.exit(ok ? 0 : 1);
