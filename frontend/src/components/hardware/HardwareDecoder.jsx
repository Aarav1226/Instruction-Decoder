import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import * as realSerial from '../../device/serial';
import * as mockSerial from '../../device/mockDevice';
import {
  CONNECTION_STATES,
  MEMORY_MAPS,
  decodeInstructionJS,
  formatDeviceDecode,
  compareDecoderResults,
  OFFICIAL_TEST_CASES,
  FIXED_REGISTERS,
} from './hardwareUtils';
import ComparisonCard from './ComparisonCard';
import HardwareLedPanel from './HardwareLedPanel';

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

function validateInstruction(raw) {
  if (typeof raw !== 'string' || !raw.trim()) {
    return { isValid: false, error: 'Instruction cannot be empty. Enter a 1 to 4 digit hex code (e.g. 1A73).' };
  }
  const clean = raw.trim().replace(/^0x/i, '');
  if (!clean) {
    return { isValid: false, error: 'Instruction cannot be empty.' };
  }
  if (!/^[0-9A-Fa-f]{1,4}$/.test(clean)) {
    return {
      isValid: false,
      error: `Invalid hexadecimal instruction "${raw}". Must be 1 to 4 hex characters (0-9, A-F).`,
    };
  }
  const normalized = clean.toUpperCase().padStart(4, '0');
  return { isValid: true, normalized };
}

