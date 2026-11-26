export default function DecodedInstructionPanel({ decoded }) {
  const fields = [
    { label: 'Opcode', value: decoded.opcode, highlight: 'field-opcode' },
    { label: 'Destination Register', value: decoded.destReg, highlight: 'field-dest' },
    { label: 'Source Register', value: decoded.srcReg, highlight: 'field-src' },
    { label: 'Addressing Mode', value: decoded.addrMode, highlight: 'field-mode' },
    { label: 'Offset', value: decoded.offset, highlight: 'field-offset' },
    { label: 'Effective Address', value: decoded.effectiveAddress },
    { label: 'Memory Region', value: decoded.memoryRegion },
    { label: 'Access Type', value: decoded.accessType },
    {
      label: 'Error Status',
      value: decoded.errorStatus,
      isError: decoded.errorStatus !== 'OK',
    },
  ];

  return (
    <section className="hw-card hw-decoded-panel" aria-label="Decoded Instruction">
      <div className="hw-card-header">
        <div>
          <span className="hw-eyebrow">Control Unit Output</span>
          <h3>Decoded Instruction</h3>
        </div>
        <span
          className={`hw-pill ${
            decoded.errorStatus === 'OK' ? 'hw-pill-ok' : 'hw-pill-error'
          }`}
        >
          {decoded.errorStatus === 'OK' ? 'Valid' : 'Fault'}
        </span>
      </div>

      <dl className="hw-decoded-grid">
        {fields.map((item) => (
          <div
            key={item.label}
            className={`hw-decoded-item ${item.highlight || ''} ${
              item.isError ? 'is-error' : ''
            }`}
          >
            <dt>{item.label}</dt>
            <dd className="hw-mono">{item.value}</dd>
          </div>
        ))}
      </dl>

      {/* Overlap conflict alert banner */}
      {decoded.hasOverlapConflict && (
        <div className="hw-overlay-notice">
          <span className="hw-overlay-icon" aria-hidden="true">⚠️</span>
          <span className="hw-overlay-text">
            Overlap conflict detected — address spans multiple memory regions simultaneously
          </span>
        </div>
      )}
    </section>
  );
}
