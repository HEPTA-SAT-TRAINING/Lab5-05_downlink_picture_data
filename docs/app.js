import { SerialConnection, formatPortLabel } from "./serial.js";
import { crc16CcittFalse, verifyCrc16SelfTest } from "./crc16.js";
import { ByteLineBuffer } from "./byte_line_buffer.js";
import {
  PacketReceiver,
  parseStartPayload,
  PACKET_TYPE_START,
  PACKET_TYPE_DATA,
  PACKET_TYPE_END,
  PACKET_TYPE_ERROR,
  FORMAT_JPEG,
  ERROR_MESSAGES,
} from "./packet.js";

const RxState = {
  TEXT_MODE: "TEXT_MODE",
  IMAGE_PACKET_RX: "IMAGE_PACKET_RX",
};

const PACKET_TIMEOUT_MS = 10000;
const IMAGE_TIMEOUT_MS = 60000;

const HK_RE =
  /^TEMP=([-\d.]+),VBAT=([-\d.]+),V5=([-\d.]+),V3V3=([-\d.]+),SAP=([-\d.]+),IDIS=([-\d.]+),ICHG=([-\d.]+)/;

const ACCEL_RE = /^AX=([-\d.]+),AY=([-\d.]+),AZ=([-\d.]+)/;

/** @type {SerialConnection} */
const serial = new SerialConnection();

/** @type {PacketReceiver} */
const packetReceiver = new PacketReceiver();

let rxState = RxState.TEXT_MODE;
const textBuffer = new ByteLineBuffer();
const textDecoder = new TextDecoder();
let imageReceiving = false;
let expectedSeq = 0;
let expectedTotal = 0;
/** @type {{ format: number, imageId: number, imageSize: number, imageCrc16: number } | null} */
let imageMeta = null;
/** @type {Uint8Array[]} */
let imageChunks = [];
let receivedBytes = 0;
/** @type {Blob | null} */
let currentImageBlob = null;
let lastImageId = 0;
/** @type {number | null} */
let packetTimer = null;
/** @type {number | null} */
let imageTimer = null;
/** @type {SerialPort[]} */
let grantedPorts = [];

// DOM elements
const el = {
  portSelect: document.getElementById("port-select"),
  btnAddPort: document.getElementById("btn-add-port"),
  btnRefreshPorts: document.getElementById("btn-refresh-ports"),
  btnConnect: document.getElementById("btn-connect"),
  btnDisconnect: document.getElementById("btn-disconnect"),
  btnSendA: document.getElementById("btn-send-a"),
  btnSendP: document.getElementById("btn-send-p"),
  btnClearLog: document.getElementById("btn-clear-log"),
  btnSaveJpeg: document.getElementById("btn-save-jpeg"),
  baudrate: document.getElementById("baudrate"),
  connectionStatus: document.getElementById("connection-status"),
  imageStatus: document.getElementById("image-status"),
  imageProgress: document.getElementById("image-progress"),
  imagePreview: document.getElementById("image-preview"),
  log: document.getElementById("log"),
  hk: {
    temp: document.getElementById("hk-temp"),
    vbat: document.getElementById("hk-vbat"),
    v5: document.getElementById("hk-v5"),
    v3v3: document.getElementById("hk-v3v3"),
    sap: document.getElementById("hk-sap"),
    idis: document.getElementById("hk-idis"),
    ichg: document.getElementById("hk-ichg"),
  },
  accel: {
    ax: document.getElementById("accel-ax"),
    ay: document.getElementById("accel-ay"),
    az: document.getElementById("accel-az"),
  },
};

