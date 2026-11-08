// The rewrite stream: what the server sends while Nemotron writes the Java for one program, compiles
// it, fixes what javac or the diff rejects, runs the sandbox scenarios and diffs the output against the
// COBOL. Shapes mirror services/rewrite/src/types.ts (RewriteEvent); replay plays a recorded live run.
import type { RewriteEvent, RewriteResult } from '../../../../services/rewrite/src/types';

export type { RewriteEvent, RewriteResult };
export type { Mismatch, ScenarioResult } from '../../../../services/rewrite/src/types';

export interface RewriteStream { close(): void }

/** Not in the server's union yet: emitted when the streamed Java names a COBOL paragraph. */
export interface FocusEvent { type: 'focus'; ref: string; label?: string; pass?: number }
export type StreamEvent = RewriteEvent | FocusEvent;
export type StreamMode = 'replay' | 'live' | 'watch';

/**
 * Opens GET /api/rewrite/stream over fetch (not EventSource) so a 404 "not rewritten" is visible to
 * the caller as an error event instead of a silent reconnect loop.
 */
export function openRewriteStream(source: string, program: string, mode: StreamMode, onEvent: (e: StreamEvent) => void, paceMs?: number): RewriteStream {
  const ctrl = new AbortController();
  let closed = false;
  const url = `/api/rewrite/stream?source=${encodeURIComponent(source)}&program=${encodeURIComponent(program)}&mode=${mode}${paceMs ? `&pace=${paceMs}` : ''}`;
  (async () => {
    try {
      const r = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'text/event-stream' } });
      if (!r.ok || !r.body) {
        const body = await r.text().catch(() => '');
        onEvent({ type: 'error', message: r.status === 404 ? (mode === 'watch' ? `${program} is not running right now.` : `${program} has not been rewritten yet.`) : `Rewrite stream failed (${r.status}) ${body.slice(0, 120)}` });
        return;
      }
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done || closed) break;
        buf += dec.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const data = frame.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('\n');
          if (data) onEvent(JSON.parse(data) as StreamEvent);
        }
      }
    } catch (err) {
      if (!closed) onEvent({ type: 'error', message: err instanceof Error ? err.message : 'Lost the connection to the dev server' });
    }
  })();
  return { close() { closed = true; ctrl.abort(); } };
}

export interface RewriteListing { threshold: number; programs: { program: string; status: string; matchRate: number; at: string; running?: boolean }[] }

export async function fetchRewriteList(source: string): Promise<RewriteListing | null> {
  try {
    const r = await fetch(`/api/rewrite/list?source=${encodeURIComponent(source)}`);
    return r.ok ? ((await r.json()) as RewriteListing) : null;
  } catch { return null; }
}

/** Nemotron sometimes wraps the file in a ```java fence; the editor shows the file, not the fence. */
export function stripFence(text: string): string {
  return text.replace(/^```[a-z]*\n/, '').replace(/\n```\s*$/, '');
}
