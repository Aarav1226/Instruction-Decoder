export const CONNECTION_STATES = {
  DISCONNECTED: 'Disconnected',
  CONNECTING: 'Connecting',
  CONNECTED: 'Connected',
  ERROR: 'Error',
};

export const MEMORY_MAPS = {
  DEFAULT: 'default',
  OVERLAP: 'overlap',
};

export const BIT_FIELDS = [
  { key: 'opcode', label: 'Opcode', bits: 4, colorClass: 'field-opcode' },
  { key: 'dest', label: 'Dest Reg', bits: 3, colorClass: 'field-dest' },
  { key: 'src', label: 'Src Reg', bits: 3, colorClass: 'field-src' },
  { key: 'mode', label: 'Addr Mode', bits: 2, colorClass: 'field-mode' },
  { key: 'offset', label: 'Offset', bits: 4, colorClass: 'field-offset' },
];

export const LED_INDICATORS = [
  { key: 'rom', label: 'ROM', color: 'blue', description: 'ROM Access' },
  { key: 'ram', label: 'RAM', color: 'green', description: 'RAM Access' },
  { key: 'io', label: 'I/O', color: 'yellow', description: 'I/O Access' },
  {
    key: 'immediate',
    label: 'Immediate / No Mem',
    color: 'white',
    description: 'Immediate mode / no memory access',
  },
  { key: 'error', label: 'Error', color: 'red', description: 'Decode or bus error' },
];

export const MEMORY_REGIONS = {
  [MEMORY_MAPS.DEFAULT]: [
    {
      id: 'rom',
      name: 'ROM',
      start: 0x0000,
      end: 0x3FFF,
      color: 'blue',
      permissions: 'Read only',
      description: 'Program code & firmware constants',
    },
    {
      id: 'ram',
      name: 'RAM',
      start: 0x4000,
      end: 0x7FFF,
      color: 'green',
      permissions: 'Read / Write',
      description: 'System memory, stack & heap data',
    },
    {
      id: 'io',
      name: 'I/O',
      start: 0x8000,
      end: 0x9FFF,
      color: 'yellow',
      permissions: 'Read / Write',
      description: 'Peripherals, timers & bus controllers',
    },
    {
      id: 'unmapped',
      name: 'Unmapped',
      start: 0xA000,
      end: 0xFFFF,
      color: 'muted',
      permissions: 'None (Bus fault)',
      description: 'Reserved / unmapped address space',
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
      description: 'Program code & firmware constants',
    },
    {
      id: 'ram',
      name: 'RAM',
      start: 0x4000,
      end: 0x7FFF,
      color: 'green',
      permissions: 'Read / Write',
      description: 'System memory (overlaps I/O from 0x7000 to 0x7FFF)',
      hasOverlapZone: true,
      overlapStart: 0x7000,
      overlapEnd: 0x7FFF,
    },
    {
      id: 'io',
      name: 'I/O',
      start: 0x7000,
      end: 0x9FFF,
      color: 'yellow',
      permissions: 'Read / Write',
      description: 'Peripherals & I/O (overlaps RAM from 0x7000 to 0x7FFF)',
      hasOverlapZone: true,
      overlapStart: 0x7000,
      overlapEnd: 0x7FFF,
    },
    {
      id: 'unmapped',
      name: 'Unmapped',
      start: 0xA000,
      end: 0xFFFF,
      color: 'muted',
      permissions: 'None (Bus fault)',
      description: 'Reserved / unmapped address space',
    },
  ],
};

const OPCODE_NAMES = {
  0x0: 'NOP',
  0x1: 'LOAD',
  0x2: 'STORE',
  0x3: 'ADD',
  0x4: 'SUB',
  0x5: 'MOV',
  0x6: 'JMP',
  0x7: 'JZ',
};

const MODE_NAMES = {
  0b00: 'Immediate',
  0b01: 'Direct',
  0b10: 'Register Indirect',
  0b11: 'Indexed',
};

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

