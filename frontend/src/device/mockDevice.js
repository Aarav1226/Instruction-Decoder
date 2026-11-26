/**
 * Fake ESP32 Mock Device for testing without hardware
 * Strictly following Section 10 of DEVICE_GUIDE.md
 */

import { decodeInstructionJS, MEMORY_MAPS } from '../components/hardware/hardwareUtils';

let messageCallback = null;
let currentMap = MEMORY_MAPS.DEFAULT;
let isConnected = false;
let isReady = false;

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

  // Simulate ESP32 reboot delay upon connection
  setTimeout(() => {
    if (isConnected) {
      isReady = true;
      if (messageCallback) {
        // Section 8: {"type":"ready"}
        messageCallback({ type: 'ready' });
      }
    }
  }, 400);

  return true;
}

export async function sendInstruction(hex) {
  if (!isConnected || !isReady) {
    throw new Error('Device is not ready to receive instructions');
  }

  // Generate exact decode result per Section 8
  const result = decodeInstructionJS(hex, currentMap);

  setTimeout(() => {
    if (messageCallback) {
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
  }, 100);

  return hex;
}

export async function switchMap() {
  if (!isConnected || !isReady) {
    throw new Error('Device is not ready to switch map');
  }

  currentMap = currentMap === MEMORY_MAPS.DEFAULT ? MEMORY_MAPS.OVERLAP : MEMORY_MAPS.DEFAULT;

  setTimeout(() => {
    if (messageCallback) {
      // Section 8: {"type":"map","map":"Overlap","overlap":true}
      messageCallback({
        type: 'map',
        map: currentMap,
        overlap: currentMap === MEMORY_MAPS.OVERLAP,
      });
    }
  }, 100);

  return true;
}

export async function disconnectDevice() {
  isConnected = false;
  isReady = false;
  if (messageCallback) {
    messageCallback({
      type: 'status',
      status: 'Disconnected',
      reason: 'Mock device disconnected.',
    });
  }
}
