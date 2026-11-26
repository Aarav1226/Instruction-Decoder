/**
 * Hardware Device Specifications and Decoder Logic
 * Strictly implementing DEVICE_GUIDE.md
 */

export const CONNECTION_STATES = {
  DISCONNECTED: 'Disconnected',
  CONNECTING: 'Connecting',
  CONNECTED: 'Connected',
  ERROR: 'Error',
};

export const MEMORY_MAPS = {
  DEFAULT: 'Default',
  OVERLAP: 'Overlap',
};

// Section 3: 16-bit instruction fields breakdown
export const BIT_FIELDS = [
  { key: 'opcode', label: 'Opcode', bits: 4, range: '[15:12]', colorClass: 'field-opcode' },
  { key: 'dest', label: 'Dest Reg', bits: 3, range: '[11:9]', colorClass: 'field-dest' },
  { key: 'src', label: 'Src Reg', bits: 3, range: '[8:6]', colorClass: 'field-src' },
  { key: 'mode', label: 'Addr Mode', bits: 2, range: '[5:4]', colorClass: 'field-mode' },
  { key: 'offset', label: 'Offset', bits: 4, range: '[3:0]', colorClass: 'field-offset' },
];

// Section 4: Fixed register values on the device
export const FIXED_REGISTERS = [
  { id: 0, name: 'R0', value: 0x0000, region: 'ROM', desc: 'Points into ROM' },
  { id: 1, name: 'R1', value: 0x4010, region: 'RAM', desc: 'Points into RAM' },
  { id: 2, name: 'R2', value: 0x8000, region: 'I/O', desc: 'Points into I/O' },
  { id: 3, name: 'R3', value: 0xA000, region: 'Unmapped', desc: 'Points into Unmapped' },
  { id: 4, name: 'R4', value: 0x0100, region: 'ROM', desc: 'Points into ROM' },
  { id: 5, name: 'R5', value: 0x7FFC, region: 'RAM', desc: 'Inside overlap zone in Overlap map' },
  { id: 6, name: 'R6', value: 0x3FFE, region: 'ROM', desc: 'Points into ROM' },
  { id: 7, name: 'R7', value: 0xFFFE, region: 'Top of memory', desc: 'Top of memory' },
];

// Section 3: Opcodes (1-4 valid, anything else invalid)
export const OPCODES = {
  0x1: 'LOAD',
  0x2: 'STORE',
  0x3: 'ADD',
  0x4: 'JMP',
};

// Section 3: Addressing modes
export const ADDRESSING_MODES = {
  0b00: { code: 0, name: 'Immediate', desc: 'None. The offset is a value, no memory access' },
  0b01: { code: 1, name: 'Direct', desc: 'The offset itself (0x0–0xF)' },
  0b10: { code: 2, name: 'Register indirect', desc: 'The value in the src register' },
  0b11: { code: 3, name: 'Indexed', desc: 'Src register value + offset' },
};

// Section 5: Memory maps
export const MEMORY_REGIONS = {
  [MEMORY_MAPS.DEFAULT]: [
    {
      id: 'rom',
      name: 'ROM',
      start: 0x0000,
      end: 0x3FFF,
      color: 'blue',
      permissions: 'Read only',
      desc: 'Program code & firmware constants. Non-volatile boot memory.',
    },
    {
      id: 'ram',
      name: 'RAM',
      start: 0x4000,
      end: 0x7FFF,
      color: 'green',
      permissions: 'Read / write',
      desc: 'System memory, stack frames, dynamic heap, volatile buffers.',
    },
    {
      id: 'io',
      name: 'I/O',
      start: 0x8000,
      end: 0x9FFF,
      color: 'yellow',
      permissions: 'Read / write',
      desc: 'Memory-mapped peripherals, UART, timers, interrupts.',
    },
    {
      id: 'unmapped',
      name: 'Unmapped',
      start: 0xA000,
      end: 0xFFFF,
      color: 'muted',
      permissions: 'None (Fault)',
      desc: 'Reserved floating address space. Access triggers bus fault.',
    },
  ],
  [MEMORY_MAPS.OVERLAP]: [
    {
      id: 'rom',
      name: 'ROM',
      start: 0x0000,
      end: 0x3FFF,
      color: 'blue',
      permissions: 'Read only',
      desc: 'Program code & firmware constants.',
    },
    {
      id: 'ram',
      name: 'RAM',
      start: 0x4000,
      end: 0x7FFF,
      color: 'green',
      permissions: 'Read / write',
      desc: 'RAM overlaps I/O from 0x7000 to 0x7FFF.',
      overlapStart: 0x7000,
      overlapEnd: 0x7FFF,
    },
    {
      id: 'io',
      name: 'I/O',
      start: 0x7000,
      end: 0x9FFF,
      color: 'yellow',
      permissions: 'Read / write',
      desc: 'I/O overlaps RAM from 0x7000 to 0x7FFF.',
      overlapStart: 0x7000,
      overlapEnd: 0x7FFF,
    },
    {
      id: 'unmapped',
      name: 'Unmapped',
      start: 0xA000,
      end: 0xFFFF,
      color: 'muted',
      permissions: 'None (Fault)',
      desc: 'Reserved floating address space.',
    },
  ],
};