export default function HardwareDecoder() {
  const [driverMode, setDriverMode] = useState('real'); // 'real' (Web Serial) | 'mock' (ESP32 Simulator)
  const activeDriver = driverMode === 'mock' ? mockSerial : realSerial;

  const [connectionState, setConnectionState] = useState(
    CONNECTION_STATES.DISCONNECTED
  );
  const [isWaitingReady, setIsWaitingReady] = useState(false);
  const [isAwaitingResponse, setIsAwaitingResponse] = useState(false);
  const [hexInput, setHexInput] = useState('1A73');
  const [mapMode, setMapMode] = useState(MEMORY_MAPS.DEFAULT);

  // Hardware device result (received via Web Serial JSON from ESP32 - Source of Truth)
  const [deviceResult, setDeviceResult] = useState(null);

  // Local Software JS decoder result (strictly implementing sections 3, 4, 5, 6)
  const [softwareResult, setSoftwareResult] = useState(() =>
    decodeInstructionJS('1A73', MEMORY_MAPS.DEFAULT)
  );

  const [metrics, setMetrics] = useState({
    connections: 0,
    decodes: 1,
    mapChanges: 0,
    errors: 0,
  });

  const [logs, setLogs] = useState(() => [
    createLogEntry('DECODE', 'Decoded sample 0x1A73 ➔ LOAD R5,[R1+3], EA 0x4013 (RAM)'),
    createLogEntry(
      'CONNECTION',
      realSerial.isSerialSupported()
        ? 'Hardware UI initialized (Web Serial API ready at 115200 baud).'
        : 'Web Serial not supported in this browser. Please use Chrome or Edge.'
    ),
  ]);

  const mapModeRef = useRef(mapMode);
  useEffect(() => {
    mapModeRef.current = mapMode;
  }, [mapMode]);

  const awaitingInstrRef = useRef(null);
  const responseTimeoutRef = useRef(null);
  const logConsoleRef = useRef(null);

  const appendLog = useCallback((type, message) => {
    setLogs((prev) => [createLogEntry(type, message), ...prev].slice(0, 60));
    if (type === 'ERROR') {
      setMetrics((m) => ({ ...m, errors: m.errors + 1 }));
    }
  }, []);

  /**
   * Dispatches incoming device messages according to Section 8 of DEVICE_GUIDE.md:
   * 1. {"type":"ready"}
   * 2. {"type":"decode",...} (both host-requested and physical board button decodes)
   * 3. {"type":"map",...}
   */
  const handleDeviceMessage = useCallback(
    (msg) => {
      if (!msg) return;

      if (msg.type === 'ready') {
        setConnectionState(CONNECTION_STATES.CONNECTED);
        setIsWaitingReady(false);
        setIsAwaitingResponse(false);
        if (responseTimeoutRef.current) {
          clearTimeout(responseTimeoutRef.current);
          responseTimeoutRef.current = null;
        }
        awaitingInstrRef.current = null;
        setMetrics((m) => ({ ...m, connections: m.connections + 1 }));
        appendLog('CONNECTION', 'ESP32 {"type":"ready"} handshake received. Board online & ready!');
      } else if (msg.type === 'decode') {
        // Clear safety timeout & awaiting response flag
        if (responseTimeoutRef.current) {
          clearTimeout(responseTimeoutRef.current);
          responseTimeoutRef.current = null;
        }
        const expectedInstr = awaitingInstrRef.current;
        setIsAwaitingResponse(false);
        awaitingInstrRef.current = null;

        // Use actual hardware message fields directly:
        // instr, op, rd, rs, mode, offset, memAccess, ea, region, map, error
        // Do not independently guess - hardware result is the source of truth!
        const formatted = formatDeviceDecode(msg, mapModeRef.current);
        setDeviceResult(formatted);

        // Normalize received instruction from hardware
        const hwInstr = (msg.instr || '0000').toUpperCase().padStart(4, '0');
        setHexInput(hwInstr);

        // Synchronize local software reference decoder with this instruction
        const swResult = decodeInstructionJS(hwInstr, mapModeRef.current);
        setSoftwareResult(swResult);

        setMetrics((m) => ({ ...m, decodes: m.decodes + 1 }));

        // Detect if decode was initiated by physical board buttons (NEXT, INC, DECODE)
        const isDeviceInitiated = !expectedInstr || expectedInstr !== hwInstr;

        const eaDisplay =
          msg.memAccess && msg.ea !== null && msg.ea !== undefined
            ? `0x${(typeof msg.ea === 'number' ? msg.ea : parseInt(msg.ea, 10))
                .toString(16)
                .toUpperCase()
                .padStart(4, '0')} (${msg.ea} dec)`
            : 'None';

        if (msg.error && msg.error.trim().length > 0) {
          if (isDeviceInitiated) {
            appendLog('ERROR', `[PHYSICAL BOARD] ESP32 0x${hwInstr}: ${msg.error}`);
          } else {
            appendLog('ERROR', `[SERIAL RX] ESP32 0x${hwInstr}: ${msg.error}`);
          }
        } else {
          if (isDeviceInitiated) {
            appendLog(
              'HARDWARE',
              `[PHYSICAL BOARD] ESP32 0x${hwInstr} ➔ ${msg.op} R${msg.rd}, R${msg.rs} (mode ${msg.mode}), EA ${eaDisplay} [${msg.region || 'None'}]`
            );
          } else {
            appendLog(
              'DECODE',
              `[SERIAL RX] ESP32 0x${hwInstr} ➔ ${msg.op} R${msg.rd}, R${msg.rs} (mode ${msg.mode}), EA ${eaDisplay} [${msg.region || 'None'}]`
            );
          }
        }
      } else if (msg.type === 'map') {
        const nextMap =
          msg.overlap || msg.map === 'Overlap'
            ? MEMORY_MAPS.OVERLAP
            : MEMORY_MAPS.DEFAULT;
        setMapMode(nextMap);
        setMetrics((m) => ({ ...m, mapChanges: m.mapChanges + 1 }));
        appendLog(
          'MAP',
          `ESP32 switched map to: ${nextMap} (${
            nextMap === MEMORY_MAPS.OVERLAP ? '0x7000–0x7FFF Overlap' : 'Standard Linear'
          })`
        );
      } else if (msg.type === 'status') {
        if (msg.status === 'Disconnected') {
          setConnectionState(CONNECTION_STATES.DISCONNECTED);
          setIsWaitingReady(false);
          setIsAwaitingResponse(false);
          awaitingInstrRef.current = null;
          if (responseTimeoutRef.current) {
            clearTimeout(responseTimeoutRef.current);
            responseTimeoutRef.current = null;
          }
          appendLog('CONNECTION', msg.reason || 'ESP32 disconnected.');
        } else if (msg.status === 'Connecting') {
          appendLog('CONNECTION', msg.reason || 'Connecting...');
        }
      } else if (msg.type === 'error') {
        setConnectionState(CONNECTION_STATES.ERROR);
        setIsWaitingReady(false);
        setIsAwaitingResponse(false);
        awaitingInstrRef.current = null;
        if (responseTimeoutRef.current) {
          clearTimeout(responseTimeoutRef.current);
          responseTimeoutRef.current = null;
        }
        appendLog('ERROR', msg.error || 'Serial error occurred.');
      }
    },
    [appendLog]
  );

  /**
   * Connect / Disconnect Toggle strictly using Web Serial requestPort() on click
   */
  const handleConnectToggle = async () => {
    if (connectionState === CONNECTION_STATES.CONNECTED || isWaitingReady) {
      appendLog('CONNECTION', 'Closing USB serial connection...');
      await activeDriver.disconnectDevice();
      setConnectionState(CONNECTION_STATES.DISCONNECTED);
      setIsWaitingReady(false);
      setIsAwaitingResponse(false);
      awaitingInstrRef.current = null;
      if (responseTimeoutRef.current) {
        clearTimeout(responseTimeoutRef.current);
        responseTimeoutRef.current = null;
      }
      setDeviceResult(null);
      appendLog('CONNECTION', 'USB device disconnected.');
      return;
    }

    if (driverMode === 'real' && !realSerial.isSerialSupported()) {
      setConnectionState(CONNECTION_STATES.ERROR);
      setIsWaitingReady(false);
      appendLog(
        'ERROR',
        'Web Serial API is not supported in this browser. Please use Chrome or Edge.'
      );
      return;
    }

    setConnectionState(CONNECTION_STATES.CONNECTING);
    setIsWaitingReady(true);
    appendLog(
      'CONNECTION',
      `Requesting USB Serial port (115200 baud) [Driver: ${
        driverMode === 'mock' ? 'ESP32 Simulator' : 'Web Serial API'
      }]...`
    );

    try {
      const opened = await activeDriver.connectDevice(handleDeviceMessage);
      if (opened) {
        appendLog(
          'CONNECTION',
          'Serial port opened at 115200 baud. Waiting for ESP32 {"type":"ready"} handshake...'
        );
      } else {
        setConnectionState(CONNECTION_STATES.DISCONNECTED);
        setIsWaitingReady(false);
        appendLog('CONNECTION', 'USB connection cancelled by user.');
      }
    } catch (err) {
      setConnectionState(CONNECTION_STATES.ERROR);
      setIsWaitingReady(false);
      appendLog('ERROR', `Connection failed: ${err.message || String(err)}`);
    }
  };

  /**
   * Executes decoding both locally via JS decoder and sends to hardware if connected
   */
  const executeDecode = async (code, currentMap) => {
    if (isAwaitingResponse) return;

    // 1. Validate instruction
    const { isValid, normalized, error } = validateInstruction(code);
    if (!isValid) {
      appendLog('ERROR', error);
      return;
    }

    // 2. Normalize to uppercase 4-digit hexadecimal format
    setHexInput(normalized);

    // 3. If hardware is connected & ready, transmit over Web Serial
    if (activeDriver.isDeviceReady()) {
      setIsAwaitingResponse(true);
      awaitingInstrRef.current = normalized;

      if (responseTimeoutRef.current) clearTimeout(responseTimeoutRef.current);
      responseTimeoutRef.current = setTimeout(() => {
        setIsAwaitingResponse(false);
        awaitingInstrRef.current = null;
        appendLog(
          'ERROR',
          `Hardware response timeout (5s) for instruction 0x${normalized}. Check serial connection.`
        );
      }, 5000);

      try {
        appendLog('STREAM', `Sending 0x${normalized}\\n to ESP32 over serial...`);
        // Send it to the ESP32 followed by a newline
        await activeDriver.sendInstruction(normalized);
      } catch (err) {
        setIsAwaitingResponse(false);
        awaitingInstrRef.current = null;
        if (responseTimeoutRef.current) clearTimeout(responseTimeoutRef.current);
        appendLog('ERROR', `Failed to transmit instruction to ESP32: ${err.message || String(err)}`);
      }
    } else {
      // Offline fallback: Software decoder
      const swResult = decodeInstructionJS(normalized, currentMap);
      setSoftwareResult(swResult);
      setMetrics((m) => ({ ...m, decodes: m.decodes + 1 }));

      if (swResult.error) {
        appendLog('ERROR', `Software 0x${normalized}: ${swResult.error}`);
      } else {
        appendLog(
          'DECODE',
          `Software Decoded 0x${normalized} ➔ ${swResult.op}, EA ${swResult.effectiveAddressHex} (${swResult.region || 'None'})`
        );
      }
    }
  };

  const handleDecodeClick = () => {
    executeDecode(hexInput, mapMode);
  };

  /**
   * Interactive Bit Toggle (15 down to 0)
   */
  const handleBitToggle = (bitIndex) => {
    if (isAwaitingResponse) return;
    const currentVal =
      parseInt(hexInput.replace(/[^0-9a-fA-F]/g, '') || '0', 16) & 0xffff;
    const nextVal = (currentVal ^ (1 << bitIndex)) & 0xffff;
    const nextHex = nextVal.toString(16).toUpperCase().padStart(4, '0');
    executeDecode(nextHex, mapMode);
  };

  /**
   * Memory Map Toggle: calls switchMap() if connected, or switches locally
   */
  const handleMapToggle = async (targetMap) => {
    if (targetMap === mapMode) return;

    if (activeDriver.isDeviceReady()) {
      try {
        appendLog('MAP', 'Sending "map\\n" command to ESP32...');
        await activeDriver.switchMap();
      } catch (err) {
        appendLog('ERROR', `Failed to switch map on device: ${err.message}`);
      }
    } else {
      setMapMode(targetMap);
      setMetrics((m) => ({ ...m, mapChanges: m.mapChanges + 1 }));
      executeDecode(hexInput, targetMap);
      appendLog(
        'MAP',
        `Memory map shifted to ${
          targetMap === MEMORY_MAPS.DEFAULT ? 'Default Map' : 'Overlap Map (0x7000–0x7FFF)'
        }`
      );
    }
  };

  /**
   * Simulates pressing physical pushbuttons on the ESP32 board
   */
  const handleSimulatePhysicalButton = (btnType) => {
    if (!activeDriver.isDeviceReady()) {
      appendLog('WARNING', 'ESP32 simulator must be connected to simulate physical buttons.');
      return;
    }
    try {
      appendLog('HARDWARE', `[PHYSICAL BOARD] Pressed ESP32 onboard '${btnType}' tactile pushbutton.`);
      mockSerial.simulatePhysicalButton(btnType);
    } catch (err) {
      appendLog('ERROR', `Physical button simulation failed: ${err.message}`);
    }
  };

  const handleClearLog = () => {
    setLogs([]);
    appendLog('SYSTEM', 'Log buffer cleared by operator.');
  };

  const handleExportLog = () => {
    const textData = logs.map((l) => `[${l.time}] ${l.type}: ${l.message}`).join('\n');
    const blob = new Blob([textData], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `esp32-decoder-log-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    appendLog('STREAM', 'Export triggered. Telemetry frame dispatched.');
  };

  useEffect(() => {
    return () => {
      if (responseTimeoutRef.current) {
        clearTimeout(responseTimeoutRef.current);
      }
      activeDriver.disconnectDevice().catch(() => {});
    };
  }, [activeDriver]);

  // Primary active result to display: deviceResult if hardware connected, otherwise softwareResult
  const isHwConnected = connectionState === CONNECTION_STATES.CONNECTED && !isWaitingReady;
  const activeResult = isHwConnected && deviceResult ? deviceResult : softwareResult;

  // 11-point architectural comparison between Software and Hardware decoders
  const comparison = useMemo(() => {
    return compareDecoderResults(softwareResult, deviceResult, isHwConnected);
  }, [softwareResult, deviceResult, isHwConnected]);

  const resultsMatch = comparison?.isMatch;

  // 16-bit fields
  const intVal =
    parseInt(hexInput.replace(/[^0-9a-fA-F]/g, '') || '0', 16) & 0xffff;
  const opVal = (intVal >> 12) & 0xf;
  const destVal = (intVal >> 9) & 0x7;
  const srcVal = (intVal >> 6) & 0x7;
  const modeVal = (intVal >> 4) & 0x3;
  const offsetVal = intVal & 0xf;

  // Active LEDs
  const activeLeds = activeResult.leds || {
    blue: false,
    green: false,
    yellow: false,
    white: false,
    red: false,
  };

  // Proportional pointer calculation (0 - 65535)
  const pointerPercent =
    activeResult.memAccess && activeResult.ea !== null && activeResult.ea <= 0xffff
      ? Math.min(Math.max((activeResult.ea / 65535) * 100, 0.5), 99.5)
      : null;

  const isConnecting = connectionState === CONNECTION_STATES.CONNECTING;
  const isError = connectionState === CONNECTION_STATES.ERROR;

  return (
    <div className="w-full flex-1 flex flex-col font-body text-brand-dark">
      {/* TOP HEADER (Glassmorphic) */}
      <header className="fixed top-0 w-full z-50 px-4 md:px-8 pt-3">
        <div className="max-w-[1680px] mx-auto h-20 rounded-2xl glass-panel px-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <span
                  className={`w-2.5 h-2.5 rounded-full ${
                    isHwConnected
                      ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,1)]'
                      : isConnecting || isWaitingReady
                        ? 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,1)]'
                        : isError
                          ? 'bg-rose-500 shadow-[0_0_8px_rgba(239,68,68,1)]'
                          : 'bg-brand-slate shadow-[0_0_8px_rgba(183,196,207,1)]'
                  } animate-pulse`}
                />
                <span className="font-sans text-base md:text-lg font-bold tracking-tight text-brand-dark uppercase">
                  COA HARDWARE LAB <span className="text-brand-slate">//</span> ESP32 INSTRUCTION DECODER
                </span>
              </div>
            </div>
            <nav className="hidden xl:flex items-center gap-1.5 p-1.5 bg-brand-sand/30 rounded-xl border border-white/60">
              <button
                type="button"
                onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                className="px-3 py-1 font-mono text-xs uppercase tracking-wider font-bold rounded-lg shadow-sm bg-white/90 text-brand-dark border border-white cursor-pointer transition-all"
              >
                Live Decoder
              </button>
              <button
                type="button"
                onClick={() => document.getElementById('comparison-section')?.scrollIntoView({ behavior: 'smooth' })}
                className="px-3 py-1 font-mono text-xs uppercase tracking-wider text-brand-deep hover:text-brand-dark hover:bg-white/50 transition-all rounded-lg cursor-pointer"
              >
                HW vs SW Comparison
              </button>
              <button
                type="button"
                onClick={() => document.getElementById('memory-map-section')?.scrollIntoView({ behavior: 'smooth' })}
                className="px-3 py-1 font-mono text-xs uppercase tracking-wider text-brand-deep hover:text-brand-dark hover:bg-white/50 transition-all rounded-lg cursor-pointer"
              >
                Memory Map
              </button>
              <button
                type="button"
                onClick={() => document.getElementById('activity-log-section')?.scrollIntoView({ behavior: 'smooth' })}
                className="px-3 py-1 font-mono text-xs uppercase tracking-wider text-brand-deep hover:text-brand-dark hover:bg-white/50 transition-all rounded-lg cursor-pointer"
              >
                Activity Log
              </button>
            </nav>
          </div>

          <div className="flex items-center gap-3">
            {/* Live Board Stats */}
            <div className="hidden md:flex items-center gap-2 bg-white/60 border border-brand-sand/40 px-3 py-1.5 rounded-xl shadow-sm">
              <div className="flex items-center gap-1.5 px-2 py-1 bg-brand-cream/60 rounded-lg">
                <span className="font-mono text-[10px] font-bold text-brand-taupe uppercase">BUS</span>
                <span className="font-mono text-xs text-brand-dark font-bold">
                  {isHwConnected ? 'ACTIVE' : 'STANDBY'}
                </span>
              </div>
              <div className="flex items-center gap-1.5 px-2 py-1 bg-brand-cream/60 rounded-lg">
                <span className="font-mono text-[10px] font-bold text-brand-taupe uppercase">CLK</span>
                <span className="font-mono text-xs text-brand-dark font-bold">16MHz</span>
              </div>
              <div className="flex items-center gap-1.5 px-2 py-1 bg-brand-cream/60 rounded-lg">
                <span className="font-mono text-[10px] font-bold text-brand-taupe uppercase">BAUD</span>
                <span className="font-mono text-xs text-brand-deep font-bold">115200</span>
              </div>
              {/* Comparison match status indicator */}
              {isHwConnected && resultsMatch !== null && (
                <div className={`flex items-center gap-1 px-2 py-1 rounded-lg ${resultsMatch ? 'bg-emerald-100/80' : 'bg-rose-100/80'}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${resultsMatch ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                  <span className={`font-mono text-[10px] font-bold uppercase ${resultsMatch ? 'text-emerald-700' : 'text-rose-700'}`}>
                    {resultsMatch ? 'MATCH' : 'DIFF'}
                  </span>
                </div>
              )}
            </div>

            {/* Driver Selector: Web Serial vs Simulator */}
            <div className="hidden sm:flex items-center gap-1 bg-white/70 p-1 rounded-xl border border-brand-sand/40 shadow-sm">
              <button
                type="button"
                disabled={isHwConnected || isConnecting || isWaitingReady}
                onClick={() => setDriverMode('real')}
                className={`px-2.5 py-1 font-mono text-[10px] font-bold rounded-lg transition-all ${
                  driverMode === 'real'
                    ? 'bg-brand-dark text-white shadow-sm'
                    : 'text-brand-taupe hover:text-brand-dark'
                } ${isHwConnected || isConnecting || isWaitingReady ? 'opacity-50 cursor-not-allowed' : ''}`}
                title="Connect to physical ESP32 via Chrome/Edge Web Serial API at 115200 baud"
              >
                USB Web Serial
              </button>
              <button
                type="button"
                disabled={isHwConnected || isConnecting || isWaitingReady}
                onClick={() => setDriverMode('mock')}
                className={`px-2.5 py-1 font-mono text-[10px] font-bold rounded-lg transition-all ${
                  driverMode === 'mock'
                    ? 'bg-brand-dark text-white shadow-sm'
                    : 'text-brand-taupe hover:text-brand-dark'
                } ${isHwConnected || isConnecting || isWaitingReady ? 'opacity-50 cursor-not-allowed' : ''}`}
                title="Simulate ESP32 device with physical button testing (NEXT / INC / DECODE)"
              >
                ESP32 Simulator
              </button>
            </div>

            {/* Section 12: Connect Device button & Hardware connected badge */}
            <div className="flex items-center gap-3 glass-card-inner px-3 py-1.5 rounded-xl shadow-sm">
              <div className="flex flex-col text-right">
                <div className="flex items-center justify-end gap-1.5">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      isHwConnected
                        ? 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,1)]'
                        : isWaitingReady
                          ? 'bg-amber-500 animate-pulse'
                          : isError
                            ? 'bg-rose-500'
                            : 'bg-rose-500 animate-ping'
                    }`}
                  />
                  <span
                    className={`font-mono text-[10px] font-bold uppercase ${
                      isHwConnected
                        ? 'text-emerald-700'
                        : isWaitingReady
                          ? 'text-amber-700'
                          : isError
                            ? 'text-rose-700'
                            : 'text-rose-600'
                    }`}
                  >
                    {isWaitingReady ? 'WAITING READY' : connectionState}
                  </span>
                </div>
                <span className="font-mono text-[11px] text-brand-taupe">
                  {driverMode === 'mock' ? 'SIMULATED ESP32' : 'ESP32-WROOM · 115200'}
                </span>
              </div>
              <button
                className={`flex items-center gap-1.5 ${
                  isHwConnected
                    ? 'bg-emerald-700 hover:bg-emerald-800'
                    : isError
                      ? 'bg-rose-600 hover:bg-rose-700'
                      : isWaitingReady
                        ? 'bg-amber-600 hover:bg-amber-700'
                        : 'bg-brand-taupe hover:bg-brand-deep'
                } text-white transition-all px-3 py-1.5 rounded-lg font-mono text-xs font-bold uppercase tracking-wider shadow-sm`}
                type="button"
                onClick={handleConnectToggle}
              >
                <span className="material-symbols-outlined text-[16px]">usb</span>
                {isWaitingReady
                  ? 'Cancel'
                  : isConnecting
                    ? 'Connecting...'
                    : isHwConnected
                      ? 'Disconnect'
                      : isError
                        ? 'Retry USB'
                        : driverMode === 'mock'
                          ? 'Start Mock'
                          : 'Connect USB'}
                <span className="font-mono text-[9px] px-1 py-0.5 bg-white/20 text-white rounded">
                  {driverMode === 'mock' ? 'MOCK' : 'WEB-SERIAL'}
                </span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* MAIN VIEWPORT */}
      <main className="w-full pt-28 pb-12 flex-1 flex flex-col">
        <div className="w-full max-w-[1680px] mx-auto px-4 md:px-8 flex flex-col gap-5 text-brand-dark">
          {/* 1. TOP HARDWARE TELEMETRY & PHYSICAL LED INDICATORS PANEL (Section 2, 6 & 11) */}
          <HardwareLedPanel
            activeLeds={activeLeds}
            activeResult={activeResult}
            isHwConnected={isHwConnected}
            onConditionClick={(code, targetMap) => {
              if (targetMap !== mapMode) {
                handleMapToggle(targetMap);
              }
              executeDecode(code, targetMap);
            }}
          />

          {/* 2 & 3. MAIN WORKBENCH GRID */}
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
            {/* LEFT: 16-BIT MACHINE WORD & LOGIC ANALYZER (8 COLS) */}
            <section className="xl:col-span-8 flex flex-col gap-4 glass-panel p-5 md:p-6 rounded-2xl relative">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-brand-sand/30">
                <div className="flex items-center gap-3">
                  <span className="w-2 h-7 bg-brand-slate rounded-full shadow-sm" />
                  <div>
                    <span className="font-mono text-[10px] text-brand-taupe font-bold uppercase tracking-wider">
                      STAGE 01 // INSTRUCTION BUS TAP (SECTION 3)
                    </span>
                    <h2 className="font-sans text-xl md:text-2xl text-brand-dark font-bold uppercase tracking-tight">
                      16-Bit Machine Word &amp; Logic Analyzer
                    </h2>
                  </div>
                </div>
                <div className="flex items-center gap-2 self-start sm:self-auto glass-card-inner px-3 py-1.5 rounded-xl">
                  <span className="font-mono text-[10px] text-brand-taupe uppercase font-semibold">
                    ACTIVE MAP:
                  </span>
                  <span className="font-mono text-xs text-brand-dark font-bold">
                    {mapMode} ({mapMode === MEMORY_MAPS.OVERLAP ? 'Overlap Active' : 'Default Linear'})
                  </span>
                </div>
              </div>

              {/* Machine Word Input & Quick Injectors */}
              <div className="glass-card-inner p-4 rounded-xl flex flex-col md:flex-row items-center justify-between gap-4">
                <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
                  <label
                    className="font-mono text-xs font-bold text-brand-deep uppercase tracking-wider whitespace-nowrap"
                    htmlFor="hexInput"
                  >
                    MACHINE WORD:
                  </label>
                  <div className="relative flex-1 md:w-52">
                    <span className="absolute left-3.5 top-2.5 font-mono text-sm text-brand-taupe font-bold">
                      0x
                    </span>
                    <input
                      id="hexInput"
                      className="glass-input w-full text-brand-dark font-mono text-base pl-9 pr-3 py-2 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-slate uppercase font-extrabold tracking-wider shadow-inner"
                      maxLength={4}
                      type="text"
                      value={hexInput}
                      onChange={(e) =>
                        setHexInput(e.target.value.replace(/[^0-9a-fA-F]/g, '').toUpperCase())
                      }
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleDecodeClick();
                      }}
                    />
                  </div>
                  <button
                    id="decodeBtn"
                    disabled={isAwaitingResponse}
                    className={`flex items-center gap-2 ${
                      isAwaitingResponse
                        ? 'bg-amber-600 text-white cursor-wait opacity-85'
                        : 'bg-brand-dark text-brand-cream hover:bg-brand-deep hover:text-white'
                    } px-5 py-2.5 rounded-xl font-mono text-xs font-bold uppercase tracking-wider transition-all shadow-md active:translate-y-0.5`}
                    type="button"
                    onClick={handleDecodeClick}
                  >
                    <span
                      className={`material-symbols-outlined text-[16px] ${
                        isAwaitingResponse ? 'animate-spin' : ''
                      }`}
                    >
                      {isAwaitingResponse ? 'sync' : 'play_circle'}
                    </span>
                    {isAwaitingResponse
                      ? 'Awaiting ESP32...'
                      : isHwConnected
                        ? 'Decode (ESP32)'
                        : 'Decode'}
                  </button>
                </div>

                {/* Section 11 Official Test Presets */}
                <div className="flex flex-wrap items-center gap-1.5 w-full md:w-auto justify-end">
                  <span className="font-mono text-[10px] text-brand-taupe uppercase font-bold mr-1">
                    TEST CASES (SEC 11):
                  </span>
                  {OFFICIAL_TEST_CASES.slice(0, 4).map((preset) => (
                    <button
                      key={preset.code}
                      className="px-2.5 py-1.5 rounded-lg bg-white/70 hover:bg-brand-slate/40 text-brand-deep font-mono text-xs font-semibold border border-brand-sand/40 transition-colors shadow-sm"
                      type="button"
                      onClick={() => {
                        if (preset.map !== mapMode) {
                          handleMapToggle(preset.map);
                        }
                        executeDecode(preset.code, preset.map);
                      }}
                      title={preset.label}
                    >
                      {preset.code}
                    </button>
                  ))}
                  {/* More test case dropdown or additional presets */}
                  {OFFICIAL_TEST_CASES.slice(4).map((preset) => (
                    <button
                      key={preset.code}
                      className="px-2 py-1.5 rounded-lg bg-white/70 hover:bg-brand-slate/40 text-brand-deep font-mono text-xs font-semibold border border-brand-sand/40 transition-colors shadow-sm"
                      type="button"
                      onClick={() => {
                        if (preset.map !== mapMode) {
                          handleMapToggle(preset.map);
                        }
                        executeDecode(preset.code, preset.map);
                      }}
                      title={preset.label}
                    >
                      {preset.code}
                    </button>
                  ))}
                </div>
              </div>

              {/* Section 1 & 10: ESP32 Physical Board Buttons Simulation */}
              {isHwConnected && driverMode === 'mock' && (
                <div className="glass-card-inner p-3 rounded-xl flex flex-wrap items-center justify-between gap-3 bg-amber-500/10 border border-amber-500/30 shadow-sm">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-amber-700 text-[18px]">touch_app</span>
                    <span className="font-mono text-xs font-bold text-amber-950 uppercase tracking-wide">
                      ESP32 TACTILE BUTTONS SIMULATION:
                    </span>
                    <span className="font-mono text-[11px] text-amber-800 hidden md:inline">
                      Simulate pressing hardware buttons (NEXT, INC, DECODE pushbuttons on the board)
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={isAwaitingResponse}
                      onClick={() => handleSimulatePhysicalButton('NEXT')}
                      className="px-3 py-1.5 rounded-lg bg-white hover:bg-amber-100 text-brand-dark font-mono text-xs font-bold border border-amber-300 shadow-sm active:translate-y-0.5 transition-colors disabled:opacity-50"
                      title="Simulate pressing NEXT button on ESP32 to cycle official test cases"
                    >
                      NEXT (Cycle Test)
                    </button>
                    <button
                      type="button"
                      disabled={isAwaitingResponse}
                      onClick={() => handleSimulatePhysicalButton('INC')}
                      className="px-3 py-1.5 rounded-lg bg-white hover:bg-amber-100 text-brand-dark font-mono text-xs font-bold border border-amber-300 shadow-sm active:translate-y-0.5 transition-colors disabled:opacity-50"
                      title="Simulate pressing INC button on ESP32 to increment instruction"
                    >
                      INC (+1 Instr)
                    </button>
                    <button
                      type="button"
                      disabled={isAwaitingResponse}
                      onClick={() => handleSimulatePhysicalButton('DECODE')}
                      className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-mono text-xs font-bold shadow-sm active:translate-y-0.5 transition-colors disabled:opacity-50"
                      title="Simulate pressing DECODE button on ESP32 to re-decode"
                    >
                      DECODE (Board Push)
                    </button>
                  </div>
                </div>
              )}

              {/* 16-Bit Architecture Sub-Field Partition Badges (Section 3) */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
                {/* Opcode [15:12] */}
                <div className="glass-card-inner p-3 rounded-xl shadow-sm flex flex-col justify-between">
                  <div className="flex items-center justify-between pb-1 border-b border-brand-sand/20">
                    <span className="font-mono text-[10px] font-bold text-brand-taupe">
                      OPCODE [15:12]
                    </span>
                    <span className="font-mono text-[10px] text-brand-deep font-bold bg-white/60 px-1 rounded">
                      4 BITS
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between mt-2">
                    <span className="font-mono text-sm md:text-base text-brand-dark font-extrabold">
                      {opVal.toString(2).padStart(4, '0')}
                    </span>
                    <span
                      className={`font-mono text-[11px] font-bold ${
                        opVal >= 1 && opVal <= 4 ? 'text-brand-deep' : 'text-rose-700'
                      }`}
                    >
                      0x{opVal.toString(16).toUpperCase()} ({activeResult.op})
                    </span>
                  </div>
                </div>

                {/* Dest Reg [11:9] */}
                <div className="glass-card-inner p-3 rounded-xl shadow-sm flex flex-col justify-between">
                  <div className="flex items-center justify-between pb-1 border-b border-brand-sand/20">
                    <span className="font-mono text-[10px] font-bold text-brand-taupe">
                      DEST REG [11:9]
                    </span>
                    <span className="font-mono text-[10px] text-brand-deep font-bold bg-white/60 px-1 rounded">
                      3 BITS
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between mt-2">
                    <span className="font-mono text-sm md:text-base text-brand-dark font-extrabold">
                      {destVal.toString(2).padStart(3, '0')}
                    </span>
                    <span className="font-mono text-[11px] text-brand-taupe font-bold">
                      R{destVal} ({destVal.toString(2).padStart(3, '0')}b)
                    </span>
                  </div>
                </div>

                {/* Src Reg [8:6] & Value from Section 4 */}
                <div className="glass-card-inner p-3 rounded-xl shadow-sm flex flex-col justify-between">
                  <div className="flex items-center justify-between pb-1 border-b border-brand-sand/20">
                    <span className="font-mono text-[10px] font-bold text-brand-taupe">
                      SRC REG [8:6]
                    </span>
                    <span className="font-mono text-[10px] text-brand-deep font-bold bg-white/60 px-1 rounded">
                      3 BITS
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between mt-2">
                    <span className="font-mono text-sm md:text-base text-brand-dark font-extrabold">
                      {srcVal.toString(2).padStart(3, '0')}
                    </span>
                    <span className="font-mono text-[11px] text-brand-taupe font-bold" title={FIXED_REGISTERS[srcVal]?.desc}>
                      R{srcVal} (0x{FIXED_REGISTERS[srcVal]?.value.toString(16).toUpperCase()})
                    </span>
                  </div>
                </div>

                {/* Addr Mode [5:4] */}
                <div className="glass-card-inner p-3 rounded-xl shadow-sm flex flex-col justify-between">
                  <div className="flex items-center justify-between pb-1 border-b border-brand-sand/20">
                    <span className="font-mono text-[10px] font-bold text-brand-taupe">
                      MODE [5:4]
                    </span>
                    <span className="font-mono text-[10px] text-brand-deep font-bold bg-white/60 px-1 rounded">
                      2 BITS
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between mt-2">
                    <span className="font-mono text-sm md:text-base text-brand-dark font-extrabold">
                      {modeVal.toString(2).padStart(2, '0')}
                    </span>
                    <span className="font-mono text-[11px] text-brand-deep font-bold">
                      {activeResult.modeStr} ({modeVal})
                    </span>
                  </div>
                </div>

                {/* Offset [3:0] */}
                <div className="glass-card-inner p-3 rounded-xl shadow-sm flex flex-col justify-between col-span-2 sm:col-span-1">
                  <div className="flex items-center justify-between pb-1 border-b border-brand-sand/20">
                    <span className="font-mono text-[10px] font-bold text-brand-taupe">
                      OFFSET [3:0]
                    </span>
                    <span className="font-mono text-[10px] text-brand-deep font-bold bg-white/60 px-1 rounded">
                      4 BITS
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between mt-2">
                    <span className="font-mono text-sm md:text-base text-brand-dark font-extrabold">
                      {offsetVal.toString(2).padStart(4, '0')}
                    </span>
                    <span className="font-mono text-[11px] text-brand-deep font-bold">
                      0x{offsetVal.toString(16).toUpperCase()} ({offsetVal}d)
                    </span>
                  </div>
                </div>
              </div>

              {/* TACTILE 16-BIT REGISTER PINOUT & INTERACTIVE TOGGLE MATRIX (15 down to 0) */}
              <div className="glass-card-inner p-4 rounded-2xl flex flex-col gap-2.5">
                <div className="flex items-center justify-between pb-1 text-brand-taupe">
                  <span className="font-mono text-[11px] font-bold uppercase tracking-wider flex items-center gap-1.5 text-brand-dark">
                    <span className="material-symbols-outlined text-[16px] text-brand-taupe">
                      memory
                    </span>
                    PHYSICAL BIT REGISTERS [MSB 15 ➔ LSB 0] (CLICK TO TOGGLE BIT)
                  </span>
                  <span className="font-mono text-[10px] text-brand-deep bg-white/70 px-2 py-0.5 rounded-lg border border-brand-sand/30 font-semibold">
                    LATCH: AUTO-SYNC
                  </span>
                </div>

                {/* 16 Bit Cells Layout */}
                <div className="grid grid-cols-8 md:grid-cols-16 gap-1.5 md:gap-2 py-1">
                  {Array.from({ length: 16 }).map((_, idx) => {
                    const bit = 15 - idx;
                    const bitVal = (intVal >> bit) & 1;
                    return (
                      <button
                        key={bit}
                        className={`flex flex-col items-center justify-between p-1.5 rounded-xl border transition-all text-center shadow-sm ${
                          bitVal === 1
                            ? 'bg-white/90 hover:bg-white border-brand-slate'
                            : 'bg-white/70 hover:bg-white border-brand-sand/40'
                        }`}
                        type="button"
                        onClick={() => handleBitToggle(bit)}
                        title={`Click to flip Bit ${bit}`}
                      >
                        <span className="font-mono text-[10px] text-brand-taupe font-bold">
                          {bit}
                        </span>
                        <span
                          className={`font-mono text-sm md:text-base font-extrabold my-0.5 ${
                            bitVal === 1 ? 'text-brand-dark' : 'text-brand-taupe'
                          }`}
                        >
                          {bitVal}
                        </span>
                        <span
                          className={`w-2 h-2 rounded-full ${
                            bitVal === 1
                              ? 'bg-brand-slate shadow-[0_0_6px_rgba(183,196,207,1)]'
                              : 'bg-brand-sand/60'
                          }`}
                        />
                      </button>
                    );
                  })}
                </div>

                {/* Bit field grouping legend underneath */}
                <div className="flex items-center justify-between text-brand-taupe font-mono text-[10px] font-bold pt-1.5 border-t border-brand-sand/30">
                  <span className="text-brand-dark">[15:12] OP</span>
                  <span className="text-brand-deep">[11:9] DEST</span>
                  <span className="text-brand-deep">[8:6] SRC</span>
                  <span className="text-brand-dark">[5:4] MODE</span>
                  <span className="text-brand-taupe">[3:0] OFFSET</span>
                </div>
              </div>

              {/* Inline Bus Logic Schematic Vector Tracer */}
              <div className="glass-card-inner p-3.5 rounded-xl flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] text-brand-taupe font-bold uppercase tracking-wider">
                    HARDWARE LOGIC PROPAGATION TRACE
                  </span>
                  <span className="font-mono text-xs text-brand-dark font-extrabold">
                    EXEC CLK: T1/T4
                  </span>
                </div>
                <svg
                  className="w-full h-11 text-brand-sand"
                  fill="none"
                  viewBox="0 0 700 48"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <line
                    stroke="#D7C0AE"
                    strokeOpacity="0.5"
                    strokeWidth="2"
                    x1="20"
                    x2="680"
                    y1="24"
                    y2="24"
                  />
                  <line
                    stroke="#D7C0AE"
                    strokeOpacity="0.6"
                    strokeWidth="2"
                    x1="160"
                    x2="160"
                    y1="12"
                    y2="36"
                  />
                  <line
                    stroke="#D7C0AE"
                    strokeOpacity="0.6"
                    strokeWidth="2"
                    x1="340"
                    x2="340"
                    y1="12"
                    y2="36"
                  />
                  <line
                    stroke="#D7C0AE"
                    strokeOpacity="0.6"
                    strokeWidth="2"
                    x1="520"
                    x2="520"
                    y1="12"
                    y2="36"
                  />
                  {/* Active Data Route */}
                  <path
                    d="M 20 24 H 160 L 200 12 H 340 L 380 24 H 520 L 560 36 H 680"
                    stroke="#967E76"
                    strokeLinecap="round"
                    strokeWidth="2.5"
                  />
                  <circle
                    className="fill-white"
                    cx="160"
                    cy="24"
                    r="4.5"
                    stroke="#967E76"
                    strokeWidth="2"
                  />
                  <circle
                    className="fill-white"
                    cx="340"
                    cy="12"
                    r="4.5"
                    stroke="#967E76"
                    strokeWidth="2"
                  />
                  <circle
                    className="fill-white"
                    cx="520"
                    cy="24"
                    r="4.5"
                    stroke="#967E76"
                    strokeWidth="2"
                  />
                  <circle className="fill-brand-taupe shadow-md" cx="680" cy="36" r="5" />
                  <text className="font-mono text-[9px] font-bold" fill="#3E2B25" x="70" y="16">
                    FETCH_WORD
                  </text>
                  <text className="font-mono text-[9px] font-bold" fill="#3E2B25" x="240" y="8">
                    IR_LATCH: 0x{hexInput}
                  </text>
                  <text className="font-mono text-[9px] font-bold" fill="#3E2B25" x="420" y="20">
                    ALU_ADD ({activeResult.effectiveAddressHex})
                  </text>
                  <text className="font-mono text-[9px] font-bold" fill="#3E2B25" x="590" y="46">
                    {activeResult.op === 'STORE' ? 'MEM_WRITE' : 'MEM_READ'}
                  </text>
                </svg>
              </div>
            </section>

            {/* RIGHT: CONTROL UNIT OUTPUT & DECODED TELEMETRY CARD (4 COLS) */}
            <section className="xl:col-span-4 flex flex-col justify-between glass-panel p-5 md:p-6 rounded-2xl relative shadow-md">
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between pb-2 border-b border-brand-sand/30">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-brand-dark text-[22px]">
                      precision_manufacturing
                    </span>
                    <h3 className="font-sans text-xl text-brand-dark font-bold uppercase tracking-tight">
                      Control Unit Output
                    </h3>
                  </div>
                  <span
                    className={`px-2.5 py-1 rounded-lg font-mono text-xs font-bold uppercase border shadow-sm ${
                      activeResult.error
                        ? 'bg-rose-100/90 text-rose-800 border-rose-300'
                        : 'bg-emerald-100/80 text-emerald-800 border-emerald-300/50'
                    }`}
                  >
                    {activeResult.error ? activeResult.error : 'VALID / OK'}
                  </span>
                </div>

                <p className="font-body text-xs text-brand-deep leading-relaxed">
                  Decoded microcode telemetry lines ready for ALU execution &amp; memory addressing.
                  {isHwConnected ? ' Source: ESP32 Hardware link.' : ' Source: JavaScript core simulation.'}
                </p>

                {/* Telemetry Key-Value Matrix */}
                <div className="flex flex-col rounded-xl overflow-hidden glass-card-inner divide-y divide-brand-sand/30 shadow-inner">
                  {/* Opcode */}
                  <div className="flex items-center justify-between px-3.5 py-2 hover:bg-white/60 transition-colors">
                    <span className="font-mono text-[10px] text-brand-taupe uppercase font-bold">
                      OPCODE
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded bg-brand-slate/40 text-brand-dark font-mono text-xs font-bold border border-brand-slate/50">
                        0x{opVal.toString(16).toUpperCase()}
                      </span>
                      <span className="font-mono text-xs text-brand-dark font-extrabold">
                        {activeResult.op}
                      </span>
                    </div>
                  </div>

                  {/* Destination Register */}
                  <div className="flex items-center justify-between px-3.5 py-2 hover:bg-white/60 transition-colors bg-white/30">
                    <span className="font-mono text-[10px] text-brand-taupe uppercase font-bold">
                      DEST REGISTER
                    </span>
                    <span className="font-mono text-xs text-brand-dark font-bold">
                      {activeResult.destRegStr} (Target Accumulator)
                    </span>
                  </div>

                  {/* Source Register & Fixed Value (Section 4) */}
                  <div className="flex items-center justify-between px-3.5 py-2 hover:bg-white/60 transition-colors">
                    <span className="font-mono text-[10px] text-brand-taupe uppercase font-bold">
                      SRC REGISTER
                    </span>
                    <span className="font-mono text-xs text-brand-dark font-bold">
                      {activeResult.srcRegStr} (Base 0x{FIXED_REGISTERS[srcVal]?.value.toString(16).toUpperCase()})
                    </span>
                  </div>

                  {/* Addressing Mode */}
                  <div className="flex items-center justify-between px-3.5 py-2 hover:bg-white/60 transition-colors bg-white/30">
                    <span className="font-mono text-[10px] text-brand-taupe uppercase font-bold">
                      ADDRESSING MODE
                    </span>
                    <span className="font-mono text-xs text-brand-deep font-bold">
                      {activeResult.modeStr} ({modeVal})
                    </span>
                  </div>

                  {/* Offset */}
                  <div className="flex items-center justify-between px-3.5 py-2 hover:bg-white/60 transition-colors">
                    <span className="font-mono text-[10px] text-brand-taupe uppercase font-bold">
                      OFFSET DISPLACEMENT
                    </span>
                    <span className="font-mono text-xs text-brand-dark font-bold">
                      0x{offsetVal.toString(16).toUpperCase()} ({offsetVal} dec)
                    </span>
                  </div>

                  {/* Effective Address (Section 8: decimal ea & hex conversion) */}
                  <div className="flex items-center justify-between px-3.5 py-2 hover:bg-white/60 transition-colors bg-brand-slate/20">
                    <span className="font-mono text-[10px] text-brand-dark uppercase font-bold">
                      EFFECTIVE ADDRESS
                    </span>
                    <span className="font-mono text-xs text-brand-dark font-extrabold">
                      {activeResult.effectiveAddressHex !== 'none'
                        ? `${activeResult.effectiveAddressHex} (${activeResult.ea} dec)`
                        : 'none (Immediate)'}
                    </span>
                  </div>

                  {/* Memory Region */}
                  <div className="flex items-center justify-between px-3.5 py-2 hover:bg-white/60 transition-colors">
                    <span className="font-mono text-[10px] text-brand-taupe uppercase font-bold">
                      TARGET REGION
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded font-mono text-xs font-bold uppercase border ${
                        activeResult.error === 'OVERLAP CONFLICT'
                          ? 'bg-rose-100 text-rose-800 border-rose-300'
                          : activeResult.region
                            ? 'bg-brand-sand/40 text-brand-dark border-brand-sand/60'
                            : 'bg-slate-100 text-brand-taupe border-slate-200'
                      }`}
                    >
                      {activeResult.region || 'None'}
                    </span>
                  </div>

                  {/* Access Type */}
                  <div className="flex items-center justify-between px-3.5 py-2 hover:bg-white/60 transition-colors bg-white/30">
                    <span className="font-mono text-[10px] text-brand-taupe uppercase font-bold">
                      ACCESS TYPE
                    </span>
                    <span className="font-mono text-xs text-brand-dark font-bold">
                      {!activeResult.memAccess
                        ? 'NO MEMORY ACCESS'
                        : activeResult.op === 'STORE'
                          ? 'WRITE'
                          : 'READ'}
                    </span>
                  </div>

                  {/* Error Status (Section 6 exact strings) */}
                  <div className="flex items-center justify-between px-3.5 py-2 hover:bg-white/60 transition-colors">
                    <span className="font-mono text-[10px] text-brand-taupe uppercase font-bold">
                      ERROR STATUS
                    </span>
                    <span
                      className={`flex items-center gap-1.5 font-mono text-xs font-bold ${
                        !activeResult.error ? 'text-emerald-800' : 'text-rose-700'
                      }`}
                    >
                      <span
                        className={`w-2 h-2 rounded-full ${
                          !activeResult.error ? 'bg-emerald-500' : 'bg-rose-500 animate-ping'
                        }`}
                      />
                      {activeResult.error ? activeResult.error : 'NONE (0x00 OK)'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Microcode Footnote */}
              <div className="mt-4 p-3 glass-card-inner rounded-xl flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-brand-taupe text-[18px]">rule</span>
                  <span className="font-mono text-[10px] text-brand-deep uppercase font-bold">
                    ALU DISPATCH STATE: READY
                  </span>
                </div>
                <span className="font-mono text-[10px] text-brand-dark font-bold">
                  CYCLE ESTIMATE: 3 CLK
                </span>
              </div>
            </section>
          </div>

          {/* 3. DUAL-CORE HARDWARE VS SOFTWARE COMPARISON INTERFACE */}
          <ComparisonCard
            softwareResult={softwareResult}
            hardwareResult={deviceResult}
            isHardwareConnected={isHwConnected}
            onConnectClick={handleConnectToggle}
            onPresetClick={(code, targetMap) => {
              if (targetMap !== mapMode) {
                handleMapToggle(targetMap);
              }
              executeDecode(code, targetMap);
            }}
          />

          {/* 4. 16-BIT ARCHITECTURE ADDRESS SPACE & HARDWARE MEMORY MAP (SECTION 5) */}
          <section id="memory-map-section" className="w-full glass-panel p-5 md:p-6 rounded-2xl flex flex-col gap-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-brand-sand/30">
              <div className="flex items-center gap-3">
                <span className="w-2 h-7 bg-brand-sand rounded-full shadow-sm" />
                <div>
                  <span className="font-mono text-[10px] text-brand-taupe font-bold uppercase tracking-wider">
                    STAGE 02 // BUS INTERFACE UNIT (SECTION 5)
                  </span>
                  <h2 className="font-sans text-xl md:text-2xl text-brand-dark font-bold uppercase tracking-tight">
                    16-Bit Architecture Address Space (0x0000–0xFFFF)
                  </h2>
                </div>
              </div>

              {/* Section 12: Mode Toggles calling switchMap() */}
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center bg-white/70 p-1 rounded-xl border border-brand-sand/40 shadow-sm">
                  <button
                    className={`px-3.5 py-1.5 rounded-lg font-mono text-xs font-bold uppercase transition-all shadow-sm ${
                      mapMode === MEMORY_MAPS.DEFAULT
                        ? 'bg-brand-dark text-white'
                        : 'text-brand-deep hover:text-brand-dark'
                    }`}
                    type="button"
                    onClick={() => handleMapToggle(MEMORY_MAPS.DEFAULT)}
                  >
                    Default Map
                  </button>
                  <button
                    className={`px-3.5 py-1.5 rounded-lg font-mono text-xs font-bold uppercase transition-all ${
                      mapMode === MEMORY_MAPS.OVERLAP
                        ? 'bg-brand-dark text-white'
                        : 'text-brand-deep hover:text-brand-dark'
                    }`}
                    type="button"
                    onClick={() => handleMapToggle(MEMORY_MAPS.OVERLAP)}
                  >
                    Overlap Map
                  </button>
                </div>

                <div className="flex items-center gap-2 glass-card-inner px-3.5 py-1.5 rounded-xl shadow-sm">
                  <span className="material-symbols-outlined text-brand-taupe text-[16px]">
                    pin_drop
                  </span>
                  <span className="font-mono text-[10px] text-brand-taupe uppercase font-semibold">
                    EFFECTIVE TARGET:
                  </span>
                  <span className="font-mono text-xs text-brand-dark font-bold tracking-wider">
                    {activeResult.memAccess
                      ? `${activeResult.effectiveAddressHex} (${activeResult.ea} dec) ➔ ${activeResult.region || 'Unmapped'}`
                      : 'None (Immediate)'}
                  </span>
                </div>
              </div>
            </div>

            {/* Overlap Map Warning Banner (Section 5 & 12) */}
            {mapMode === MEMORY_MAPS.OVERLAP && (
              <div
                className={`p-3 rounded-xl border flex items-center justify-between gap-3 text-xs font-mono ${
                  activeResult.error === 'OVERLAP CONFLICT'
                    ? 'bg-rose-100/90 text-rose-900 border-rose-400 animate-pulse'
                    : 'bg-amber-100/80 text-amber-900 border-amber-300'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-[18px]">
                    {activeResult.error === 'OVERLAP CONFLICT' ? 'warning' : 'info'}
                  </span>
                  <span>
                    <strong>OVERLAP MAP ACTIVE:</strong> I/O is 0x7000–0x9FFF, intentionally overlapping RAM from 0x7000 to 0x7FFF.
                    {activeResult.error === 'OVERLAP CONFLICT' &&
                      ' ➔ CONFLICT DETECTED: Address is inside two regions at once!'}
                  </span>
                </div>
                <span className="font-bold uppercase tracking-wider">
                  {activeResult.error === 'OVERLAP CONFLICT' ? 'OVERLAP CONFLICT' : 'OVERLAP DEMO'}
                </span>
              </div>
            )}

            {/* Segmented Physical Address Space Ruler / Memory Strip */}
            <div className="flex flex-col gap-1.5 glass-card-inner p-4 rounded-xl shadow-inner">
              <div className="flex items-center justify-between font-mono text-[10px] text-brand-taupe font-bold">
                <span>0x0000 [ROM START]</span>
                <span>0x4000 [RAM START]</span>
                {mapMode === MEMORY_MAPS.OVERLAP && <span className="text-rose-700">0x7000 [I/O OVERLAP]</span>}
                <span>0x8000 [I/O START]</span>
                <span>0xA000 [UNMAPPED]</span>
                <span>0xFFFF [TOP]</span>
              </div>

              {/* Visual Segmented Memory Strip */}
              <div className="relative w-full h-9 bg-white/80 rounded-xl flex overflow-hidden border border-brand-sand/50 shadow-inner">
                {/* ROM Segment (0x0000 - 0x3FFF, 25%) */}
                <div className="w-1/4 h-full bg-brand-slate/60 border-r border-white/60 relative flex items-center justify-center group cursor-pointer">
                  <span className="font-mono text-xs text-brand-dark font-bold tracking-wider">
                    ROM (16KB)
                  </span>
                </div>

                {/* RAM Segment (0x4000 - 0x7FFF, 25%) */}
                <div className="w-1/4 h-full bg-brand-sand/40 border-r border-white/60 relative flex items-center justify-center group cursor-pointer hover:bg-brand-sand/60 transition-colors">
                  <span className="font-mono text-xs text-brand-deep font-semibold tracking-wider">
                    RAM (16KB)
                  </span>
                </div>

                {/* I/O Segment (0x8000 - 0x9FFF, 12.5% in default, or 0x7000-0x9FFF in overlap) */}
                <div className="w-[12.5%] h-full bg-brand-cream/80 border-r border-white/60 relative flex items-center justify-center group cursor-pointer hover:bg-brand-cream transition-colors">
                  <span className="font-mono text-xs text-brand-deep font-semibold tracking-wider">
                    I/O (8K)
                  </span>
                </div>

                {/* Unmapped Segment (0xA000 - 0xFFFF, 37.5%) */}
                <div className="w-[37.5%] h-full bg-slate-100/60 relative flex items-center justify-center opacity-80">
                  <span className="font-mono text-xs text-brand-taupe font-semibold tracking-wider">
                    UNMAPPED (24KB)
                  </span>
                </div>

                {/* Overlap hatched slice when in Overlap Map Mode (0x7000 to 0x7FFF) */}
                {mapMode === MEMORY_MAPS.OVERLAP && (
                  <div
                    className="absolute top-0 bottom-0 z-10 border-x border-dashed border-rose-500/80 pointer-events-none flex items-center justify-center"
                    style={{
                      left: `${(0x7000 / 65536) * 100}%`,
                      width: `${(0x1000 / 65536) * 100}%`,
                      backgroundImage:
                        'repeating-linear-gradient(-45deg, rgba(239, 68, 68, 0.15), rgba(239, 68, 68, 0.15) 6px, rgba(239, 68, 68, 0.35) 6px, rgba(239, 68, 68, 0.35) 12px)',
                    }}
                  >
                    <span className="font-mono text-[9px] font-extrabold text-rose-800 bg-white/90 px-1 py-0.5 rounded shadow-sm">
                      OVERLAP (0x7000–0x7FFF)
                    </span>
                  </div>
                )}

                {/* Active target address locator pinpoint */}
                {pointerPercent !== null && (
                  <div
                    className="absolute top-0 bottom-0 w-1.5 z-20 transition-all duration-300"
                    style={{
                      left: `${pointerPercent}%`,
                      backgroundColor: activeResult.error ? '#ef4444' : '#2C1810',
                      boxShadow: activeResult.error
                        ? '0 0 10px rgba(239,68,68,1)'
                        : '0 0 8px rgba(44,24,16,0.8)',
                    }}
                  />
                )}
              </div>

              {/* Ruler pin indicator alignment label */}
              {pointerPercent !== null && (
                <div className="relative w-full h-5 font-mono text-[10px]">
                  <div
                    className="absolute flex items-center gap-1 -translate-x-1/2 font-bold transition-all duration-300"
                    style={{
                      left: `${pointerPercent}%`,
                      color: activeResult.error ? '#ef4444' : '#2C1810',
                    }}
                  >
                    <span className="material-symbols-outlined text-[14px]">arrow_upward</span>
                    <span>
                      {activeResult.effectiveAddressHex} (
                      {activeResult.error ? activeResult.error : activeResult.region || 'Accessed'})
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Memory Region Detailed Cards Grid (Section 5) */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* ROM Block */}
              <div
                className={`glass-card-inner p-4 rounded-xl flex flex-col justify-between shadow-sm relative overflow-hidden ${
                  activeResult.memAccess && activeResult.region === 'ROM'
                    ? 'border-2 border-brand-slate bg-white/80'
                    : ''
                }`}
              >
                {activeResult.memAccess && activeResult.region === 'ROM' && (
                  <div className="absolute top-0 right-0 px-2.5 py-0.5 bg-brand-dark text-white font-mono text-[9px] font-bold uppercase rounded-bl-lg shadow-sm">
                    ACTIVE TARGET
                  </div>
                )}
                <div>
                  <div className="flex items-center gap-2 pb-1">
                    <span className="font-sans text-xl font-bold text-brand-dark">ROM</span>
                    <span className="font-mono text-xs text-brand-taupe font-bold">16 KB</span>
                  </div>
                  <div className="font-mono text-xs text-brand-deep font-extrabold mb-1">
                    0x0000 – 0x3FFF
                  </div>
                  <div className="font-body text-xs text-brand-deep leading-relaxed">
                    Program code &amp; firmware constants. Non-volatile boot memory.
                  </div>
                </div>
                <div className="mt-4 pt-2 border-t border-brand-sand/30 flex items-center justify-between">
                  <span className="font-mono text-[10px] text-brand-taupe uppercase font-bold">
                    PERM:
                  </span>
                  <span className="font-mono text-xs text-brand-dark font-bold">READ ONLY</span>
                </div>
              </div>

              {/* RAM Block */}
              <div
                className={`glass-card-inner p-4 rounded-xl flex flex-col justify-between shadow-sm relative overflow-hidden ${
                  activeResult.memAccess && activeResult.region === 'RAM'
                    ? 'border-2 border-brand-sand bg-white/80'
                    : ''
                }`}
              >
                {activeResult.memAccess && activeResult.region === 'RAM' && (
                  <div
                    className={`absolute top-0 right-0 px-2.5 py-0.5 font-mono text-[9px] font-bold uppercase rounded-bl-lg shadow-sm ${
                      activeResult.error === 'OVERLAP CONFLICT'
                        ? 'bg-rose-600 text-white'
                        : 'bg-brand-dark text-white'
                    }`}
                  >
                    {activeResult.error === 'OVERLAP CONFLICT' ? 'OVERLAP CONFLICT' : 'ACTIVE TARGET'}
                  </div>
                )}
                <div>
                  <div className="flex items-center gap-2 pb-1">
                    <span className="font-sans text-xl font-bold text-brand-dark">RAM</span>
                    <span className="font-mono text-xs text-brand-taupe font-bold">16 KB</span>
                  </div>
                  <div className="font-mono text-xs text-brand-deep font-extrabold mb-1">
                    0x4000 – 0x7FFF
                  </div>
                  <div className="font-body text-xs text-brand-deep leading-relaxed">
                    System memory, stack frames, dynamic heap, volatile buffers.
                  </div>
                </div>
                <div className="mt-4 pt-2 border-t border-brand-sand/30 flex items-center justify-between">
                  <span className="font-mono text-[10px] text-brand-taupe uppercase font-bold">
                    PERM:
                  </span>
                  <span className="font-mono text-xs text-brand-dark font-bold">READ / WRITE</span>
                </div>
              </div>

              {/* I/O Block */}
              <div
                className={`glass-card-inner p-4 rounded-xl flex flex-col justify-between shadow-sm relative overflow-hidden ${
                  activeResult.memAccess &&
                  (activeResult.region === 'I/O' || activeResult.error === 'OVERLAP CONFLICT')
                    ? 'border-2 border-amber-300 bg-white/80'
                    : ''
                }`}
              >
                {activeResult.memAccess &&
                  (activeResult.region === 'I/O' || activeResult.error === 'OVERLAP CONFLICT') && (
                    <div
                      className={`absolute top-0 right-0 px-2.5 py-0.5 font-mono text-[9px] font-bold uppercase rounded-bl-lg shadow-sm ${
                        activeResult.error === 'OVERLAP CONFLICT'
                          ? 'bg-rose-600 text-white'
                          : 'bg-brand-dark text-white'
                      }`}
                    >
                      {activeResult.error === 'OVERLAP CONFLICT' ? 'OVERLAP CONFLICT' : 'ACTIVE TARGET'}
                    </div>
                  )}
                <div>
                  <div className="flex items-center gap-2 pb-1">
                    <span className="font-sans text-xl font-bold text-brand-dark">I/O SPACE</span>
                    <span className="font-mono text-xs text-brand-taupe font-bold">
                      {mapMode === MEMORY_MAPS.OVERLAP ? '12 KB (Overlap)' : '8 KB'}
                    </span>
                  </div>
                  <div className="font-mono text-xs text-brand-deep font-extrabold mb-1">
                    {mapMode === MEMORY_MAPS.OVERLAP ? '0x7000 – 0x9FFF' : '0x8000 – 0x9FFF'}
                  </div>
                  <div className="font-body text-xs text-brand-deep leading-relaxed">
                    Memory-mapped peripherals, UART0/1, timers, interrupts, and bus arbiters.
                  </div>
                </div>
                <div className="mt-4 pt-2 border-t border-brand-sand/30 flex items-center justify-between">
                  <span className="font-mono text-[10px] text-brand-taupe uppercase font-bold">
                    PERM:
                  </span>
                  <span className="font-mono text-xs text-brand-dark font-bold">READ / WRITE</span>
                </div>
              </div>

              {/* Unmapped Block */}
              <div
                className={`glass-card-inner p-4 rounded-xl flex flex-col justify-between shadow-sm opacity-80 ${
                  activeResult.error === 'UNMAPPED ADDR' || activeResult.error === 'OUT OF RANGE'
                    ? 'border-2 border-rose-400 bg-white/80'
                    : ''
                }`}
              >
                <div>
                  <div className="flex items-center gap-2 pb-1">
                    <span className="font-sans text-xl font-bold text-brand-taupe">UNMAPPED</span>
                    <span className="font-mono text-xs text-brand-taupe font-bold">24 KB</span>
                  </div>
                  <div className="font-mono text-xs text-brand-taupe font-bold mb-1">
                    0xA000 – 0xFFFF
                  </div>
                  <div className="font-body text-xs text-brand-taupe leading-relaxed">
                    Reserved floating address space. Access triggers bus fault exception.
                  </div>
                </div>
                <div className="mt-4 pt-2 border-t border-brand-sand/30 flex items-center justify-between">
                  <span className="font-mono text-[10px] text-brand-taupe uppercase font-bold">
                    PERM:
                  </span>
                  <span className="font-mono text-xs text-rose-700 font-bold">NONE (FAULT)</span>
                </div>
              </div>
            </div>
          </section>

          {/* 5. EVENT STREAM / HARDWARE ACTIVITY LOG */}
          <section id="activity-log-section" className="w-full glass-panel p-5 rounded-2xl flex flex-col gap-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="w-2 h-6 bg-brand-taupe rounded-full shadow-sm" />
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-brand-dark text-[20px]">
                    terminal
                  </span>
                  <h3 className="font-sans text-lg md:text-xl text-brand-dark font-bold uppercase tracking-tight">
                    Event Stream / Hardware Activity Log
                  </h3>
                </div>
              </div>

              {/* Toolbar Buttons */}
              <div className="flex items-center gap-2">
                <button
                  className="px-3 py-1.5 rounded-xl bg-white/70 hover:bg-white text-brand-deep font-mono text-xs uppercase tracking-wider transition-colors flex items-center gap-1.5 border border-brand-sand/40 shadow-sm"
                  type="button"
                  onClick={handleClearLog}
                >
                  <span className="material-symbols-outlined text-[14px]">delete</span>
                  Clear Log
                </button>
                <button
                  className="px-3 py-1.5 rounded-xl bg-white/70 hover:bg-white text-brand-deep font-mono text-xs uppercase tracking-wider transition-colors flex items-center gap-1.5 border border-brand-sand/40 shadow-sm"
                  type="button"
                  onClick={handleExportLog}
                >
                  <span className="material-symbols-outlined text-[14px]">file_download</span>
                  Export Stream
                </button>
                <button
                  className="px-3 py-1.5 rounded-xl bg-white/80 text-brand-dark font-mono text-xs uppercase tracking-wider flex items-center gap-1.5 border border-brand-sand/40 shadow-sm cursor-default"
                  type="button"
                >
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  Auto-Scroll
                </button>
              </div>
            </div>

            {/* Terminal Console Output Window */}
            <div
              ref={logConsoleRef}
              className="glass-input p-4 rounded-xl font-mono text-xs text-brand-deep flex flex-col gap-1.5 h-36 overflow-y-auto shadow-inner select-text border border-brand-sand/50"
            >
              {logs.length === 0 ? (
                <div className="text-brand-taupe italic">No events recorded.</div>
              ) : (
                logs.map((entry) => (
                  <div key={entry.id} className="flex items-start gap-2.5">
                    <span className="text-brand-taupe font-semibold">[{entry.time}]</span>
                    <span
                      className={`font-bold ${
                        entry.type === 'ERROR'
                          ? 'text-rose-600'
                          : entry.type === 'MAP'
                            ? 'text-amber-700'
                            : entry.type === 'CONNECTION'
                              ? 'text-brand-slate'
                              : 'text-brand-dark'
                      }`}
                    >
                      {entry.type}:
                    </span>
                    <span className="text-brand-deep font-medium">{entry.message}</span>
                  </div>
                ))
              )}
            </div>

            {/* Bottom Telemetry Tally Metric Strip */}
            <div className="flex flex-wrap items-center justify-between text-brand-deep font-mono text-xs pt-1">
              <div className="flex flex-wrap items-center gap-4">
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-brand-slate" />
                  CONNECTIONS: <strong className="text-brand-dark">{metrics.connections}</strong>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-brand-taupe" />
                  DECODES: <strong className="text-brand-dark">{metrics.decodes}</strong>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-brand-sand" />
                  MAP CHANGES: <strong className="text-brand-dark">{metrics.mapChanges}</strong>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  ERRORS: <strong className="text-emerald-700">{metrics.errors}</strong>
                </span>
              </div>
              <div className="font-mono text-brand-taupe font-bold">
                CHASSIS LATENCY: &lt; 0.8ms
              </div>
            </div>
          </section>
        </div>
      </main>

      {/* FOOTER */}
      <footer className="w-full px-4 md:px-8 pb-4">
        <div className="max-w-[1680px] mx-auto h-12 rounded-xl glass-panel px-6 flex items-center justify-between text-brand-deep font-mono text-xs">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.8)]" />
              <span className="font-mono text-[10px] tracking-widest uppercase font-bold text-brand-dark">
                HEARTBEAT: OK (60Hz)
              </span>
            </div>
            <div className="hidden sm:flex items-center gap-2 text-brand-deep">
              <span className="px-2 py-0.5 bg-white/70 rounded-md border border-brand-sand/30 font-semibold">
                Connections: {metrics.connections}
              </span>
              <span className="px-2 py-0.5 bg-white/70 rounded-md border border-brand-sand/30 font-semibold">
                Decodes: {metrics.decodes}
              </span>
              <span className="px-2 py-0.5 bg-white/70 rounded-md border border-brand-sand/30 font-semibold">
                Map Changes: {metrics.mapChanges}
              </span>
              <span className="px-2 py-0.5 bg-white/70 rounded-md border border-brand-sand/30 font-semibold">
                Errors: {metrics.errors}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span className="font-mono text-[10px] text-brand-taupe uppercase tracking-wider hidden md:inline font-bold">
              PHYSICAL BUS LINK: ACTIVE CHASSIS M-09
            </span>
            <div className="flex items-center gap-1.5 text-brand-dark font-bold">
              <span>USB-UART Bridge</span>
              <span className="material-symbols-outlined text-[16px] text-brand-taupe">
                terminal
              </span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
