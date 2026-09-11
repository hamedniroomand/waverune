function line(cells: (string | number | boolean)[]): string {
  return `| ${cells.map(String).join(' | ')} |`;
}

/** Render rows as a GitHub-flavoured markdown table. */
export function markdownTable(headers: string[], rows: (string | number | boolean)[][]): string {
  return [line(headers), `| ${headers.map(() => '---').join(' | ')} |`, ...rows.map(line)].join(
    '\n',
  );
}

export function fmt(n: number, digits = 3): string {
  return Number.isFinite(n) ? n.toFixed(digits) : String(n);
}

export function elapsed(start: number): string {
  return `${((performance.now() - start) / 1000).toFixed(1)} s`;
}
