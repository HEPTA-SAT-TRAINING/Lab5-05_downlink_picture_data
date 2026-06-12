/**
 * Incremental byte buffer for a stream containing newline-delimited text.
 * Bytes after a matched line remain untouched so they can be passed to a
 * binary protocol parser.
 */
export class ByteLineBuffer {
  constructor() {
    /** @type {Uint8Array} */
    this.buffer = new Uint8Array(0);
  }

  /**
   * @param {Uint8Array} chunk
   */
  push(chunk) {
    if (chunk.length === 0) {
      return;
    }

    const merged = new Uint8Array(this.buffer.length + chunk.length);
    merged.set(this.buffer);
    merged.set(chunk, this.buffer.length);
    this.buffer = merged;
  }

  /**
   * Return the next line without LF or an optional preceding CR.
   * @returns {Uint8Array | null}
   */
  shiftLine() {
    const lfIndex = this.buffer.indexOf(0x0a);
    if (lfIndex < 0) {
      return null;
    }

    let lineEnd = lfIndex;
    if (lineEnd > 0 && this.buffer[lineEnd - 1] === 0x0d) {
      lineEnd -= 1;
    }

    const line = this.buffer.slice(0, lineEnd);
    this.buffer = this.buffer.slice(lfIndex + 1);
    return line;
  }

  takeRemaining() {
    const remaining = this.buffer;
    this.buffer = new Uint8Array(0);
    return remaining;
  }
}
