// One chain write at a time from one signer: uploads and txs never race for the nonce.
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();
  pending = 0;

  run<T>(job: () => Promise<T>): Promise<T> {
    this.pending++;
    const next = this.tail.then(job).finally(() => this.pending--);
    this.tail = next.catch(() => undefined);
    return next;
  }
}


// Sequential upload+anchor queue: never run two uploads concurrently.
// Nonce-safe: read the current nonce from the chain before each tx.
// On crash recovery: rebuild the missing segment from the chain
// (anchorSegment stores the root; the records are in the JSONL spool).
let _queueBusy = false;
const _queue: Array<() => Promise<void>> = [];

export function enqueue(task: () => Promise<void>) {
  _queue.push(task);
  if (!_queueBusy) _drain();
}
