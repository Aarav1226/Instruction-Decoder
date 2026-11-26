import './HardwareDecoder.css';

export default function HardwareActivityLog({ logs, onClear }) {
  return (
    <section className="hw-card hw-log-panel" aria-label="Hardware Activity Log">
      <div className="hw-card-header">
        <div>
          <span className="hw-eyebrow">Event Stream</span>
          <h3>Hardware Activity Log</h3>
        </div>
        <button
          type="button"
          className="hw-btn hw-btn-ghost"
          onClick={onClear}
          disabled={logs.length === 0}
        >
          Clear
        </button>
      </div>

      {logs.length === 0 ? (
        <p className="hw-log-empty">No hardware events recorded yet.</p>
      ) : (
        <ul className="hw-log-list">
          {logs.map((entry) => (
            <li key={entry.id} className={`hw-log-item log-${entry.type}`}>
              <span className="hw-log-time hw-mono">{entry.time}</span>
              <span className={`hw-log-badge type-${entry.type}`}>
                {entry.type.toUpperCase()}
              </span>
              <span className="hw-log-msg">{entry.message}</span>
            </li>
          ))}
        </ul>
      )}

      {/* Hardware-specific event counters */}
      {logs.length > 0 && (
        <div className="hw-event-counters">
          <div className="hw-counter-item">
            <span className="hw-counter-label">Connections</span>
            <span className="hw-counter-value hw-mono">
              {logs.filter((l) => l.type === 'connection').length}
            </span>
          </div>
          <div className="hw-counter-item">
            <span className="hw-counter-label">Decodes</span>
            <span className="hw-counter-value hw-mono">
              {logs.filter((l) => l.type === 'decode').length}
            </span>
          </div>
          <div className="hw-counter-item">
            <span className="hw-counter-label">Map Changes</span>
            <span className="hw-counter-value hw-mono">
              {logs.filter((l) => l.type === 'map').length}
            </span>
          </div>
          <div className="hw-counter-item">
            <span className="hw-counter-label">Errors</span>
            <span className="hw-counter-value hw-mono">
              {logs.filter((l) => l.type === 'error').length}
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