// Section 11: Official test cases from DEVICE_GUIDE.md
export const OFFICIAL_TEST_CASES = [
  {
    code: '1A73',
    label: '1A73 (LOAD R5,[R1+3] ➔ RAM)',
    instruction: 'LOAD R5,[R1+3]',
    map: MEMORY_MAPS.DEFAULT,
    eaHex: '0x4013',
    region: 'RAM',
    error: '',
    ledDesc: 'Green',
  },
  {
    code: '22A0',
    label: '22A0 (STORE R1,[R2] ➔ I/O)',
    instruction: 'STORE R1,[R2]',
    map: MEMORY_MAPS.DEFAULT,
    eaHex: '0x8000',
    region: 'I/O',
    error: '',
    ledDesc: 'Yellow',
  },
  {
    code: '3205',
    label: '3205 (ADD R1,#5 ➔ Immed)',
    instruction: 'ADD R1,#5',
    map: MEMORY_MAPS.DEFAULT,
    eaHex: 'none',
    region: '',
    error: '',
    ledDesc: 'White',
  },
  {
    code: '2120',
    label: '2120 (STORE ROM ➔ PERMISSION DENIED)',
    instruction: 'STORE R0,[R4]',
    map: MEMORY_MAPS.DEFAULT,
    eaHex: '0x0100',
    region: 'ROM',
    error: 'PERMISSION DENIED',
    ledDesc: 'Red + Blue',
  },
  {
    code: '10E0',
    label: '10E0 (LOAD R0,[R3] ➔ UNMAPPED ADDR)',
    instruction: 'LOAD R0,[R3]',
    map: MEMORY_MAPS.DEFAULT,
    eaHex: '0xA000',
    region: '',
    error: 'UNMAPPED ADDR',
    ledDesc: 'Red',
  },
  {
    code: '11FF',
    label: '11FF (LOAD R7+15 ➔ OUT OF RANGE)',
    instruction: 'LOAD R0,[R7+15]',
    map: MEMORY_MAPS.DEFAULT,
    eaHex: '0x1000D',
    region: '',
    error: 'OUT OF RANGE',
    ledDesc: 'Red',
  },
];

// Physical LED hardware definitions on the ESP32 (DEVICE_GUIDE.md Section 2)
export const LED_INDICATORS = [
  {
    key: 'blue',
    label: 'Blue LED',
    bus: 'ROM Access',
    gpio: 'GPIO 21',
    description: 'Address is in ROM (0x0000–0x3FFF)',
    colorHex: '#3b82f6',
    activeGlow: 'rgba(59, 130, 246, 0.85)',
  },
  {
    key: 'green',
    label: 'Green LED',
    bus: 'RAM Access',
    gpio: 'GPIO 22',
    description: 'Address is in RAM (0x4000–0x7FFF)',
    colorHex: '#10b981',
    activeGlow: 'rgba(16, 185, 129, 0.85)',
  },
  {
    key: 'yellow',
    label: 'Yellow LED',
    bus: 'I/O Access',
    gpio: 'GPIO 19',
    description: 'Address is in I/O (0x8000–0x9FFF / Overlap)',
    colorHex: '#eab308',
    activeGlow: 'rgba(234, 179, 8, 0.85)',
  },
  {
    key: 'white',
    label: 'White LED',
    bus: 'Immediate / No Bus',
    gpio: 'GPIO 18',
    description: 'Valid instruction with no memory access (immediate mode)',
    colorHex: '#ffffff',
    activeGlow: 'rgba(255, 255, 255, 0.95)',
  },
  {
    key: 'red',
    label: 'Red LED',
    bus: 'Hardware Error',
    gpio: 'GPIO 23',
    description: 'Any error (blinks 3 times, then stays on)',
    colorHex: '#ef4444',
    activeGlow: 'rgba(239, 68, 68, 0.95)',
  },
];

