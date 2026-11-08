// identity: who is signed on, and security checks.
import type { Scanner } from './util';
import { Collector, execBlocks } from './util';

export const identity: Scanner = (prog) => {
  const c = new Collector(prog, 'identity');
  for (const block of execBlocks(prog, 'CICS')) {
    if (/^\s*ASSIGN\b/.test(block.body) && /\b(USERID|USERNAME|OPID|OPCLASS)\s*\(/.test(block.body)) {
      c.edge('identity:user', 'reads-identity', block.offset, 'extracted', 'CICS ASSIGN USERID');
    }
    const sec = /^\s*(QUERY\s+SECURITY|VERIFY\s+PASSWORD|SIGNON|SIGNOFF|CHANGE\s+PASSWORD|EXTRACT\s+CERTIFICATE)\b/.exec(block.body);
    if (sec) c.edge('identity:security', 'checks-identity', block.offset, 'extracted', `CICS ${sec[1].replace(/\s+/g, ' ')}`);
  }
  return c.result;
};
