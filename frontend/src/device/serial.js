/**
 * ESP32 Hardware Communication Layer (Web Serial API)
 * Strictly following Section 8 & 9 of DEVICE_GUIDE.md
 */

let activePort = null;
let streamWriter = null;
let streamReader = null;
let textDecoderStream = null;
let readableStreamClosed = null;
let lineBuffer = '';

let isConnected = false;
let isReady = false;
let messageCallback = null;
let disconnectListener = null;

export function isSerialSupported() {
  return typeof navigator !== 'undefined' && 'serial' in navigator;
}

export function isDeviceConnected() {
  return isConnected && activePort !== null;
}

export function isDeviceReady() {
  return isConnected && isReady && activePort !== null;
}

function notify(message) {
  if (typeof messageCallback === 'function') {
    try {
      messageCallback(message);
    } catch (err) {
      console.error('[Web Serial] Error in message callback:', err);
    }
  }
}

/**
 * Line parsing strictly following Section 8 of DEVICE_GUIDE.md:
 * "Ignore every line except the ones starting with JSON:.
 *  Remove the JSON: prefix and parse the rest as JSON."
 */
function processSerialLine(rawLine) {
  const trimmed = rawLine.trim();
  if (!trimmed) return;

  if (trimmed.startsWith('JSON:')) {
    try {
      const parsed = JSON.parse(trimmed.slice(5));
      if (parsed.type === 'ready') {
        isReady = true;
        isConnected = true;
      }
      notify(parsed);
    } catch (err) {
      console.warn('[Web Serial] Malformed JSON ignored:', trimmed.slice(5), err);
    }
  }
}

async function readLoop() {
  try {
    while (activePort && activePort.readable && streamReader) {
      const { value, done } = await streamReader.read();
      if (done) break;
      lineBuffer += value;
      const lines = lineBuffer.split('\n');
      lineBuffer = lines.pop() || ''; // keep any incomplete line
      for (const line of lines) {
        processSerialLine(line);
      }
    }
  } catch (err) {
    if (isConnected || isReady) {
      console.error('[Web Serial] Read loop error:', err);
      notify({
        type: 'error',
        error: `Serial read error: ${err.message || String(err)}`,
      });
    }
  } finally {
    if (isConnected || isReady) {
      isConnected = false;
      isReady = false;
      notify({
        type: 'status',
        status: 'Disconnected',
        reason: 'Serial port closed or disconnected.',
      });
    }
  }
}

/**
 * Section 9: connectDevice(onMessage)
 */
export async function connectDevice(onMessage) {
  if (!isSerialSupported()) {
    const errorMsg = 'Web Serial API is not supported in this browser. Please use Chrome or Edge.';
    if (onMessage) onMessage({ type: 'error', error: errorMsg });
    throw new Error(errorMsg);
  }

  if (activePort) {
    await disconnectDevice();
  }

  messageCallback = onMessage;
  lineBuffer = '';
  isReady = false;
  isConnected = false;

  try {
    // Browser shows a port picker
    activePort = await navigator.serial.requestPort();
  } catch (err) {
    if (err.name === 'NotFoundError') {
      notify({
        type: 'status',
        status: 'Disconnected',
        reason: 'USB connection cancelled by user.',
      });
      return false;
    }
    const errorMsg = `Failed to request serial port: ${err.message || String(err)}`;
    notify({ type: 'error', error: errorMsg });
    throw new Error(errorMsg, { cause: err });
  }

  try {
    // Open the port at 115200 baud
    await activePort.open({ baudRate: 115200 });
  } catch (err) {
    activePort = null;
    let errorMsg = `Failed to open serial port: ${err.message || String(err)}`;
    if (err.name === 'InvalidStateError' || err.message?.includes('already open')) {
      errorMsg = 'Could not open serial port. Close the Arduino Serial Monitor first. Only one program can use the port at a time.';
    }
    notify({ type: 'error', error: errorMsg });
    throw new Error(errorMsg, { cause: err });
  }

  try {
    streamWriter = activePort.writable.getWriter();
  } catch (err) {
    await disconnectDevice();
    const errorMsg = `Failed to obtain serial writer: ${err.message || String(err)}`;
    notify({ type: 'error', error: errorMsg });
    throw new Error(errorMsg, { cause: err });
  }

  try {
    textDecoderStream = new TextDecoderStream();
    readableStreamClosed = activePort.readable.pipeTo(textDecoderStream.writable);
    streamReader = textDecoderStream.readable.getReader();
  } catch (err) {
    await disconnectDevice();
    const errorMsg = `Failed to obtain serial reader: ${err.message || String(err)}`;
    notify({ type: 'error', error: errorMsg });
    throw new Error(errorMsg, { cause: err });
  }

  isConnected = true;
  isReady = false;

  disconnectListener = (event) => {
    if (event.target === activePort) {
      console.warn('[Web Serial] Physical USB disconnect detected');
      disconnectDevice();
      notify({
        type: 'status',
        status: 'Disconnected',
        reason: 'ESP32 device physically disconnected from USB.',
      });
    }
  };
  navigator.serial.addEventListener('disconnect', disconnectListener);

  notify({
    type: 'status',
    status: 'Connecting',
    reason: 'Port opened at 115200 baud. Waiting for ESP32 ready handshake...',
  });

  readLoop();
  return true;
}

/**
 * Section 9: sendInstruction(hex)
 * Plain text, ending with \n
 */
export async function sendInstruction(hex) {
  if (!activePort || !streamWriter) {
    throw new Error('No serial port is currently open.');
  }
  const cleanHex = String(hex || '').trim().replace(/^0x/i, '').toUpperCase().padStart(4, '0');
  await streamWriter.write(new TextEncoder().encode(cleanHex + '\n'));
  return cleanHex;
}

/**
 * Section 9: switchMap()
 * Plain text "map\n"
 */
export async function switchMap() {
  if (!activePort || !streamWriter) {
    throw new Error('No serial port is currently open.');
  }
  await streamWriter.write(new TextEncoder().encode('map\n'));
  return true;
}

export async function disconnectDevice() {
  isReady = false;
  isConnected = false;

  if (disconnectListener && typeof navigator !== 'undefined' && 'serial' in navigator) {
    try {
      navigator.serial.removeEventListener('disconnect', disconnectListener);
    } catch (e) {
      console.debug('[Web Serial] Disconnect listener removal ignored:', e);
    }
    disconnectListener = null;
  }

  if (streamWriter) {
    try {
      await streamWriter.close();
    } catch (e) {
      console.debug('[Web Serial] Writer close ignored:', e);
    }
    try {
      streamWriter.releaseLock();
    } catch (e) {
      console.debug('[Web Serial] Writer releaseLock ignored:', e);
    }
    streamWriter = null;
  }

  if (streamReader) {
    try {
      await streamReader.cancel();
    } catch (e) {
      console.debug('[Web Serial] Reader cancel ignored:', e);
    }
    try {
      streamReader.releaseLock();
    } catch (e) {
      console.debug('[Web Serial] Reader releaseLock ignored:', e);
    }
    streamReader = null;
  }

  if (readableStreamClosed) {
    try {
      await readableStreamClosed.catch(() => {});
    } catch (e) {
      console.debug('[Web Serial] Stream settle ignored:', e);
    }
    readableStreamClosed = null;
  }

  if (activePort) {
    try {
      await activePort.close();
    } catch (err) {
      console.warn('[Web Serial] Port close warning:', err);
    }
    activePort = null;
  }

  textDecoderStream = null;
  lineBuffer = '';
}