// Complete 10-Condition Test Bench covering all hardware error and LED permutations (DEVICE_GUIDE.md Section 11)
export const HARDWARE_TEST_CONDITIONS = [
  {
    id: 'valid-rom',
    name: '1. Valid ROM Access',
    shortName: 'ROM Access',
    code: '1040',
    map: MEMORY_MAPS.DEFAULT,
    instruction: 'LOAD R0, [R4+0]',
    ea: 0x0100,
    region: 'ROM',
    error: '',
    expectedLeds: ['blue'],
    ledDesc: 'Blue LED',
    description: 'Read from ROM (0x0000–0x3FFF). Normal read bus cycle.',
  },
  {
    id: 'valid-ram',
    name: '2. Valid RAM Access',
    shortName: 'RAM Access',
    code: '1A73',
    map: MEMORY_MAPS.DEFAULT,
    instruction: 'LOAD R5, [R1+3]',
    ea: 0x4013,
    region: 'RAM',
    error: '',
    expectedLeds: ['green'],
    ledDesc: 'Green LED',
    description: 'Read from RAM (0x4000–0x7FFF). Valid indexed read access.',
  },
  {
    id: 'valid-io',
    name: '3. Valid I/O Access',
    shortName: 'I/O Access',
    code: '22A0',
    map: MEMORY_MAPS.DEFAULT,
    instruction: 'STORE R1, [R2+0]',
    ea: 0x8000,
    region: 'I/O',
    error: '',
    expectedLeds: ['yellow'],
    ledDesc: 'Yellow LED',
    description: 'Write to I/O space (0x8000–0x9FFF). Valid memory-mapped I/O cycle.',
  },
  {
    id: 'immediate-mode',
    name: '4. Immediate Mode',
    shortName: 'Immediate',
    code: '3205',
    map: MEMORY_MAPS.DEFAULT,
    instruction: 'ADD R1, R0, #5',
    ea: 0,
    region: '',
    error: '',
    expectedLeds: ['white'],
    ledDesc: 'White LED',
    description: 'Valid instruction without memory access. Offset is literal immediate data.',
  },
  {
    id: 'invalid-opcode',
    name: '5. INVALID OPCODE',
    shortName: 'Opcode Fault',
    code: 'F000',
    map: MEMORY_MAPS.DEFAULT,
    instruction: 'opcode 1111',
    ea: 0,
    region: '',
    error: 'INVALID OPCODE',
    expectedLeds: ['red'],
    ledDesc: 'Red LED',
    description: 'Opcode nibble 0xF is not in defined set (1-4). Control unit halts with fault.',
  },
  {
    id: 'invalid-mode',
    name: '6. INVALID MODE',
    shortName: 'Mode Fault',
    code: '2005',
    map: MEMORY_MAPS.DEFAULT,
    instruction: 'STORE R0, #5',
    ea: 0,
    region: '',
    error: 'INVALID MODE',
    expectedLeds: ['red'],
    ledDesc: 'Red LED',
    description: 'Cannot execute STORE into an immediate operand (Mode 0).',
  },
  {
    id: 'out-of-range',
    name: '7. OUT OF RANGE',
    shortName: 'Range Overflow',
    code: '11FF',
    map: MEMORY_MAPS.DEFAULT,
    instruction: 'LOAD R0, [R7+15]',
    ea: 0x1000D,
    region: '',
    error: 'OUT OF RANGE',
    expectedLeds: ['red'],
    ledDesc: 'Red LED',
    description: 'Effective address 0x1000D overflows 16-bit address bus (> 0xFFFF).',
  },
  {
    id: 'unmapped-addr',
    name: '8. UNMAPPED ADDR',
    shortName: 'Unmapped',
    code: '10E0',
    map: MEMORY_MAPS.DEFAULT,
    instruction: 'LOAD R0, [R3+0]',
    ea: 0xA000,
    region: '',
    error: 'UNMAPPED ADDR',
    expectedLeds: ['red'],
    ledDesc: 'Red LED',
    description: 'Address 0xA000 points to unmapped address space (0xA000–0xFFFF).',
  },
  {
    id: 'overlap-conflict',
    name: '9. OVERLAP CONFLICT',
    shortName: 'Overlap Conflict',
    code: '1160',
    map: MEMORY_MAPS.OVERLAP,
    instruction: 'LOAD R0, [R5+0]',
    ea: 0x7FFC,
    region: 'RAM',
    error: 'OVERLAP CONFLICT',
    expectedLeds: ['red', 'green', 'yellow'],
    ledDesc: 'Red + Green + Yellow LEDs',
    description: 'Address 0x7FFC falls in simultaneous RAM & I/O overlap window (0x7000–0x7FFF).',
  },
  {
    id: 'permission-denied',
    name: '10. PERMISSION DENIED',
    shortName: 'ROM Write Fault',
    code: '2120',
    map: MEMORY_MAPS.DEFAULT,
    instruction: 'STORE R0, [R4+0]',
    ea: 0x0100,
    region: 'ROM',
    error: 'PERMISSION DENIED',
    expectedLeds: ['red', 'blue'],
    ledDesc: 'Red + Blue LEDs',
    description: 'STORE attempted into read-only ROM (0x0000–0x3FFF). Write fault triggered.',
  },
];


