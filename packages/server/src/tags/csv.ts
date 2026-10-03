// 读 CSV：双引号里的逗号和换行算内容，两个双引号是一个双引号；去掉开头的 BOM
export function parseCsv(text: string): string[][] {
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let i = 0;
  while (i < s.length) {
    let field: string;
    if (s[i] === '"') {
      const parts: string[] = [];
      let from = i + 1;
      for (;;) {
        const quote = s.indexOf('"', from);
        if (quote < 0) {
          parts.push(s.slice(from));
          i = s.length;
          break;
        }
        parts.push(s.slice(from, quote));
        if (s[quote + 1] === '"') {
          parts.push('"');
          from = quote + 2;
        } else {
          i = quote + 1;
          break;
        }
      }
      field = parts.join('');
    } else {
      let end = i;
      while (end < s.length && s[end] !== ',' && s[end] !== '\n' && s[end] !== '\r') end += 1;
      field = s.slice(i, end);
      i = end;
    }
    row.push(field);
    if (s[i] === ',') {
      i += 1;
      if (i === s.length) row.push('');
    } else {
      if (s[i] === '\r') i += 1;
      if (s[i] === '\n') i += 1;
      rows.push(row);
      row = [];
    }
  }
  if (row.length) rows.push(row);
  return rows;
}

// 写一行 CSV：含逗号、双引号、换行的字段用双引号包起来
export function csvRow(fields: (string | number)[]): string {
  return fields.map((field) => (/[",\r\n]/.test(String(field)) ? `"${String(field).replace(/"/g, '""')}"` : String(field))).join(',');
}
