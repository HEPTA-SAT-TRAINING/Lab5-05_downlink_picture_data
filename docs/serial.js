/**
 * Web Serial API wrapper for HEPTA-SAT downlink.
 */

/**
 * @param {SerialPort} port
 * @param {number} index
 * @returns {string}
 */
export function formatPortLabel(port, index) {
  const info = port.getInfo();
  const n = index + 1;

  if (info.usbVendorId !== undefined && info.usbProductId !== undefined) {
    const vid = info.usbVendorId.toString(16).padStart(4, "0").toUpperCase();
    const pid = info.usbProductId.toString(16).padStart(4, "0").toUpperCase();
    return `USB VID:0x${vid} PID:0x${pid} (#${n})`;
  }

  if (info.bluetoothServiceClassId) {
    return `Bluetooth (#${n})`;
  }

  return `Serial Port #${n}`;
}

export class SerialConnection {
  constructor() {
    /** @type {SerialPort | null} */
    this.port = null;
    /** @type {ReadableStreamDefaultReader<Uint8Array> | null} */
    this.reader = null;
    /** @type {boolean} */
    this.reading = false;
    /** @type {AbortController | null} */
    this.abortController = null;
    /** @type {((chunk: Uint8Array) => void) | null} */
    this.onData = null;
    /** @type {((err: Error) => void) | null} */
    this.onError = null;
    /** @type {(() => void) | null} */
    this.onDisconnect = null;
  }

  get isConnected() {
    return this.port !== null && this.reading;
  }

  /**
   * @returns {Promise<SerialPort[]>}
   */
  static async getGrantedPorts() {
    if (!("serial" in navigator)) {
      return [];
    }
    return navigator.serial.getPorts();
  }

  /**
   * @returns {Promise<SerialPort>}
   */
  static async requestNewPort() {
    if (!("serial" in navigator)) {
      throw new Error("Web Serial API is not supported. Use Chrome or Edge over HTTPS/localhost.");
    }
    return navigator.serial.requestPort();
  }

  /**
   * @param {SerialPort} port
   * @param {number} baudRate
   */
  async connect(port, baudRate) {
    if (!("serial" in navigator)) {
      throw new Error("Web Serial API is not supported. Use Chrome or Edge over HTTPS/localhost.");
    }

    if (!port) {
      throw new Error("No serial port selected");
    }

    if (this.port) {
      await this.disconnect();
    }

    this.port = port;
    await this.port.open({ baudRate });

    this.abortController = new AbortController();
    this.reading = true;
    this._readLoop(this.abortController.signal);
  }

  /**
   * @param {AbortSignal} signal
   */
  async _readLoop(signal) {
    if (!this.port?.readable) {
      return;
    }

    try {
      this.reader = this.port.readable.getReader();

      while (!signal.aborted) {
        const { value, done } = await this.reader.read();
        if (done) {
          break;
        }
        if (value && value.length > 0 && this.onData) {
          this.onData(value);
        }
      }
    } catch (err) {
      if (!signal.aborted && this.onError) {
        this.onError(err instanceof Error ? err : new Error(String(err)));
      }
    } finally {
      try {
        await this.reader?.releaseLock();
      } catch {
        // ignore
      }
      this.reader = null;
      this.reading = false;

      if (!signal.aborted && this.onDisconnect) {
        this.onDisconnect();
      }
    }
  }

  async disconnect() {
    this.abortController?.abort();
    this.abortController = null;

    try {
      await this.reader?.cancel();
    } catch {
      // ignore
    }

    if (this.port) {
      try {
        await this.port.close();
      } catch {
        // ignore
      }
    }

    this.port = null;
    this.reading = false;
  }

  /**
   * @param {string} text
   */
  async write(text) {
    if (!this.port?.writable) {
      throw new Error("Port is not open for writing");
    }
    const writer = this.port.writable.getWriter();
    try {
      const data = new TextEncoder().encode(text);
      await writer.write(data);
    } finally {
      writer.releaseLock();
    }
  }
}