export function formatHex16(val) {
  if (val === null || val === undefined || Number.isNaN(val)) return '—';
  return `0x${val.toString(16).toUpperCase().padStart(4, '0')}`;
}

export function formatDecimal(val) {
  if (val === null || val === undefined || Number.isNaN(val)) return '—';
  return val.toLocaleString('en-US');
}

export function hexToBinary16(hex) {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '').slice(0, 4).padStart(4, '0');
  const value = parseInt(clean, 16);
  return Number.isNaN(value) ? '0000000000000000' : value.toString(2).padStart(16, '0');
}

/**
 * Computes which physical LEDs glow according to Section 2 and Section 11:
 * - Blue LED: Address is in ROM
 * - Green LED: Address is in RAM (or inside RAM/IO overlap)
 * - Yellow LED: Address is in I/O (or inside RAM/IO overlap)
 * - White LED: Valid instruction with no memory access (immediate mode)
 * - Red LED: Any error (blinks 3 times, then stays on)
 */
export function computeLeds({ op, memAccess, region, error, hasOverlapConflict }) {
  const hasError = Boolean(error && error.length > 0);
  const isImmediate = !memAccess && op !== 'INVALID' && !hasError;

  return {
    blue: region === 'ROM',
    green: region === 'RAM' || hasOverlapConflict,
    yellow: region === 'I/O' || hasOverlapConflict,
    white: isImmediate,
    red: hasError,
  };
}

/**
 * Strict JavaScript Instruction Decoder implementation
 * Following Section 3, 4, 5, 6 of DEVICE_GUIDE.md.
 *
 * Returns exact JSON structure as the hardware:
 * {"type":"decode","instr":"1A73","op":"LOAD","rd":5,"rs":1,"mode":3,"offset":3,"memAccess":true,"ea":16403,"region":"RAM","map":"Default","error":""}
 */
