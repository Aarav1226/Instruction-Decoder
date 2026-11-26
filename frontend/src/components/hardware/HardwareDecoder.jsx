import { useState } from 'react';
import ConnectionPanel from './ConnectionPanel';
import InstructionInputPanel from './InstructionInputPanel';
import HardwareStatusPanel from './HardwareStatusPanel';
import DecodedInstructionPanel from './DecodedInstructionPanel';
import HardwareMemoryMap from './HardwareMemoryMap';
import HardwareActivityLog from './HardwareActivityLog';
import {
  CONNECTION_STATES,
  MEMORY_MAPS,
  decodeInstructionUI,
} from './hardwareUtils';
import './HardwareDecoder.css';

function createLogEntry(type, message) {
  const now = new Date();
  const time = now.toTimeString().slice(0, 8);
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    time,
    type,
    message,
  };
}

/* ── HardwareDecoder ────────────────────────────────────────────────────── */

export default function HardwareDecoder() {
  const [connectionState, setConnectionState] = useState(
    CONNECTION_STATES.DISCONNECTED
  );
  const [isWaitingReady, setIsWaitingReady] = useState(false);
  const [hexInput, setHexInput] = useState('1A5F');
  const [mapMode, setMapMode] = useState(MEMORY_MAPS.DEFAULT);
  const [decoded, setDecoded] = useState(() =>
    decodeInstructionUI('1A5F', MEMORY_MAPS.DEFAULT)
  );
  const [logs, setLogs] = useState(() => [
    createLogEntry('connection', 'Hardware UI initialized (Web Serial ready).'),
    createLogEntry('decode', 'Loaded sample instruction 0x1A5F.'),
  ]);

  const appendLog = (type, message) => {
    setLogs((prev) => [createLogEntry(type, message), ...prev].slice(0, 25));
  };

  const handleConnectToggle = () => {
    if (connectionState === CONNECTION_STATES.CONNECTED) {
      setConnectionState(CONNECTION_STATES.DISCONNECTED);
      setIsWaitingReady(false);
      appendLog('connection', 'USB device disconnected.');
      return;
    }

    setConnectionState(CONNECTION_STATES.CONNECTING);
    setIsWaitingReady(true);
    appendLog('connection', 'Requesting USB Serial port (115200 baud)...');

    // TODO: Replace setTimeout with actual Web Serial connection
    setTimeout(() => {
      setConnectionState(CONNECTION_STATES.CONNECTED);
      setIsWaitingReady(false);
      appendLog('connection', 'ESP32 Instruction Decoder ready (UI preview).');
    }, 800);
  };

  const handleDecode = () => {
    const result = decodeInstructionUI(hexInput, mapMode);
    setDecoded(result);

    if (result.errorStatus !== 'OK') {
      appendLog('error', `0x${hexInput}: ${result.errorStatus}`);
    } else {
      appendLog(
        'decode',
        `Decoded 0x${hexInput} → ${result.opcode}, EA ${result.effectiveAddress} (${result.memoryRegion})`
      );
    }
  };

  const handleMapChange = (nextMap) => {
    if (nextMap === mapMode) return;
    setMapMode(nextMap);
    const result = decodeInstructionUI(hexInput, nextMap);
    setDecoded(result);
    appendLog(
      'map',
      `Switched memory map to ${
        nextMap === MEMORY_MAPS.DEFAULT ? 'Default Map' : 'Overlap Map'
      }.`
    );
  };

  return (
    <section className="hw-dashboard" aria-label="ESP32 Hardware Instruction Decoder">
      <header className="hw-dashboard-header">
        <div>
          <span className="hw-eyebrow">COA Hardware Lab Module</span>
          <h2>ESP32 Physical Instruction Decoder</h2>
        </div>
        <p className="hw-dashboard-subtitle">
          Hardware control dashboard for 16-bit instruction decoding, LED bus
          telemetry, and memory address mapping over USB Serial.
        </p>
      </header>

      <div className="hw-grid-top">
        <ConnectionPanel
          connectionState={connectionState}
          isWaitingReady={isWaitingReady}
          onConnectToggle={handleConnectToggle}
        />
        <HardwareStatusPanel
          connectionState={connectionState}
          activeLed={decoded.activeLed}
        />
      </div>

      <div className="hw-grid-middle">
        <InstructionInputPanel
          hexInput={hexInput}
          onHexChange={setHexInput}
          onDecode={handleDecode}
          isWaitingReady={isWaitingReady}
        />
        <DecodedInstructionPanel decoded={decoded} />
      </div>

      <HardwareMemoryMap
        mapMode={mapMode}
        onMapChange={handleMapChange}
        addressValue={decoded.addressValue}
        hasOverlapConflict={decoded.hasOverlapConflict}
      />

      <HardwareActivityLog logs={logs} onClear={() => setLogs([])} />
    </section>
  );
}