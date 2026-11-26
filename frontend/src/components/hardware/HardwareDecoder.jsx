import { useState, useEffect, useCallback, useRef } from 'react';
import {
  connectDevice,
  disconnectDevice,
  sendInstruction,
  switchMap,
  isDeviceReady,
  isSerialSupported,
} from '../../device/serial';
import {
  CONNECTION_STATES,
  MEMORY_MAPS,
  decodeInstructionUI,
  formatDeviceDecode,
} from './hardwareUtils';

function createLogEntry(type, message) {
  const now = new Date();
  const time = now.toTimeString().split(' ')[0];
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    time,
    type,
    message,
  };
}

const PRESETS = [
  { label: '0x1A5F (LOAD ROM)', code: '1A5F' },
  { label: '0x2348 (STORE RAM)', code: '2348' },
  { label: '0x8205 (I/O CTL)', code: '8205' },
  { label: '0x7120 (OVERLAP CONFLICT)', code: '7120' },
];

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

  const [metrics, setMetrics] = useState({
    connections: 0,
    decodes: 1,
    mapChanges: 0,
    errors: 0,
  });

  const [logs, setLogs] = useState(() => [
    createLogEntry('DECODE', 'Decoded 0x1A5F ➔ 0x1 (LOAD), EA 0x3E00 (ROM)'),
    createLogEntry(
      'CONNECTION',
      isSerialSupported()
        ? 'Hardware UI initialized (Web Serial API ready).'
        : 'Web Serial not supported in this browser. Please use Chrome/Edge.'
    ),
    createLogEntry('DECODE', 'Loaded sample instruction 0x1A5F.'),
  ]);

  const mapModeRef = useRef(mapMode);
  useEffect(() => {
    mapModeRef.current = mapMode;
  }, [mapMode]);

  const logConsoleRef = useRef(null);

  const appendLog = useCallback((type, message) => {
    setLogs((prev) => [createLogEntry(type, message), ...prev].slice(0, 50));
    if (type === 'ERROR') {
      setMetrics((m) => ({ ...m, errors: m.errors + 1 }));
    }
  }, []);

  /**
   * Dispatches incoming device messages according to DEVICE_GUIDE.md protocol
   */
  const handleDeviceMessage = useCallback(
    (msg) => {
      if (!msg) return;

      if (msg.type === 'ready') {
        setConnectionState(CONNECTION_STATES.CONNECTED);
        setIsWaitingReady(false);
        setMetrics((m) => ({ ...m, connections: m.connections + 1 }));
        appendLog('CONNECTION', 'ESP32 Instruction Decoder ready (handshake confirmed).');
      } else if (msg.type === 'decode') {
        const formatted = formatDeviceDecode(msg, mapModeRef.current);
        setDecoded(formatted);
        if (msg.instr) {
          setHexInput(msg.instr.toUpperCase());
        }
        setMetrics((m) => ({ ...m, decodes: m.decodes + 1 }));

        if (formatted.errorStatus && formatted.errorStatus !== 'OK') {
          appendLog('ERROR', `0x${msg.instr}: ${formatted.errorStatus}`);
        } else {
          appendLog(
            'DECODE',
            `ESP32 Decoded 0x${msg.instr} ➔ ${msg.op}, EA ${formatted.effectiveAddress} (${msg.region})`
          );
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
          `ESP32 switched map to: ${
            nextMap === MEMORY_MAPS.OVERLAP ? 'Overlap Map' : 'Default Map'
          }`
        );
      } else if (msg.type === 'status') {
        if (msg.status === 'Disconnected') {
          setConnectionState(CONNECTION_STATES.DISCONNECTED);
          setIsWaitingReady(false);
          appendLog('CONNECTION', msg.reason || 'ESP32 disconnected.');
        } else if (msg.status === 'Connecting') {
          appendLog('CONNECTION', msg.reason || 'Connecting...');
        }
      } else if (msg.type === 'error') {
        setConnectionState(CONNECTION_STATES.ERROR);
        setIsWaitingReady(false);
        appendLog('ERROR', msg.error || 'Serial error occurred.');
      } else if (msg.type === 'warning') {
        appendLog('ERROR', msg.warning || 'Serial warning received.');
      }
    },
    [appendLog]
  );

  /**
   * USB Connect / Disconnect Toggle
   */
  const handleConnectToggle = async () => {
    if (connectionState === CONNECTION_STATES.CONNECTED || isWaitingReady) {
      appendLog('CONNECTION', 'Closing USB serial connection...');
      await disconnectDevice();
      setConnectionState(CONNECTION_STATES.DISCONNECTED);
      setIsWaitingReady(false);
      appendLog('CONNECTION', 'USB device disconnected.');
      return;
    }

    if (!isSerialSupported()) {
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
    appendLog('CONNECTION', 'Requesting USB Serial port (115200 baud)...');

    try {
      const opened = await connectDevice(handleDeviceMessage);
      if (opened) {
        appendLog(
          'CONNECTION',
          'Serial port opened at 115200 baud. Waiting for ESP32 ready handshake...'
        );
      } else {
        setConnectionState(CONNECTION_STATES.DISCONNECTED);
        setIsWaitingReady(false);
        appendLog('CONNECTION', 'USB connection cancelled by operator.');
      }
    } catch (err) {
      setConnectionState(CONNECTION_STATES.ERROR);
      setIsWaitingReady(false);
      appendLog('ERROR', `Connection failed: ${err.message || String(err)}`);
    }
  };

  /**
   * Execute Decode on a specific 16-bit hex string
   */
  const executeDecode = async (code, currentMap) => {
    const cleanHex = code.replace(/[^0-9a-fA-F]/g, '').toUpperCase().padStart(4, '0');
    setHexInput(cleanHex);

    if (isDeviceReady()) {
      try {
        appendLog('DECODE', `Sending 0x${cleanHex} to ESP32 over serial...`);
        await sendInstruction(cleanHex);
      } catch (err) {
        appendLog('ERROR', `Failed to send instruction: ${err.message}`);
      }
    } else {
      const result = decodeInstructionUI(cleanHex, currentMap);
      setDecoded(result);
      setMetrics((m) => ({ ...m, decodes: m.decodes + 1 }));

      if (result.errorStatus !== 'OK') {
        appendLog('ERROR', `0x${cleanHex}: ${result.errorStatus}`);
      } else {
        appendLog(
          'DECODE',
          `Decoded 0x${cleanHex} ➔ ${result.opcode}, EA ${result.effectiveAddress} (${result.memoryRegion})`
        );
      }
    }
  };

  const handleDecodeClick = () => {
    executeDecode(hexInput, mapMode);
  };

  /**
   * Bit button toggle (15 down to 0)
   */
  const handleBitToggle = (bitIndex) => {
    const currentVal =
      parseInt(hexInput.replace(/[^0-9a-fA-F]/g, '') || '0', 16) & 0xffff;
    const nextVal = (currentVal ^ (1 << bitIndex)) & 0xffff;
    const nextHex = nextVal.toString(16).toUpperCase().padStart(4, '0');
    executeDecode(nextHex, mapMode);
  };

  /**
   * Switch memory map mode
   */
  const handleMapChange = async (nextMap) => {
    if (nextMap === mapMode) return;

    if (isDeviceReady()) {
      try {
        appendLog('MAP', 'Sending MAP toggle command to ESP32...');
        await switchMap();
      } catch (err) {
        appendLog('ERROR', `Failed to switch map on device: ${err.message}`);
      }
    } else {
      setMapMode(nextMap);
      setMetrics((m) => ({ ...m, mapChanges: m.mapChanges + 1 }));
      const result = decodeInstructionUI(hexInput, nextMap);
      setDecoded(result);
      appendLog(
        'MAP',
        `Memory map shifted to ${
          nextMap === MEMORY_MAPS.DEFAULT
            ? 'DEFAULT partition scheme'
            : 'OVERLAP mode (RAM/IO conflict zone active)'
        }`
      );
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

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnectDevice().catch(() => {});
    };
  }, []);

  // Compute 16-bit fields from hexInput
  const intVal =
    parseInt(hexInput.replace(/[^0-9a-fA-F]/g, '') || '0', 16) & 0xffff;
  const opVal = (intVal >> 12) & 0xf;
  const destVal = (intVal >> 9) & 0x7;
  const srcVal = (intVal >> 6) & 0x7;
  const modeVal = (intVal >> 4) & 0x3;
  const offsetVal = intVal & 0xf;

  const opNames = [
    'NOP', 'LOAD', 'STORE', 'ADD', 'SUB', 'MOV', 'JMP', 'JZ',
    'AND', 'OR', 'XOR', 'NOT', 'CMP', 'SHL', 'SHR', 'HALT'
  ];
  const modeNames = ['Immediate (00)', 'Direct (01)', 'Indirect (10)', 'Indexed (11)'];

  // Proportional pointer calculation (0 - 65535)
  const pointerPercent =
    decoded.addressValue !== null && !Number.isNaN(decoded.addressValue)
      ? Math.min(Math.max((decoded.addressValue / 65535) * 100, 1), 99)
      : null;

  const isConnected = connectionState === CONNECTION_STATES.CONNECTED;
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
                    isConnected
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
              <span className="px-3.5 py-1.5 font-mono text-xs uppercase tracking-wider font-bold rounded-lg shadow-sm bg-white/90 text-brand-dark border border-white cursor-default">
                Live Decoder
              </span>
              <span className="px-3.5 py-1.5 font-mono text-xs uppercase tracking-wider text-brand-deep hover:text-brand-dark hover:bg-white/50 transition-all rounded-lg cursor-pointer">
                Register Heap
              </span>
              <span className="px-3.5 py-1.5 font-mono text-xs uppercase tracking-wider text-brand-deep hover:text-brand-dark hover:bg-white/50 transition-all rounded-lg cursor-pointer">
                Logic Trace
              </span>
              <span className="px-3.5 py-1.5 font-mono text-xs uppercase tracking-wider text-brand-deep hover:text-brand-dark hover:bg-white/50 transition-all rounded-lg cursor-pointer">
                ROM Map
              </span>
            </nav>
          </div>

          <div className="flex items-center gap-3">
            {/* Live Board Stats */}
            <div className="hidden md:flex items-center gap-2 bg-white/60 border border-brand-sand/40 px-3 py-1.5 rounded-xl shadow-sm">
              <div className="flex items-center gap-1.5 px-2 py-1 bg-brand-cream/60 rounded-lg">
                <span className="font-mono text-[10px] font-bold text-brand-taupe uppercase">BUS</span>
                <span className="font-mono text-xs text-brand-dark font-bold">
                  {isConnected ? 'ACTIVE' : 'STANDBY'}
                </span>
              </div>
              <div className="flex items-center gap-1.5 px-2 py-1 bg-brand-cream/60 rounded-lg">
                <span className="font-mono text-[10px] font-bold text-brand-taupe uppercase">CLK</span>
                <span className="font-mono text-xs text-brand-dark font-bold">16MHz</span>
              </div>
              <div className="flex items-center gap-1.5 px-2 py-1 bg-brand-cream/60 rounded-lg">
                <span className="font-mono text-[10px] font-bold text-brand-taupe uppercase">VOLT</span>
                <span className="font-mono text-xs text-brand-deep font-bold">3.3V</span>
              </div>
            </div>

            {/* Connection Badge & USB Action */}
            <div className="flex items-center gap-3 glass-card-inner px-3 py-1.5 rounded-xl shadow-sm">
              <div className="flex flex-col text-right">
                <div className="flex items-center justify-end gap-1.5">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      isConnected
                        ? 'bg-emerald-500'
                        : isWaitingReady
                          ? 'bg-amber-500 animate-pulse'
                          : isError
                            ? 'bg-rose-500'
                            : 'bg-rose-500 animate-ping'
                    }`}
                  />
                  <span
                    className={`font-mono text-[10px] font-bold uppercase ${
                      isConnected
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
                  ESP32-WROOM · 115200
                </span>
              </div>
              <button
                className={`flex items-center gap-1.5 ${
                  isConnected
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
                    : isConnected
                      ? 'Disconnect'
                      : isError
                        ? 'Retry USB'
                        : 'Connect USB'}
                <span className="font-mono text-[9px] px-1 py-0.5 bg-white/20 text-white rounded">
                  WEB-SERIAL
                </span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* MAIN VIEWPORT */}
      <main className="w-full pt-28 pb-12 flex-1 flex flex-col">
        <div className="w-full max-w-[1680px] mx-auto px-4 md:px-8 flex flex-col gap-5 text-brand-dark">
          {/* 1. TOP HARDWARE TELEMETRY & PINOUT STRIP */}
          <section className="w-full glass-panel rounded-2xl p-4 md:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 relative overflow-hidden">
            <div className="absolute -right-16 -top-16 w-64 h-64 rounded-full bg-brand-slate/20 blur-3xl pointer-events-none" />

            {/* Left: Hardware Spec Chips */}
            <div className="flex flex-wrap items-center gap-3 z-10">
              <div className="flex items-center gap-3 glass-card-inner px-3.5 py-1.5 rounded-xl shadow-sm">
                <div className="w-3 h-3 rounded-full bg-brand-slate shadow-[0_0_8px_rgba(183,196,207,0.9)]" />
                <div className="flex flex-col">
                  <span className="font-mono text-[10px] text-brand-taupe font-bold uppercase tracking-wider">
                    HARDWARE CORE
                  </span>
                  <span className="font-mono text-xs md:text-sm text-brand-dark font-extrabold tracking-wide">
                    ESP32-WROOM-32D
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2 glass-card-inner px-3 py-2 rounded-xl">
                <span className="material-symbols-outlined text-[16px] text-brand-taupe">schema</span>
                <span className="font-mono text-[10px] text-brand-taupe uppercase font-semibold">
                  BUS STATE:
                </span>
                <span className="font-mono text-xs text-brand-dark font-bold tracking-wider">
                  {isConnected ? 'GPIO / DECODER BUS ACTIVE LINK' : 'GPIO / DECODER BUS LINK STANDBY'}
                </span>
              </div>

              <div className="flex items-center gap-2 glass-card-inner px-3 py-2 rounded-xl">
                <span className="font-mono text-[10px] text-brand-taupe uppercase font-semibold">
                  CORE ARCH:
                </span>
                <span className="font-mono text-xs text-brand-deep font-semibold">
                  HARVARD / 16-BIT CISC/RISC EMU
                </span>
              </div>
            </div>

            {/* Right: Active Bus LED Indicators Array (5 LEDs) */}
            <div className="flex flex-wrap items-center gap-2.5 z-10">
              {/* ROM ACCESS */}
              <div
                className={`flex items-center gap-2 px-3 py-1.5 rounded-xl transition-all shadow-sm ${
                  decoded.activeLed === 'rom'
                    ? 'bg-blue-100/70 border border-blue-400/80 shadow-[0_0_10px_rgba(59,130,246,0.3)]'
                    : 'glass-card-inner opacity-60'
                }`}
              >
                <span className="relative flex h-2.5 w-2.5">
                  {decoded.activeLed === 'rom' && (
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                  )}
                  <span
                    className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                      decoded.activeLed === 'rom'
                        ? 'bg-blue-600 shadow-[0_0_6px_rgba(37,99,235,0.8)]'
                        : 'bg-brand-sand'
                    }`}
                  />
                </span>
                <span className="font-mono text-xs font-bold text-brand-dark">ROM ACCESS</span>
                <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-white/70 text-brand-deep font-bold border border-brand-sand/50">
                  L-01
                </span>
              </div>

              {/* RAM ACCESS */}
              <div
                className={`flex items-center gap-2 px-3 py-1.5 rounded-xl transition-all shadow-sm ${
                  decoded.activeLed === 'ram'
                    ? 'bg-emerald-100/70 border border-emerald-400/80 shadow-[0_0_10px_rgba(16,185,129,0.3)]'
                    : 'glass-card-inner opacity-60'
                }`}
              >
                <span className="relative flex h-2.5 w-2.5">
                  {decoded.activeLed === 'ram' && (
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  )}
                  <span
                    className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                      decoded.activeLed === 'ram'
                        ? 'bg-emerald-600 shadow-[0_0_6px_rgba(5,150,105,0.8)]'
                        : 'bg-brand-sand'
                    }`}
                  />
                </span>
                <span className="font-mono text-xs font-bold text-brand-dark">RAM ACCESS</span>
                <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-white/70 text-brand-deep font-bold border border-brand-sand/50">
                  L-02
                </span>
              </div>

              {/* I/O ACCESS */}
              <div
                className={`flex items-center gap-2 px-3 py-1.5 rounded-xl transition-all shadow-sm ${
                  decoded.activeLed === 'io'
                    ? 'bg-amber-100/70 border border-amber-400/80 shadow-[0_0_10px_rgba(245,158,11,0.3)]'
                    : 'glass-card-inner opacity-60'
                }`}
              >
                <span className="relative flex h-2.5 w-2.5">
                  {decoded.activeLed === 'io' && (
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                  )}
                  <span
                    className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                      decoded.activeLed === 'io'
                        ? 'bg-amber-600 shadow-[0_0_6px_rgba(217,119,6,0.8)]'
                        : 'bg-brand-sand'
                    }`}
                  />
                </span>
                <span className="font-mono text-xs font-bold text-brand-dark">I/O ACCESS</span>
                <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-white/70 text-brand-deep font-bold border border-brand-sand/50">
                  L-03
                </span>
              </div>

              {/* IMMED / NO MEM */}
              <div
                className={`flex items-center gap-2 px-3 py-1.5 rounded-xl transition-all shadow-sm ${
                  decoded.activeLed === 'immediate'
                    ? 'bg-white/90 border border-slate-300 shadow-[0_0_8px_rgba(255,255,255,0.9)]'
                    : 'glass-card-inner opacity-60'
                }`}
              >
                <span className="relative flex h-2.5 w-2.5">
                  <span
                    className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                      decoded.activeLed === 'immediate' ? 'bg-white border border-slate-400' : 'bg-brand-sand'
                    }`}
                  />
                </span>
                <span className="font-mono text-xs font-bold text-brand-dark">IMMED / NO MEM</span>
                <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-white/70 text-brand-deep font-bold border border-brand-sand/50">
                  L-04
                </span>
              </div>

              {/* ERROR INDICATOR */}
              <div
                className={`flex items-center gap-2 px-3 py-1.5 rounded-xl transition-all shadow-sm ${
                  decoded.activeLed === 'error'
                    ? 'bg-rose-100/90 border border-rose-400 shadow-[0_0_10px_rgba(239,68,68,0.4)]'
                    : 'glass-card-inner border border-emerald-300/60 bg-emerald-50/50'
                }`}
              >
                <span
                  className={`inline-flex rounded-full h-2.5 w-2.5 ${
                    decoded.activeLed === 'error'
                      ? 'bg-rose-500 shadow-[0_0_6px_rgba(239,68,68,0.8)] animate-pulse'
                      : 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]'
                  }`}
                />
                <span
                  className={`font-mono text-xs font-bold uppercase tracking-wider ${
                    decoded.activeLed === 'error' ? 'text-rose-800' : 'text-emerald-800'
                  }`}
                >
                  {decoded.activeLed === 'error' ? 'ERR: FAULT' : 'ERR: OK'}
                </span>
              </div>
            </div>
          </section>

          {/* 2 & 3. MAIN WORKBENCH GRID */}
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
            {/* LEFT: 16-BIT MACHINE WORD & LOGIC ANALYZER (8 COLS) */}
            <section className="xl:col-span-8 flex flex-col gap-4 glass-panel p-5 md:p-6 rounded-2xl relative">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-brand-sand/30">
                <div className="flex items-center gap-3">
                  <span className="w-2 h-7 bg-brand-slate rounded-full shadow-sm" />
                  <div>
                    <span className="font-mono text-[10px] text-brand-taupe font-bold uppercase tracking-wider">
                      STAGE 01 // INSTRUCTION BUS TAP
                    </span>
                    <h2 className="font-sans text-xl md:text-2xl text-brand-dark font-bold uppercase tracking-tight">
                      16-Bit Machine Word &amp; Logic Analyzer
                    </h2>
                  </div>
                </div>
                <div className="flex items-center gap-2 self-start sm:self-auto glass-card-inner px-3 py-1.5 rounded-xl">
                  <span className="font-mono text-[10px] text-brand-taupe uppercase font-semibold">
                    PROTOCOL:
                  </span>
                  <span className="font-mono text-xs text-brand-dark font-bold">
                    16-BIT BIG ENDIAN [15:0]
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
                    className="flex items-center gap-2 bg-brand-dark text-brand-cream hover:bg-brand-deep hover:text-white px-5 py-2.5 rounded-xl font-mono text-xs font-bold uppercase tracking-wider transition-all shadow-md active:translate-y-0.5"
                    type="button"
                    onClick={handleDecodeClick}
                  >
                    <span className="material-symbols-outlined text-[16px]">play_circle</span>
                    {isDeviceReady() ? 'Decode (ESP32)' : 'Decode'}
                  </button>
                </div>

                {/* Quick Test Presets */}
                <div className="flex flex-wrap items-center gap-1.5 w-full md:w-auto justify-end">
                  <span className="font-mono text-[10px] text-brand-taupe uppercase font-bold mr-1">
                    PRESETS:
                  </span>
                  {PRESETS.map((preset) => (
                    <button
                      key={preset.code}
                      className="px-2.5 py-1.5 rounded-lg bg-white/70 hover:bg-brand-slate/40 text-brand-deep font-mono text-xs font-semibold border border-brand-sand/40 transition-colors shadow-sm"
                      type="button"
                      onClick={() => executeDecode(preset.code, mapMode)}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 16-Bit Architecture Sub-Field Partition Badges */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
                {/* Opcode */}
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
                    <span className="font-mono text-[11px] text-brand-deep font-bold">
                      0x{opVal.toString(16).toUpperCase()} ({opNames[opVal] || 'OP'})
                    </span>
                  </div>
                </div>

                {/* Dest Reg */}
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

                {/* Src Reg */}
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
                    <span className="font-mono text-[11px] text-brand-taupe font-bold">
                      R{srcVal} ({srcVal.toString(2).padStart(3, '0')}b)
                    </span>
                  </div>
                </div>

                {/* Addr Mode */}
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
                      {modeNames[modeVal]}
                    </span>
                  </div>
                </div>

                {/* Offset */}
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
                        title={`Toggle bit ${bit}`}
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
                    ALU_ADD ({decoded.effectiveAddress})
                  </text>
                  <text className="font-mono text-[9px] font-bold" fill="#3E2B25" x="590" y="46">
                    {decoded.accessType === 'Write' ? 'MEM_WRITE' : 'MEM_READ'}
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
                      decoded.hasOverlapConflict
                        ? 'bg-rose-100 text-rose-800 border-rose-300'
                        : decoded.errorStatus === 'OK'
                          ? 'bg-emerald-100/80 text-emerald-800 border-emerald-300/50'
                          : 'bg-rose-100/80 text-rose-800 border-rose-300/50'
                    }`}
                  >
                    {decoded.hasOverlapConflict
                      ? 'OVERLAP CONFLICT'
                      : decoded.errorStatus === 'OK'
                        ? 'VALID / OK'
                        : 'FAULT'}
                  </span>
                </div>

                <p className="font-body text-xs text-brand-deep leading-relaxed">
                  Decoded microcode telemetry lines ready for ALU execution &amp; memory addressing.
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
                        {decoded.opcode}
                      </span>
                    </div>
                  </div>

                  {/* Destination Register */}
                  <div className="flex items-center justify-between px-3.5 py-2 hover:bg-white/60 transition-colors bg-white/30">
                    <span className="font-mono text-[10px] text-brand-taupe uppercase font-bold">
                      DEST REGISTER
                    </span>
                    <span className="font-mono text-xs text-brand-dark font-bold">
                      {decoded.destReg} (Target Accumulator)
                    </span>
                  </div>

                  {/* Source Register */}
                  <div className="flex items-center justify-between px-3.5 py-2 hover:bg-white/60 transition-colors">
                    <span className="font-mono text-[10px] text-brand-taupe uppercase font-bold">
                      SRC REGISTER
                    </span>
                    <span className="font-mono text-xs text-brand-dark font-bold">
                      {decoded.srcReg} (Base Address)
                    </span>
                  </div>

                  {/* Addressing Mode */}
                  <div className="flex items-center justify-between px-3.5 py-2 hover:bg-white/60 transition-colors bg-white/30">
                    <span className="font-mono text-[10px] text-brand-taupe uppercase font-bold">
                      ADDRESSING MODE
                    </span>
                    <span className="font-mono text-xs text-brand-deep font-bold">
                      {decoded.addrMode}
                    </span>
                  </div>

                  {/* Offset */}
                  <div className="flex items-center justify-between px-3.5 py-2 hover:bg-white/60 transition-colors">
                    <span className="font-mono text-[10px] text-brand-taupe uppercase font-bold">
                      OFFSET DISPLACEMENT
                    </span>
                    <span className="font-mono text-xs text-brand-dark font-bold">
                      {decoded.offset}
                    </span>
                  </div>

                  {/* Effective Address */}
                  <div className="flex items-center justify-between px-3.5 py-2 hover:bg-white/60 transition-colors bg-brand-slate/20">
                    <span className="font-mono text-[10px] text-brand-dark uppercase font-bold">
                      EFFECTIVE ADDRESS
                    </span>
                    <span className="font-mono text-xs text-brand-dark font-extrabold">
                      {decoded.effectiveAddress}{' '}
                      {decoded.effectiveAddressDecimal !== 'N/A' &&
                        `(${decoded.effectiveAddressDecimal} dec)`}
                    </span>
                  </div>

                  {/* Memory Region */}
                  <div className="flex items-center justify-between px-3.5 py-2 hover:bg-white/60 transition-colors">
                    <span className="font-mono text-[10px] text-brand-taupe uppercase font-bold">
                      TARGET REGION
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded font-mono text-xs font-bold uppercase border ${
                        decoded.hasOverlapConflict
                          ? 'bg-rose-100 text-rose-800 border-rose-300'
                          : 'bg-brand-sand/40 text-brand-dark border-brand-sand/60'
                      }`}
                    >
                      {decoded.memoryRegion}
                    </span>
                  </div>

                  {/* Access Type */}
                  <div className="flex items-center justify-between px-3.5 py-2 hover:bg-white/60 transition-colors bg-white/30">
                    <span className="font-mono text-[10px] text-brand-taupe uppercase font-bold">
                      ACCESS TYPE
                    </span>
                    <span className="font-mono text-xs text-brand-dark font-bold">
                      {decoded.accessType}
                    </span>
                  </div>

                  {/* Bus Error Status */}
                  <div className="flex items-center justify-between px-3.5 py-2 hover:bg-white/60 transition-colors">
                    <span className="font-mono text-[10px] text-brand-taupe uppercase font-bold">
                      BUS ERROR STATUS
                    </span>
                    <span
                      className={`flex items-center gap-1.5 font-mono text-xs font-bold ${
                        decoded.errorStatus === 'OK' ? 'text-emerald-800' : 'text-rose-700'
                      }`}
                    >
                      <span
                        className={`w-2 h-2 rounded-full ${
                          decoded.errorStatus === 'OK' ? 'bg-emerald-500' : 'bg-rose-500 animate-ping'
                        }`}
                      />
                      {decoded.errorStatus === 'OK' ? 'NONE (0x00 OK)' : decoded.errorStatus}
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

          {/* 4. 16-BIT ARCHITECTURE ADDRESS SPACE & HARDWARE MEMORY MAP */}
          <section className="w-full glass-panel p-5 md:p-6 rounded-2xl flex flex-col gap-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-brand-sand/30">
              <div className="flex items-center gap-3">
                <span className="w-2 h-7 bg-brand-sand rounded-full shadow-sm" />
                <div>
                  <span className="font-mono text-[10px] text-brand-taupe font-bold uppercase tracking-wider">
                    STAGE 02 // BUS INTERFACE UNIT
                  </span>
                  <h2 className="font-sans text-xl md:text-2xl text-brand-dark font-bold uppercase tracking-tight">
                    16-Bit Architecture Address Space (0x0000–0xFFFF)
                  </h2>
                </div>
              </div>

              {/* Mode Toggle & Target Callout */}
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center bg-white/70 p-1 rounded-xl border border-brand-sand/40 shadow-sm">
                  <button
                    className={`px-3.5 py-1.5 rounded-lg font-mono text-xs font-bold uppercase transition-all shadow-sm ${
                      mapMode === MEMORY_MAPS.DEFAULT
                        ? 'bg-brand-dark text-white'
                        : 'text-brand-deep hover:text-brand-dark'
                    }`}
                    type="button"
                    onClick={() => handleMapChange(MEMORY_MAPS.DEFAULT)}
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
                    onClick={() => handleMapChange(MEMORY_MAPS.OVERLAP)}
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
                    {decoded.addressValue !== null
                      ? `${decoded.effectiveAddress} (${decoded.effectiveAddressDecimal} dec) ➔ ${decoded.memoryRegion}`
                      : 'None (Immediate)'}
                  </span>
                </div>
              </div>
            </div>

            {/* Segmented Physical Address Space Ruler / Memory Strip */}
            <div className="flex flex-col gap-1.5 glass-card-inner p-4 rounded-xl shadow-inner">
              <div className="flex items-center justify-between font-mono text-[10px] text-brand-taupe font-bold">
                <span>0x0000 [BOOT]</span>
                <span>0x4000 [16K]</span>
                {mapMode === MEMORY_MAPS.OVERLAP && <span className="text-rose-700">0x7000 [OVERLAP]</span>}
                <span>0x8000 [32K]</span>
                <span>0xA000 [40K]</span>
                <span>0xFFFF [64K TOP]</span>
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

                {/* I/O Segment (0x8000 - 0x9FFF, 12.5% default) */}
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

                {/* Overlap hatched slice when in Overlap Map Mode */}
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
                      backgroundColor: decoded.hasOverlapConflict ? '#ef4444' : '#2C1810',
                      boxShadow: decoded.hasOverlapConflict
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
                      color: decoded.hasOverlapConflict ? '#ef4444' : '#2C1810',
                    }}
                  >
                    <span className="material-symbols-outlined text-[14px]">arrow_upward</span>
                    <span>
                      {decoded.effectiveAddress} (
                      {decoded.hasOverlapConflict ? 'OVERLAP CONFLICT' : decoded.memoryRegion})
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Memory Region Detailed Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* ROM Block */}
              <div
                className={`glass-card-inner p-4 rounded-xl flex flex-col justify-between shadow-sm relative overflow-hidden ${
                  decoded.addressValue !== null && decoded.addressValue <= 0x3fff
                    ? 'border-2 border-brand-slate bg-white/75'
                    : ''
                }`}
              >
                {decoded.addressValue !== null && decoded.addressValue <= 0x3fff && (
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
                  decoded.addressValue !== null &&
                  decoded.addressValue >= 0x4000 &&
                  decoded.addressValue <= 0x7fff
                    ? 'border-2 border-brand-sand bg-white/75'
                    : ''
                }`}
              >
                {decoded.addressValue !== null &&
                  decoded.addressValue >= 0x4000 &&
                  decoded.addressValue <= 0x7fff && (
                    <div
                      className={`absolute top-0 right-0 px-2.5 py-0.5 font-mono text-[9px] font-bold uppercase rounded-bl-lg shadow-sm ${
                        decoded.hasOverlapConflict
                          ? 'bg-rose-600 text-white'
                          : 'bg-brand-dark text-white'
                      }`}
                    >
                      {decoded.hasOverlapConflict ? 'OVERLAP CONFLICT' : 'ACTIVE TARGET'}
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
                    System memory, program stack frames, dynamic heap, and volatile buffers.
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
                  decoded.addressValue !== null &&
                  ((mapMode === MEMORY_MAPS.DEFAULT &&
                    decoded.addressValue >= 0x8000 &&
                    decoded.addressValue <= 0x9fff) ||
                    (mapMode === MEMORY_MAPS.OVERLAP &&
                      decoded.addressValue >= 0x7000 &&
                      decoded.addressValue <= 0x9fff))
                    ? 'border-2 border-amber-300 bg-white/75'
                    : ''
                }`}
              >
                {decoded.addressValue !== null &&
                  ((mapMode === MEMORY_MAPS.DEFAULT &&
                    decoded.addressValue >= 0x8000 &&
                    decoded.addressValue <= 0x9fff) ||
                    (mapMode === MEMORY_MAPS.OVERLAP &&
                      decoded.addressValue >= 0x7000 &&
                      decoded.addressValue <= 0x9fff)) && (
                    <div
                      className={`absolute top-0 right-0 px-2.5 py-0.5 font-mono text-[9px] font-bold uppercase rounded-bl-lg shadow-sm ${
                        decoded.hasOverlapConflict
                          ? 'bg-rose-600 text-white'
                          : 'bg-brand-dark text-white'
                      }`}
                    >
                      {decoded.hasOverlapConflict ? 'OVERLAP CONFLICT' : 'ACTIVE TARGET'}
                    </div>
                  )}
                <div>
                  <div className="flex items-center gap-2 pb-1">
                    <span className="font-sans text-xl font-bold text-brand-dark">I/O SPACE</span>
                    <span className="font-mono text-xs text-brand-taupe font-bold">
                      {mapMode === MEMORY_MAPS.OVERLAP ? '12 KB' : '8 KB'}
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
                  decoded.addressValue !== null && decoded.addressValue >= 0xa000
                    ? 'border-2 border-rose-400 bg-white/75'
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
          <section className="w-full glass-panel p-5 rounded-2xl flex flex-col gap-3">
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