export function decodeInstructionJS(rawHex, mapMode = MEMORY_MAPS.DEFAULT) {
  const instr = (rawHex || '').replace(/[^0-9a-fA-F]/g, '').slice(0, 4).toUpperCase().padStart(4, '0');
  const val16 = parseInt(instr, 16) & 0xFFFF;

  const opcodeNum = (val16 >> 12) & 0xF;
  const rd = (val16 >> 9) & 0x7;
  const rs = (val16 >> 6) & 0x7;
  const mode = (val16 >> 4) & 0x3;
  const offset = val16 & 0xF;

  const isOpValid = opcodeNum >= 1 && opcodeNum <= 4;
  const op = isOpValid ? OPCODES[opcodeNum] : 'INVALID';

  // Section 3 Addressing mode calculation
  let memAccess = false;
  let ea = 0; // "0 when there's no memory access"

  if (isOpValid) {
    if (mode === 0) {
      // Immediate mode: no memory access
      memAccess = false;
      ea = 0;
    } else if (mode === 1) {
      // Direct mode: The offset itself (0x0 - 0xF)
      memAccess = true;
      ea = offset;
    } else if (mode === 2) {
      // Register indirect: The value in the src register
      memAccess = true;
      ea = FIXED_REGISTERS[rs].value;
    } else if (mode === 3) {
      // Indexed: Src register value + offset
      memAccess = true;
      ea = FIXED_REGISTERS[rs].value + offset;
    }
  }

  // Determine region & overlap
  let region = '';
  let inRom = false;
  let inRam = false;
  let inIo = false;
  let hasOverlapConflict = false;

  if (memAccess) {
    // ROM: 0x0000 - 0x3FFF
    if (ea >= 0x0000 && ea <= 0x3FFF) {
      inRom = true;
      region = 'ROM';
    }

    // RAM: 0x4000 - 0x7FFF
    if (ea >= 0x4000 && ea <= 0x7FFF) {
      inRam = true;
      region = 'RAM';
    }

    // I/O: 0x8000 - 0x9FFF (Default) or 0x7000 - 0x9FFF (Overlap)
    if (mapMode === MEMORY_MAPS.OVERLAP) {
      if (ea >= 0x7000 && ea <= 0x9FFF) {
        inIo = true;
        if (!inRam) region = 'I/O';
      }
      // Check for overlap conflict (RAM and I/O simultaneously: 0x7000 - 0x7FFF)
      if (ea >= 0x7000 && ea <= 0x7FFF) {
        hasOverlapConflict = true;
        region = 'RAM'; // Hardware reports primary region as RAM in overlap conflict
      }
    } else {
      if (ea >= 0x8000 && ea <= 0x9FFF) {
        inIo = true;
        region = 'I/O';
      }
    }
  }

  // Section 6: Check errors in strict order. The first one that applies is reported.
  let error = '';

  if (!isOpValid) {
    error = 'INVALID OPCODE';
  } else if (op === 'STORE' && mode === 0) {
    error = 'INVALID MODE';
  } else if (memAccess && ea > 0xFFFF) {
    error = 'OUT OF RANGE';
    region = '';
  } else if (memAccess && !inRom && !inRam && !inIo) {
    error = 'UNMAPPED ADDR';
    region = '';
  } else if (hasOverlapConflict) {
    error = 'OVERLAP CONFLICT';
  } else if (op === 'STORE' && inRom) {
    error = 'PERMISSION DENIED';
  }

  const leds = computeLeds({ op, memAccess, region, error, hasOverlapConflict });

  return {
    type: 'decode',
    instr,
    op,
    rd,
    rs,
    mode,
    offset,
    memAccess,
    ea,
    region,
    map: mapMode,
    error,
    // UI extended helpers
    leds,
    hasOverlapConflict,
    destRegStr: `R${rd}`,
    srcRegStr: `R${rs}`,
    modeStr: ADDRESSING_MODES[mode]?.name || `Mode ${mode}`,
    effectiveAddressHex: memAccess ? formatHex16(ea) : 'none',
    effectiveAddressDec: memAccess ? formatDecimal(ea) : 'none',
  };
}

/**
 * Normalizes device decode JSON for UI telemetry display
 */
export function formatDeviceDecode(deviceMsg, currentMapMode = MEMORY_MAPS.DEFAULT) {
  const mapMode = deviceMsg.map || currentMapMode;
  const isMemAccess = Boolean(deviceMsg.memAccess);
  const ea = typeof deviceMsg.ea === 'number' ? deviceMsg.ea : parseInt(deviceMsg.ea || 0, 10);
  const hasOverlapConflict =
    mapMode === MEMORY_MAPS.OVERLAP && isMemAccess && ea >= 0x7000 && ea <= 0x7FFF;

  const leds = computeLeds({
    op: deviceMsg.op,
    memAccess: isMemAccess,
    region: deviceMsg.region,
    error: deviceMsg.error,
    hasOverlapConflict,
  });

  const modeNum = typeof deviceMsg.mode === 'number' ? deviceMsg.mode : parseInt(deviceMsg.mode || 0, 10);

  return {
    type: 'decode',
    instr: deviceMsg.instr || '0000',
    op: deviceMsg.op || '—',
    rd: deviceMsg.rd !== undefined ? deviceMsg.rd : 0,
    rs: deviceMsg.rs !== undefined ? deviceMsg.rs : 0,
    mode: modeNum,
    offset: deviceMsg.offset !== undefined ? deviceMsg.offset : 0,
    memAccess: isMemAccess,
    ea,
    region: deviceMsg.region || '',
    map: mapMode,
    error: deviceMsg.error || '',
    // Extended UI helpers
    leds,
    hasOverlapConflict,
    destRegStr: `R${deviceMsg.rd}`,
    srcRegStr: `R${deviceMsg.rs}`,
    modeStr: ADDRESSING_MODES[modeNum]?.name || `Mode ${modeNum}`,
    effectiveAddressHex: isMemAccess ? formatHex16(ea) : 'none',
    effectiveAddressDec: isMemAccess ? formatDecimal(ea) : 'none',
  };
}

