/**
 * 灵魂（Linghun）— 海马体记忆布局。
 *
 * 暖态工位 + 冷储归档，机制先行：
 *
 *   $DSH_HOME/linghun/memory/
 *   ├── warm.md          # 暖态工位：近期记忆（memory_append 写这里）
 *   ├── cold.md          # 冷储摘要：沉淀后的知识/规则（注入时优先读）
 *   └── episodic/        # 冷储归档：YYYY-MM-DD.md（memory_consolidate 时移入）
 */
import { readdirSync } from "node:fs";
import { basename, join } from "node:path";

export const WARM = "warm.md";
export const COLD = "cold.md";
export const EPISODIC_DIR = "episodic";

/** 解析 warm.md 为条目数组；每条提取 last_access 元数据（无则 null=视为最旧）。 */
export function parseWarm(text) {
  const blocks = String(text ?? "")
    .split(/\n(?=## )/)
    .map((b) => b.trim())
    .filter(Boolean);
  return blocks.map((block) => {
    const m = block.match(/<!-- last_access: ([^>]+) -->/);
    return { block, lastAccess: m ? m[1].trim() : null };
  });
}

/** 渲染条目为纯内容（剥掉 last_access 元数据），按原顺序 join。 */
export function renderWarmEntries(entries) {
  return entries
    .map((e) => e.block.replace(/\n?<!-- last_access: [^>]+ -->/, ""))
    .join("\n\n");
}

/** 按 last_access 降序排序（最近调用的在前）；缺失视为最旧沉底。 */
export function sortWarmByAccess(entries) {
  return [...entries].sort((a, b) => {
    const ta = a.lastAccess ?? "";
    const tb = b.lastAccess ?? "";
    return tb.localeCompare(ta, "en");
  });
}

/** 匹配前剥掉 markdown 格式标记（**、*、`），避免模型选的 ref 跨标记匹配失败。 */
export function normalizeForMatch(text) {
  return text.replace(/[*`]+/g, "");
}

/** 标记 warm 中「被用到」的条目（block 包含 ref 片段）刷新 last_access。
 *  读≠用：只有显式 touch 才算被调用=活跃。返回 { text, touched }；无变化 text=null。
 *  匹配时双方先剥 markdown 标记（normalizeForMatch），写盘保留原文。 */
export function touchWarmAccessText(warm, ref, stamp) {
  const entries = parseWarm(warm);
  const key = ref ? normalizeForMatch(ref).trim() : "";
  if (!entries.length || !key) return { text: null, touched: 0 };
  let changed = false;
  let touched = 0;
  const blocks = entries.map((e) => {
    if (!normalizeForMatch(e.block).includes(key)) return e.block;
    touched += 1;
    if (!/<!-- last_access: [^>]+ -->/.test(e.block)) {
      changed = true;
      return `${e.block}\n<!-- last_access: ${stamp} -->`;
    }
    const next = e.block.replace(
      /<!-- last_access: [^>]+ -->/,
      `<!-- last_access: ${stamp} -->`,
    );
    if (next !== e.block) changed = true;
    return next;
  });
  return { text: changed ? `${blocks.join("\n\n")}\n` : null, touched };
}

/**
 * @param root     记忆根目录（函数或字符串）
 * @param readText 读取函数，缺失时返回 null（可带 mtime 缓存）
 */
export function createMemoryLayout(root, readText) {
  const memoryRoot = () => (typeof root === "function" ? root() : root);

  const warmFile = () => join(memoryRoot(), WARM);
  const coldFile = () => join(memoryRoot(), COLD);
  const episodicDir = () => join(memoryRoot(), EPISODIC_DIR);

  const readFile = (file) => {
    const text = readText(file);
    return text === null ? "" : text;
  };

  const listEpisodic = () => {
    try {
      return readdirSync(episodicDir(), { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"))
        .sort((a, b) => a.name.localeCompare(b.name, "en"))
        .map((entry) => {
          const file = join(episodicDir(), entry.name);
          const text = readText(file);
          const lines = (text ?? "").split(/\r?\n/);
          const firstContent = lines.find((line) => line.trim() && !line.startsWith("#"));
          return {
            file,
            name: basename(entry.name, ".md"),
            title: firstContent ? firstContent.trim().slice(0, 120) : "",
          };
        });
    } catch {
      return [];
    }
  };

  return {
    warmFile,
    coldFile,
    episodicDir,
    readWarm: () => readFile(warmFile()),
    readCold: () => readFile(coldFile()),
    listEpisodic,

    /** 注入用渲染：冷储摘要 + 暖态近期记忆 + 归档索引，截断到 maxChars。
     *  opts.timeWeight !== false 时，暖态按 last_access 排序（新在前、吃灰沉底），
     *  超限从尾部裁剪——吃灰的记忆自然被挤出注入；同时剥掉元数据保持注入干净。 */
    renderForInject(maxChars, opts = {}) {
      const cold = readFile(coldFile());
      const warmRaw = readFile(warmFile());
      const episodes = listEpisodic();
      let warm = warmRaw;
      if (opts.timeWeight !== false && warmRaw.trim()) {
        const entries = sortWarmByAccess(parseWarm(warmRaw));
        warm = renderWarmEntries(entries);
      }
      const parts = [];
      if (cold.trim()) parts.push(cold.trim());
      if (warm.trim()) parts.push(`## 近期记忆 / Recent\n\n${warm.trim()}`);
      if (episodes.length) {
        const rows = episodes
          .map((e) => `- ${e.name}${e.title ? ` — ${e.title}` : ""}`)
          .join("\n");
        parts.push(`## 归档索引 / Archive\n${rows}`);
      }
      const rendered = parts.join("\n\n");
      if (!rendered) return "";
      const cap = Math.max(0, Math.floor(maxChars ?? 6000));
      if (rendered.length <= cap) return rendered;
      return `${rendered.slice(0, cap)}\n\n> 记忆超出注入上限，可用 memory_read 读取全文。`;
    },
  };
}
