/**
 * ESP32 Mock Device Simulator
 * Strictly following Section 8 & 10 of DEVICE_GUIDE.md
 * Provides offline testing and physical board button simulation
 */

import { decodeInstructionJS, MEMORY_MAPS, OFFICIAL_TEST_CASES } from '../components/hardware/hardwareUtils';

let messageCallback = null;
let currentMap = MEMORY_MAPS.DEFAULT;
let isConnected = false;
let isReady = false;
let currentSampleIndex = 0;

export function isSerialSupported() {
  return true;
}

export function isDeviceConnected() {
  return isConnected;
}

export function isDeviceReady() {
  return isConnected && isReady;
}

export async function connectDevice(onMessage) {
  messageCallback = onMessage;
  isConnected = true;
  isReady = false;

  // Inform listener that port is opening
  if (messageCallback) {
    messageCallback({
      type: 'status',
      status: 'Connecting',
      reason: 'Simulated USB Serial connection opening at 115200 baud...',
    });
  }

  // Simulate ESP32 boot delay (DEVICE_GUIDE.md Section 8)
  setTimeout(() => {
    if (isConnected) {
      isReady = true;
      if (messageCallback) {
        // Section 8: {"type":"ready"}
        messageCallback({ type: 'ready' });
      }
    }
  }, 450);

  return true;
}

export async function sendInstruction(hex) {
  if (!isConnected || !isReady) {
    throw new Error('Device is not ready to receive instructions');
  }

  const cleanHex = String(hex || '').trim().replace(/^0x/i, '').toUpperCase().padStart(4, '0');

  // Generate exact decode result per Section 8
  const result = decodeInstructionJS(cleanHex, currentMap);

  // Simulate serial roundtrip latency (~60-120ms)
  setTimeout(() => {
    if (isConnected && isReady && messageCallback) {
      messageCallback({
        type: 'decode',
        instr: result.instr,
        op: result.op,
        rd: result.rd,
        rs: result.rs,
        mode: result.mode,
        offset: result.offset,
        memAccess: result.memAccess,
        ea: result.ea,
        region: result.region,
        map: result.map,
        error: result.error,
      });
    }
  }, 90);

  return cleanHex;
}

export async function switchMap() {
  if (!isConnected || !isReady) {
    throw new Error('Device is not ready to switch map');
  }

  currentMap = currentMap === MEMORY_MAPS.DEFAULT ? MEMORY_MAPS.OVERLAP : MEMORY_MAPS.DEFAULT;

  setTimeout(() => {
    if (isConnected && isReady && messageCallback) {
      // Section 8: {"type":"map","map":"Overlap","overlap":true}
      messageCallback({
        type: 'map',
        map: currentMap,
        overlap: currentMap === MEMORY_MAPS.OVERLAP,
      });
    }
  }, 80);

  return true;
}

/**
 * Simulates physical buttons on the ESP32 (NEXT, INC, DECODE)
 * Per DEVICE_GUIDE.md Section 1:
 * "The application must also update when the instruction is decoded
 *  using the physical NEXT, INC and DECODE buttons on the ESP32."
 */
export function simulatePhysicalButton(buttonType = 'DECODE') {
  if (!isConnected || !isReady) {
    throw new Error('ESP32 board is not connected or ready.');
  }

  if (buttonType === 'NEXT') {
    currentSampleIndex = (currentSampleIndex + 1) % OFFICIAL_TEST_CASES.length;
  }

  const preset = OFFICIAL_TEST_CASES[currentSampleIndex];
  let hexToDecode = preset ? preset.code : '1A73';

  if (buttonType === 'INC') {
    const val = (parseInt(hexToDecode, 16) + 1) & 0xFFFF;
    hexToDecode = val.toString(16).toUpperCase().padStart(4, '0');
  }

  const result = decodeInstructionJS(hexToDecode, currentMap);

  setTimeout(() => {
    if (isConnected && isReady && messageCallback) {
      messageCallback({
        type: 'decode',
        instr: result.instr,
        op: result.op,
        rd: result.rd,
        rs: result.rs,
        mode: result.mode,
        offset: result.offset,
        memAccess: result.memAccess,
        ea: result.ea,
        region: result.region,
        map: result.map,
        error: result.error,
        deviceInitiated: true,
        buttonTrigger: buttonType,
      });
    }
  }, 60);

  return hexToDecode;
}

export async function disconnectDevice() {
  isConnected = false;
  isReady = false;
  if (messageCallback) {
    messageCallback({
      type: 'status',
      status: 'Disconnected',
      reason: 'USB connection closed.',
    });
  }
}
