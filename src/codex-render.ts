import { randomInt } from 'node:crypto';
import { Transform } from 'node:stream';

// shortcut: isolate Codex's fixed pet image IDs until Warp scopes them to each terminal session.
export function codexImageFilter() {
  const first = randomInt(0x20000000, 0x70000000) * 2, prefix = '\x1b_G';
  let pending = '';
  return new Transform({
    transform(chunk, encoding, done) {
      pending += chunk.toString('latin1');
      while (pending) {
        const start = pending.indexOf(prefix);
        if (start < 0) {
          const hold = pending.endsWith('\x1b_') ? 2 : pending.endsWith('\x1b') ? 1 : 0;
          this.push(Buffer.from(pending.slice(0, pending.length - hold), 'latin1'));
          pending = pending.slice(pending.length - hold); break;
        }
        if (start) { this.push(Buffer.from(pending.slice(0, start), 'latin1')); pending = pending.slice(start); }
        const end = pending.indexOf(';');
        if (end < 0 && pending.length <= 1024) break;
        if (end < 0 || end > 1024 || pending.slice(3, end).includes('\x1b')) {
          this.push(Buffer.from(prefix, 'latin1')); pending = pending.slice(prefix.length); continue;
        }
        const header = pending.slice(0, end).replace(/,i=(49374|49375)(?=,|$)/g, (_, id) => `,i=${first + Number(id) - 49374}`);
        this.push(Buffer.from(header + ';', 'latin1')); pending = pending.slice(end + 1);
      }
      done();
    },
    flush(done) { this.push(Buffer.from(pending, 'latin1')); done(); },
  });
}
