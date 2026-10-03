import { tagKey, type TagCheck, type TagHit } from '@media-agent/shared';
import { hasCjk, type TagEntry, type TagLibrary } from './library';

const hit = (entry: TagEntry, alias?: string): TagHit => ({
  tag: entry.tag,
  zh: entry.zh,
  category: entry.category,
  count: entry.count,
  ...(alias && { alias }),
});

// 打字联想：中文比中文名和常用叫法，英文比标签名和官方别名；完全一样的在前，再是开头对上的，再是中间对上的；同一档按使用次数
export function searchTags(library: TagLibrary, query: string, limit = 20): TagHit[] {
  const text = query.trim();
  if (!text) return [];
  return hasCjk(text) ? searchChinese(library, text, limit) : searchEnglish(library, tagKey(text), limit);
}

// 0 完全一样、1 开头、2 中间，对不上是 -1
const tierOf = (candidate: string, query: string) => (candidate === query ? 0 : candidate.startsWith(query) ? 1 : candidate.includes(query) ? 2 : -1);

function merge(tiers: TagHit[][], limit: number): TagHit[] {
  const seen = new Set<string>();
  const result: TagHit[] = [];
  for (const item of tiers.flat()) {
    if (seen.has(item.tag)) continue;
    seen.add(item.tag);
    result.push(item);
    if (result.length === limit) break;
  }
  return result;
}

function searchEnglish(library: TagLibrary, key: string, limit: number): TagHit[] {
  const tiers: TagHit[][] = [[], [], []];
  for (const entry of library.entries) {
    if (entry.deprecated) continue;
    const tier = tierOf(entry.tag, key);
    if (tier >= 0 && tiers[tier].length < limit) tiers[tier].push(hit(entry));
  }
  // 官方别名只比开头
  const byAlias: TagHit[] = [];
  for (const [alias, tag] of library.aliases) {
    const entry = library.byTag.get(tag)!;
    if (!entry.deprecated && alias.startsWith(key)) byAlias.push(hit(entry, alias));
  }
  byAlias.sort((a, b) => b.count - a.count);
  return merge([...tiers, byAlias], limit);
}

function searchChinese(library: TagLibrary, query: string, limit: number): TagHit[] {
  const tiers: TagHit[][] = [[], [], []];
  for (const entry of library.entries) {
    if (entry.deprecated) continue;
    // 中文名对上的比常用叫法对上的优先；靠叫法对上的记下是哪个
    let best = entry.zh ? tierOf(entry.zh, query) : -1;
    let alias: string | undefined;
    for (const name of entry.zhAliases) {
      const tier = tierOf(name, query);
      if (tier >= 0 && (best < 0 || tier < best)) {
        best = tier;
        alias = name;
      }
    }
    if (best >= 0 && tiers[best].length < limit) tiers[best].push(hit(entry, alias));
  }
  return merge(tiers, limit);
}

// 校验一个标签：在词库里、是别名，或者不认识（给最接近的 5 个）。
// known 是这个系列固定开头和评级词里的词，算认识，但不给 tag，拼提示词时原样照写（Pony 的 score_9 要留着下划线）
export function checkTag(library: TagLibrary, input: string, known: Set<string> = new Set()): TagCheck {
  const key = tagKey(input);
  const entry = library.byTag.get(key);
  if (entry && !entry.deprecated) return { input, status: 'ok', tag: entry.tag, zh: entry.zh, category: entry.category, count: entry.count };
  if (known.has(key)) return { input, status: 'ok' };
  const target = library.aliases.get(key);
  if (target) {
    const found = library.byTag.get(target)!;
    if (!found.deprecated) return { input, status: 'alias', tag: found.tag, zh: found.zh, category: found.category, count: found.count };
  }
  return { input, status: 'unknown', suggestions: suggest(library, key, 5) };
}

// 先用搜索取，不够再按编辑距离补：比标签名、官方别名、对照表里的英文叫法，都指回标签
function suggest(library: TagLibrary, key: string, limit: number): TagHit[] {
  const found = hasCjk(key) ? searchChinese(library, key, limit) : searchEnglish(library, key, limit);
  if (found.length >= limit) return found;
  const max = Math.min(3, Math.max(1, Math.floor(key.length / 4)));
  const close: { distance: number; entry: TagEntry }[] = [];
  for (const { key: candidate, tag } of library.near) {
    if (Math.abs(candidate.length - key.length) > max) continue;
    const distance = editDistance(key, candidate, max);
    const entry = library.byTag.get(tag)!;
    if (distance <= max && !entry.deprecated) close.push({ distance, entry });
  }
  close.sort((a, b) => a.distance - b.distance || b.entry.count - a.entry.count);
  return merge([found, close.map(({ entry }) => hit(entry))], limit);
}

// 编辑距离，超过 max 就提前停，返回 max + 1
function editDistance(a: string, b: string, max: number): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j += 1) {
      const value = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      current.push(value);
      if (value < rowMin) rowMin = value;
    }
    if (rowMin > max) return max + 1;
    previous = current;
  }
  return previous[b.length];
}