export function decodeInstructionUI(hexInput, mapMode) {
  const clean = hexInput.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
  if (clean.length !== 4) {
    return {
      opcode: '—',
      destReg: '—',
      srcReg: '—',
      addrMode: '—',
      offset: '—',
      effectiveAddress: '—',
      effectiveAddressDecimal: '—',
      memoryRegion: 'None',
      accessType: 'None',
      errorStatus: 'Invalid 4-digit hex instruction',
      activeLed: 'error',
      addressValue: null,
      hasOverlapConflict: false,
    };
  }

  const value = parseInt(clean, 16);
  const opcodeVal = (value >> 12) & 0xf;
  const destVal = (value >> 9) & 0x7;
  const srcVal = (value >> 6) & 0x7;
  const modeVal = (value >> 4) & 0x3;
  const offsetVal = value & 0xf;

  const isImmediate = modeVal === 0b00;

  // In this 16-bit architecture with offset and registers:
  // - Direct Mode (01): Effective address derived from address field (srcReg (3b) + offset (4b)) scaled across 16-bit address space,
  //   or when offset is specified, maps into memory slots.
  //   Specifically: (srcVal << 13) | (offsetVal << 9) provides coverage across 0x0000 - 0xFFFF:
  //   srcVal=0..1 -> 0x0000..0x3FFF (ROM)
  //   srcVal=2..3 -> 0x4000..0x7FFF (RAM)
  //   srcVal=4    -> 0x8000..0x9FFF (I/O)
  //   srcVal=5..7 -> 0xA000..0xFFFF (Unmapped)
  //   When offset is 0xF and srcVal=3, in overlap map this maps to 0x7E00 (inside 0x7000-0x7FFF RAM/IO overlap).
  let effectiveAddr = null;
  if (!isImmediate) {
    if (modeVal === 0b01) {
      // Direct Addressing Mode
      effectiveAddr = ((srcVal * 0x2000) + (offsetVal * 0x200)) & 0xffff;
    } else if (modeVal === 0b10) {
      // Register Indirect Mode
      effectiveAddr = ((srcVal * 0x2000) + (offsetVal * 0x100)) & 0xffff;
    } else {
      // Indexed Mode
      effectiveAddr = ((srcVal * 0x2000) + (offsetVal * 0x400)) & 0xffff;
    }
  }

  let memoryRegion = 'No Memory Access';
  let activeLed = 'immediate';
  let errorStatus = 'OK';
  let hasOverlapConflict = false;

  if (!isImmediate && effectiveAddr !== null) {
    const regions = MEMORY_REGIONS[mapMode];
    const matching = regions.filter(
      (r) => effectiveAddr >= r.start && effectiveAddr <= r.end
    );

    if (matching.length > 1) {
      hasOverlapConflict = true;
      memoryRegion = matching.map((r) => r.name).join(' / ') + ' (Overlap Conflict)';
      activeLed = 'error';
      errorStatus = `OVERLAP CONFLICT: Address 0x${effectiveAddr.toString(16).toUpperCase().padStart(4, '0')} falls inside overlapping [${matching.map((r) => r.name).join(', ')}]`;
    } else if (matching.length === 1) {
      const region = matching[0];
      memoryRegion = region.name;
      if (region.id === 'unmapped') {
        activeLed = 'error';
        errorStatus = 'Unmapped memory space accessed (0xA000–0xFFFF)';
      } else {
        activeLed = region.id;
      }
    }
  }

  return {
    opcode: `0x${opcodeVal.toString(16).toUpperCase()} (${OPCODE_NAMES[opcodeVal] || 'OP'})`,
    destReg: `R${destVal}`,
    srcReg: `R${srcVal}`,
    addrMode: `${modeVal.toString(2).padStart(2, '0')} (${MODE_NAMES[modeVal]})`,
    offset: `0x${offsetVal.toString(16).toUpperCase()} (${offsetVal})`,
    effectiveAddress:
      effectiveAddr === null
        ? 'N/A (Immediate)'
        : `0x${effectiveAddr.toString(16).toUpperCase().padStart(4, '0')}`,
    effectiveAddressDecimal:
      effectiveAddr === null ? 'N/A' : effectiveAddr.toString(10),
    memoryRegion,
    accessType: isImmediate ? 'Immediate / None' : opcodeVal === 0x2 ? 'Write' : 'Read',
    errorStatus,
    activeLed,
    addressValue: effectiveAddr,
    hasOverlapConflict,
  };
}
