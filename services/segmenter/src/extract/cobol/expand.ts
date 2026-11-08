// Inlines COPY members so the extractor sees literals and code that live in copybooks.
// Unknown copybooks are left as-is (the COPY statement still yields an edge).
const COPY_RE = /^(.{6}[ \-].*?)\bCOPY\s+['"]?([A-Z0-9][A-Z0-9-]*)['"]?[^.]*\.?/i;

export function expandCopybooks(
  source: string,
  lookup: (name: string) => string | undefined,
  maxDepth = 5,
): string {
  const walk = (src: string, depth: number, stack: string[]): string =>
    src
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((line) => {
        if (line.length > 6 && (line[6] === '*' || line[6] === '/')) return line;
        const m = line.match(COPY_RE);
        if (!m || depth >= maxDepth) return line;
        const name = m[2].toUpperCase();
        const body = stack.includes(name) ? undefined : lookup(name);
        // Keep the COPY line itself (for the copybook edge), then the member's text.
        return body === undefined ? line : `${line}\n${walk(body, depth + 1, [...stack, name])}`;
      })
      .join('\n');
  return walk(source, 0, []);
}
