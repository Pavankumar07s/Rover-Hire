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