function init() {
  if (!verifyCrc16SelfTest()) {
    console.error("CRC-16 self-test failed");
    log("ERROR: CRC-16 self-test failed (expected 0x29B1 for '123456789')", "error");
  } else {
    console.log("CRC-16 self-test passed (0x29B1)");
  }

  serial.onData = onSerialChunk;
  serial.onError = (err) => {
    log(`Serial error: ${err.message}`, "error");
    setConnectionUi(false);
  };
  serial.onDisconnect = () => {
    log("Serial port disconnected", "warn");
    setConnectionUi(false);
    resetImageReceive("Disconnected during image receive");
  };

  el.btnAddPort.addEventListener("click", onAddPort);
  el.btnRefreshPorts.addEventListener("click", () => refreshPortList());
  el.portSelect.addEventListener("change", updateConnectButton);
  el.btnConnect.addEventListener("click", onConnect);
  el.btnDisconnect.addEventListener("click", onDisconnect);
  el.btnSendA.addEventListener("click", () => sendCommand("a"));
  el.btnSendP.addEventListener("click", () => sendCommand("p"));
  el.btnClearLog.addEventListener("click", clearLog);
  el.btnSaveJpeg.addEventListener("click", saveJpeg);

  setConnectionUi(false);
  refreshPortList();
}

/**
 * @param {SerialPort | null | undefined} selectPort
 */
async function refreshPortList(selectPort) {
  const previousIndex = el.portSelect.value;

  try {
    grantedPorts = await SerialConnection.getGrantedPorts();
  } catch (err) {
    log(`Failed to list ports: ${err instanceof Error ? err.message : String(err)}`, "error");
    grantedPorts = [];
  }

  el.portSelect.textContent = "";

  if (grantedPorts.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No port — click Add Port";
    option.disabled = true;
    option.selected = true;
    el.portSelect.appendChild(option);
  } else {
    grantedPorts.forEach((port, index) => {
      const option = document.createElement("option");
      option.value = String(index);
      option.textContent = formatPortLabel(port, index);
      el.portSelect.appendChild(option);
    });

    if (selectPort) {
      const idx = grantedPorts.indexOf(selectPort);
      if (idx >= 0) {
        el.portSelect.value = String(idx);
      }
    } else if (previousIndex !== "" && Number(previousIndex) < grantedPorts.length) {
      el.portSelect.value = previousIndex;
    } else {
      el.portSelect.value = "0";
    }
  }

  updateConnectButton();
}

function updateConnectButton() {
  const hasSelection =
    grantedPorts.length > 0 && el.portSelect.value !== "" && !serial.isConnected;
  el.btnConnect.disabled = !hasSelection;
}

function getSelectedPort() {
  if (el.portSelect.value === "") {
    return null;
  }
  const index = Number(el.portSelect.value);
  if (!Number.isInteger(index) || index < 0 || index >= grantedPorts.length) {
    return null;
  }
  return grantedPorts[index];
}