/**
 * Strict 11-Point Architectural Conformance Comparison Engine
 * Compares Software JS reference decoder vs Physical ESP32 hardware decoder
 * following DEVICE_GUIDE.md rules without false mismatches from formatting.
 */
export function compareDecoderResults(sw, hw, isHwConnected) {
  if (!sw) return null;

  const isConnected = Boolean(isHwConnected && hw);

  const getSwEa = () => (typeof sw.ea === 'number' ? sw.ea : parseInt(sw.ea || 0, 10));
  const getHwEa = () => (hw ? (typeof hw.ea === 'number' ? hw.ea : parseInt(hw.ea || 0, 10)) : 0);

  const swCleanHex = (sw.instr || '').toUpperCase().padStart(4, '0');
  const hwCleanHex = hw ? (hw.instr || '').toUpperCase().padStart(4, '0') : '';

  const swOp = String(sw.op || '').trim().toUpperCase();
  const hwOp = hw ? String(hw.op || '').trim().toUpperCase() : '';

  const swRd = Number(sw.rd);
  const hwRd = hw ? Number(hw.rd) : 0;

  const swRs = Number(sw.rs);
  const hwRs = hw ? Number(hw.rs) : 0;

  const swMode = Number(sw.mode);
  const hwMode = hw ? Number(hw.mode) : 0;

  const swOffset = Number(sw.offset);
  const hwOffset = hw ? Number(hw.offset) : 0;

  const swMemAccess = Boolean(sw.memAccess);
  const hwMemAccess = hw ? Boolean(hw.memAccess) : false;

  const swRegion = String(sw.region || '').trim().toUpperCase();
  const hwRegion = hw ? String(hw.region || '').trim().toUpperCase() : '';

  const swMap = String(sw.map || 'Default').trim().toLowerCase();
  const hwMap = hw ? String(hw.map || 'Default').trim().toLowerCase() : '';

  const swError = String(sw.error || '').trim().toUpperCase();
  const hwError = hw ? String(hw.error || '').trim().toUpperCase() : '';

  // Effective address match check: if no memory access, both are treated as equal
  const eaMatches = (() => {
    if (!isConnected) return false;
    if (!swMemAccess && !hwMemAccess) return true;
    if (swMemAccess !== hwMemAccess) return false;
    return getSwEa() === getHwEa();
  })();

  const fields = [
    {
      id: 'instruction',
      label: 'Instruction Word',
      description: '16-bit binary machine instruction in hexadecimal',
      swValue: `0x${swCleanHex}`,
      hwValue: isConnected ? `0x${hwCleanHex}` : '—',
      matches: isConnected ? swCleanHex === hwCleanHex : null,
    },
    {
      id: 'opcode',
      label: 'Opcode Mnemonic',
      description: 'Decoded instruction operation (LOAD, STORE, ADD, SUB)',
      swValue: swOp || 'INVALID',
      hwValue: isConnected ? (hwOp || 'INVALID') : '—',
      matches: isConnected ? swOp === hwOp : null,
    },
    {
      id: 'destReg',
      label: 'Destination Register',
      description: 'Target accumulator register Rd (R0–R7)',
      swValue: `R${swRd}`,
      hwValue: isConnected ? `R${hwRd}` : '—',
      matches: isConnected ? swRd === hwRd : null,
    },
    {
      id: 'srcReg',
      label: 'Source Register',
      description: 'Base address register Rs (R0–R7)',
      swValue: `R${swRs}`,
      hwValue: isConnected ? `R${hwRs}` : '—',
      matches: isConnected ? swRs === hwRs : null,
    },
    {
      id: 'addressingMode',
      label: 'Addressing Mode',
      description: 'Mode 0: Imm, Mode 1: Direct, Mode 2: Reg Ind, Mode 3: Indexed',
      swValue: `${sw.modeStr || `Mode ${swMode}`} (${swMode})`,
      hwValue: isConnected ? `${hw.modeStr || `Mode ${hwMode}`} (${hwMode})` : '—',
      matches: isConnected ? swMode === hwMode : null,
    },
    {
      id: 'offset',
      label: 'Offset Displacement',
      description: '4-bit displacement field (0–15)',
      swValue: `0x${swOffset.toString(16).toUpperCase()} (${swOffset} dec)`,
      hwValue: isConnected ? `0x${hwOffset.toString(16).toUpperCase()} (${hwOffset} dec)` : '—',
      matches: isConnected ? swOffset === hwOffset : null,
    },
    {
      id: 'memoryAccess',
      label: 'Memory Access',
      description: 'Whether instruction activates the bus (True) or ALU only (False)',
      swValue: swMemAccess ? 'TRUE (Bus Active)' : 'FALSE (Immediate)',
      hwValue: isConnected ? (hwMemAccess ? 'TRUE (Bus Active)' : 'FALSE (Immediate)') : '—',
      matches: isConnected ? swMemAccess === hwMemAccess : null,
    },
    {
      id: 'effectiveAddress',
      label: 'Effective Address',
      description: 'Calculated memory location EA = Base(Rs) + Offset',
      swValue: swMemAccess ? `${sw.effectiveAddressHex} (${getSwEa()} dec)` : 'none (0x0000)',
      hwValue: isConnected
        ? (hwMemAccess ? `${hw.effectiveAddressHex} (${getHwEa()} dec)` : 'none (0x0000)')
        : '—',
      matches: isConnected ? eaMatches : null,
    },
    {
      id: 'memoryRegion',
      label: 'Memory Region',
      description: 'ROM (0x0000-0x3FFF), RAM (0x4000-0x7FFF), I/O (0x8000-0x9FFF)',
      swValue: swRegion || 'None / Unmapped',
      hwValue: isConnected ? (hwRegion || 'None / Unmapped') : '—',
      matches: isConnected ? swRegion === hwRegion : null,
    },
    {
      id: 'memoryMap',
      label: 'Memory Map',
      description: 'Default (Standard Linear) or Overlap (0x7000–0x7FFF)',
      swValue: swMap.charAt(0).toUpperCase() + swMap.slice(1),
      hwValue: isConnected ? (hwMap.charAt(0).toUpperCase() + hwMap.slice(1)) : '—',
      matches: isConnected ? swMap === hwMap : null,
    },
    {
      id: 'error',
      label: 'Error Status',
      description: 'Hierarchical architectural violation detection (Section 6)',
      swValue: swError || 'NONE (0x00 Valid)',
      hwValue: isConnected ? (hwError || 'NONE (0x00 Valid)') : '—',
      matches: isConnected ? swError === hwError : null,
    },
  ];

  if (!isConnected) {
    return {
      status: 'UNAVAILABLE',
      isMatch: null,
      title: 'Hardware Comparison Unavailable',
      subtitle: 'ESP32 device is currently disconnected. Connect via Web Serial or simulator to benchmark hardware execution.',
      matchedCount: 0,
      totalCount: fields.length,
      fields,
      differences: [],
    };
  }

  const differences = fields.filter((f) => f.matches === false);
  const isMatch = differences.length === 0;

  return {
    status: isMatch ? 'MATCH' : 'MISMATCH',
    isMatch,
    title: isMatch ? 'Hardware and Software Match' : 'Decoder Mismatch',
    subtitle: isMatch
      ? 'All 11 architectural fields match perfectly between physical ESP32 silicon and JavaScript decoder model.'
      : `Discrepancy detected in ${differences.length} field(s): ${differences.map((d) => d.label).join(', ')}.`,
    matchedCount: fields.length - differences.length,
    totalCount: fields.length,
    fields,
    differences,
  };
}
