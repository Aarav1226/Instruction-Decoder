import { BIT_FIELDS, hexToBinary16 } from './hardwareUtils';
import './HardwareDecoder.css';

export default function InstructionInputPanel({
  hexInput = '',
  onHexChange,
  onDecode,
  isWaitingReady = false,
  isReady = false,
}) {
  const binary16 = hexToBinary16(hexInput);
  const isValidHex = /^[0-9a-fA-F]{4}$/.test(hexInput.trim());

  const groupedFields = BIT_FIELDS.reduce(
    (acc, field) => {
      const slice = binary16.slice(acc.offset, acc.offset + field.bits).split('');
      return {
        offset: acc.offset + field.bits,
        groups: [...acc.groups, { ...field, bitsArray: slice }],
      };
    },
    { offset: 0, groups: [] }
  ).groups;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (isValidHex && !isWaitingReady) {
      onDecode();
    }
  };

  const decodeBtnLabel = isWaitingReady
    ? 'Waiting for device...'
    : isReady
      ? 'Decode on ESP32'
      : 'Decode (Software Preview)';

  return (
    <section className="hw-card hw-input-panel" aria-label="Instruction Input">
      <div className="hw-card-header">
        <div>
          <span className="hw-eyebrow">16-Bit Machine Word</span>
          <h3>Instruction Input</h3>
        </div>
        <div className="hw-input-header-badges">
          {isReady && (
            <span className="hw-pill hw-pill-ok" title="Hardware link active">
              ESP32 Ready
            </span>
          )}
          <span className="hw-mono hw-hex-preview">
            0x{hexInput.toUpperCase().padEnd(4, '_')}
          </span>
        </div>
      </div>

      <form className="hw-input-form" onSubmit={handleSubmit}>
        <label className="hw-input-label" htmlFor="hw-hex-input">
          4-Digit Hexadecimal Instruction
        </label>
        <div className="hw-input-row">
          <div className="hw-hex-input-wrap">
            <span className="hw-hex-prefix" aria-hidden="true">
              0x
            </span>
            <input
              id="hw-hex-input"
              type="text"
              maxLength={4}
              value={hexInput}
              onChange={(e) =>
                onHexChange(e.target.value.replace(/[^0-9a-fA-F]/g, '').toUpperCase())
              }
              placeholder="1A73"
              className="hw-hex-input hw-mono"
              spellCheck={false}
              autoComplete="off"
            />
          </div>
          <button
            type="submit"
            className={`hw-btn ${isReady ? 'hw-btn-primary' : 'hw-btn-secondary'}`}
            disabled={!isValidHex || isWaitingReady}
            title={decodeBtnLabel}
          >
            {isWaitingReady ? 'Waiting...' : isReady ? 'Send to ESP32' : 'Decode'}
          </button>
        </div>
      </form>

      <div className="hw-bit-groups" aria-label="16-bit instruction breakdown">
        {groupedFields.map((group) => (
          <div key={group.key} className={`hw-bit-group ${group.colorClass}`}>
            <div className="hw-bit-group-header">
              <span className="hw-bit-group-label">{group.label}</span>
              <span className="hw-bit-group-count">{group.bits}b</span>
            </div>
            <div className="hw-bits-row">
              {group.bitsArray.map((bit, idx) => (
                <span key={idx} className={`hw-bit-cell hw-mono ${bit === '1' ? 'is-one' : ''}`}>
                  {bit}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="hw-input-actions">
        <button
          type="button"
          className={`hw-btn ${isReady ? 'hw-btn-primary' : 'hw-btn-secondary'}`}
          onClick={handleSubmit}
          disabled={!isValidHex || isWaitingReady}
        >
          {decodeBtnLabel}
        </button>
      </div>
    </section>
  );
}