async function onAddPort() {
  try {
    const port = await SerialConnection.requestNewPort();
    await refreshPortList(port);
    log(`Port added: ${formatPortLabel(port, grantedPorts.indexOf(port))}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("cancel")) {
      log(`Add port failed: ${msg}`, "error");
    }
  }
}

/**
 * @param {string} message
 * @param {"info" | "error" | "warn"} [level]
 */
function log(message, level = "info") {
  const ts = new Date().toLocaleTimeString();
  const line = document.createElement("div");
  line.className = `line-${level}`;
  line.textContent = `[${ts}] ${message}`;
  el.log.appendChild(line);
  el.log.scrollTop = el.log.scrollHeight;
}

function clearLog() {
  el.log.textContent = "";
}

/**
 * @param {boolean} connected
 */
function setConnectionUi(connected) {
  el.btnDisconnect.disabled = !connected;
  el.portSelect.disabled = connected;
  el.btnAddPort.disabled = connected;
  el.btnRefreshPorts.disabled = connected;
  el.baudrate.disabled = connected;
  updateConnectButton();
  if (connected) {
    el.btnConnect.disabled = true;
  }
  el.connectionStatus.textContent = connected
    ? imageReceiving
      ? "Connected (receiving image)"
      : "Connected"
    : "Disconnected";
  el.connectionStatus.className = `status-badge ${
    connected ? (imageReceiving ? "receiving" : "connected") : "disconnected"
  }`;
  updateCommandButtons();
}

function updateCommandButtons() {
  const connected = serial.isConnected;
  const busy = imageReceiving;
  el.btnSendA.disabled = !connected || busy;
  el.btnSendP.disabled = !connected || busy;
}

/**
 * @param {Uint8Array} chunk
 */
function onSerialChunk(chunk) {
  if (rxState === RxState.TEXT_MODE) {
    processTextChunk(chunk);
  } else {
    processImageChunk(chunk);
  }
}

/**
 * @param {Uint8Array} chunk
 */
function processTextChunk(chunk) {
  textBuffer.push(chunk);

  while (true) {
    const lineBytes = textBuffer.shiftLine();
    if (lineBytes === null) {
      break;
    }

    const line = textDecoder.decode(lineBytes);

    if (line === "IMG_BEGIN" || line === "IMG_END") {
      if (line === "IMG_END") {
        log("IMG_END received");
        continue;
      }
      beginImageReceive();
      // Preserve binary bytes that arrived in the same serial chunk.
      const remainder = textBuffer.takeRemaining();
      if (remainder.length > 0) {
        processImageChunk(remainder);
      }
      return;
    }

    handleTextLine(line);
  }
}

/**
 * @param {string} line
 */
function handleTextLine(line) {
  if (!line) {
    return;
  }

  log(line);

  const hkMatch = line.match(HK_RE);
  if (hkMatch) {
    el.hk.temp.textContent = `${hkMatch[1]} °C`;
    el.hk.vbat.textContent = `${hkMatch[2]} V`;
    el.hk.v5.textContent = `${hkMatch[3]} V`;
    el.hk.v3v3.textContent = `${hkMatch[4]} V`;
    el.hk.sap.textContent = `${hkMatch[5]} V`;
    el.hk.idis.textContent = `${hkMatch[6]} A`;
    el.hk.ichg.textContent = `${hkMatch[7]} A`;
    return;
  }

  const accelMatch = line.match(ACCEL_RE);
  if (accelMatch) {
    el.accel.ax.textContent = `${accelMatch[1]} m/s²`;
    el.accel.ay.textContent = `${accelMatch[2]} m/s²`;
    el.accel.az.textContent = `${accelMatch[3]} m/s²`;
  }
}

function beginImageReceive() {
  rxState = RxState.IMAGE_PACKET_RX;
  imageReceiving = true;
  packetReceiver.reset();
  imageMeta = null;
  imageChunks = [];
  receivedBytes = 0;
  expectedSeq = 0;
  expectedTotal = 0;

  if (currentImageBlob) {
    URL.revokeObjectURL(el.imagePreview.src);
    currentImageBlob = null;
  }
  el.imagePreview.hidden = true;
  el.imagePreview.removeAttribute("src");
  el.btnSaveJpeg.disabled = true;

  el.imageStatus.textContent = "Receiving image...";
  el.imageStatus.className = "image-status";
  el.imageProgress.textContent = "0 / 0 bytes";

  startImageTimeout();
  resetPacketTimeout();
  setConnectionUi(true);
  log("IMG_BEGIN detected — switching to binary packet mode", "warn");
}

/**
 * @param {Uint8Array} chunk
 */
function processImageChunk(chunk) {
  const packets = packetReceiver.push(chunk);

  for (const packet of packets) {
    resetPacketTimeout();

    try {
      handleImagePacket(packet);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      abortImageReceive(`Packet error: ${msg}`);
      return;
    }
  }
}

/**
 * @param {ReturnType<import("./packet.js").parsePacket>} packet
 */
function handleImagePacket(packet) {
  if (expectedTotal > 0 && packet.total !== expectedTotal) {
    throw new Error(
      `TOTAL mismatch: expected ${expectedTotal}, got ${packet.total}`
    );
  }

  if (packet.seq !== expectedSeq) {
    throw new Error(
      `SEQ mismatch: expected ${expectedSeq}, got ${packet.seq}`
    );
  }

  switch (packet.type) {
    case PACKET_TYPE_START:
      handleStartPacket(packet);
      break;
    case PACKET_TYPE_DATA:
      handleDataPacket(packet);
      break;
    case PACKET_TYPE_END:
      handleEndPacket(packet);
      break;
    case PACKET_TYPE_ERROR:
      handleErrorPacket(packet);
      break;
    default:
      throw new Error(`Unknown packet TYPE 0x${packet.type.toString(16)}`);
  }
}

/**
 * @param {{ type: number, seq: number, total: number, len: number, payload: Uint8Array }} packet
 */
function handleStartPacket(packet) {
  const meta = parseStartPayload(packet.payload);
  if (meta.format !== FORMAT_JPEG) {
    throw new Error(`Unsupported image format 0x${meta.format.toString(16)}`);
  }

  imageMeta = meta;
  expectedTotal = packet.total;
  expectedSeq = 1;

  el.imageProgress.textContent = `0 / ${meta.imageSize} bytes`;
  log(
    `START: id=${meta.imageId}, size=${meta.imageSize}, image_crc=0x${meta.imageCrc16.toString(16).padStart(4, "0")}, total_packets=${packet.total}`
  );
}

/**
 * @param {{ payload: Uint8Array }} packet
 */
function handleDataPacket(packet) {
  if (!imageMeta) {
    throw new Error("DATA packet before START");
  }

  imageChunks.push(packet.payload);
  receivedBytes += packet.payload.length;
  expectedSeq += 1;

  el.imageProgress.textContent = `${receivedBytes} / ${imageMeta.imageSize} bytes`;
}

/**
 * @param {{ seq: number, total: number }} packet
 */
function handleEndPacket(packet) {
  if (!imageMeta) {
    throw new Error("END packet before START");
  }

  if (receivedBytes !== imageMeta.imageSize) {
    throw new Error(
      `Size mismatch: received ${receivedBytes}, expected ${imageMeta.imageSize}`
    );
  }

  const imageBytes = concatChunks(imageChunks, receivedBytes);
  const computedCrc = crc16CcittFalse(imageBytes);

  if (computedCrc !== imageMeta.imageCrc16) {
    throw new Error(
      `Image CRC mismatch: expected 0x${imageMeta.imageCrc16.toString(16).padStart(4, "0")}, got 0x${computedCrc.toString(16).padStart(4, "0")}`
    );
  }

  lastImageId = imageMeta.imageId;
  currentImageBlob = new Blob([imageBytes], { type: "image/jpeg" });
  const url = URL.createObjectURL(currentImageBlob);
  el.imagePreview.src = url;
  el.imagePreview.hidden = false;
  el.btnSaveJpeg.disabled = false;

  el.imageStatus.textContent = `Image received (${imageMeta.imageSize} bytes, id=${imageMeta.imageId})`;
  el.imageStatus.className = "image-status success";

  log(
    `Image complete: ${imageMeta.imageSize} bytes, CRC OK (0x${computedCrc.toString(16).padStart(4, "0")})`
  );

  finishImageReceive();
}

/**
 * @param {{ payload: Uint8Array }} packet
 */
function handleErrorPacket(packet) {
  const code = packet.payload.length > 0 ? packet.payload[0] : 0;
  const desc = ERROR_MESSAGES[code] ?? `unknown error 0x${code.toString(16)}`;
  abortImageReceive(`ERROR packet: ${desc} (0x${code.toString(16).padStart(2, "0")})`);
}

/**
 * @param {Uint8Array[]} chunks
 * @param {number} totalLength
 * @returns {Uint8Array}
 */
function concatChunks(chunks, totalLength) {
  const out = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function flushPacketBufferToText() {
  if (packetReceiver.buffer.length > 0) {
    processTextChunk(packetReceiver.buffer);
    packetReceiver.reset();
  }
}

function finishImageReceive() {
  clearTimeouts();
  rxState = RxState.TEXT_MODE;
  imageReceiving = false;
  imageMeta = null;
  imageChunks = [];
  receivedBytes = 0;
  expectedSeq = 0;
  expectedTotal = 0;
  flushPacketBufferToText();
  setConnectionUi(true);
  log("Image receive complete — back to TEXT_MODE");
}

/**
 * @param {string} reason
 */
function abortImageReceive(reason) {
  log(reason, "error");
  el.imageStatus.textContent = reason;
  el.imageStatus.className = "image-status error";
  resetImageReceive();
}

/**
 * @param {string} [reason]
 */
function resetImageReceive(reason) {
  clearTimeouts();
  rxState = RxState.TEXT_MODE;
  imageReceiving = false;
  flushPacketBufferToText();
  imageMeta = null;
  imageChunks = [];
  receivedBytes = 0;
  expectedSeq = 0;
  expectedTotal = 0;
  setConnectionUi(serial.isConnected);
  if (reason) {
    el.imageStatus.textContent = reason;
    el.imageStatus.className = "image-status error";
  }
}

function clearTimeouts() {
  if (packetTimer !== null) {
    clearTimeout(packetTimer);
    packetTimer = null;
  }
  if (imageTimer !== null) {
    clearTimeout(imageTimer);
    imageTimer = null;
  }
}

function resetPacketTimeout() {
  if (packetTimer !== null) {
    clearTimeout(packetTimer);
  }
  packetTimer = setTimeout(() => {
    abortImageReceive("Packet timeout (3 s)");
  }, PACKET_TIMEOUT_MS);
}

function startImageTimeout() {
  if (imageTimer !== null) {
    clearTimeout(imageTimer);
  }
  imageTimer = setTimeout(() => {
    abortImageReceive("Image timeout (30 s)");
  }, IMAGE_TIMEOUT_MS);
}

async function onConnect() {
  const port = getSelectedPort();
  if (!port) {
    log("Select a COM port or click Add Port", "error");
    return;
  }

  const baud = parseInt(el.baudrate.value, 10);
  if (!Number.isFinite(baud) || baud <= 0) {
    log("Invalid baudrate", "error");
    return;
  }

  const portLabel = formatPortLabel(port, Number(el.portSelect.value));

  try {
    await serial.connect(port, baud);
    setConnectionUi(true);
    log(`Connected to ${portLabel} at ${baud} baud`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("cancel")) {
      log(`Connect failed: ${msg}`, "error");
    }
  }
}

async function onDisconnect() {
  try {
    await serial.disconnect();
  } catch (err) {
    log(`Disconnect error: ${err instanceof Error ? err.message : String(err)}`, "error");
  }
  resetImageReceive();
  setConnectionUi(false);
  log("Disconnected");
}

/**
 * @param {string} cmd
 */
async function sendCommand(cmd) {
  if (!serial.isConnected) {
    return;
  }
  if (imageReceiving) {
    log("Cannot send command while receiving image", "warn");
    return;
  }

  try {
    await serial.write(cmd);
    log(`Sent command: '${cmd}'`);
    if (cmd === "p") {
      log("Waiting for IMG_BEGIN...", "warn");
    }
  } catch (err) {
    log(`Send failed: ${err instanceof Error ? err.message : String(err)}`, "error");
  }
}

function saveJpeg() {
  if (!currentImageBlob) {
    return;
  }
  const id = lastImageId;
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(currentImageBlob);
  a.download = `hepta_image_${id}_${ts}.jpg`;
  a.click();
  URL.revokeObjectURL(a.href);
  log(`Saved JPEG as ${a.download}`);
}

init();
