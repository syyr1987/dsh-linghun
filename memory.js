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

    /** 注入用渲染：冷储摘要 + 暖态近期记忆 + 归档索引，截断到 maxChars。 */
    renderForInject(maxChars) {
      const cold = readFile(coldFile());
      const warm = readFile(warmFile());
      const episodes = listEpisodic();
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
