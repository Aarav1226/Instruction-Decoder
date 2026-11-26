import { CONNECTION_STATES } from './hardwareUtils';
import './HardwareDecoder.css';

/* ── ConnectionPanel ────────────────────────────────────────────────────── */

export default function ConnectionPanel({
  connectionState = CONNECTION_STATES.DISCONNECTED,
  isWaitingReady = false,
  onConnectToggle,
}) {
  const isConnected = connectionState === CONNECTION_STATES.CONNECTED;
  const isConnecting = connectionState === CONNECTION_STATES.CONNECTING;
  const isError = connectionState === CONNECTION_STATES.ERROR;
  const badgeClass = `hw-status-badge status-${connectionState.toLowerCase()}`;

  return (
    <section className="hw-card hw-connection-panel" aria-label="Hardware Connection">
      <div className="hw-card-header">
        <div>
          <span className="hw-eyebrow">USB Serial Interface</span>
          <h3>Hardware Connection</h3>
        </div>
        <span className={badgeClass}>
          <span className="hw-badge-dot" aria-hidden="true" />
          {isWaitingReady ? 'Waiting for Ready' : connectionState}
        </span>
      </div>

      <div className="hw-connection-meta">
        <div className="hw-meta-item">
          <span className="hw-meta-label">Device Type</span>
          <span className="hw-meta-value">ESP32 Instruction Decoder</span>
        </div>
        <div className="hw-meta-item">
          <span className="hw-meta-label">Serial Config</span>
          <span className="hw-meta-value hw-mono">USB Serial · 115200 baud</span>
        </div>
        <div className="hw-meta-item">
          <span className="hw-meta-label">Protocol</span>
          <span className="hw-meta-value hw-mono">JSON Line Stream (JSON:...)</span>
        </div>
        <div className="hw-meta-item">
          <span className="hw-meta-label">Hardware State</span>
          <span className="hw-meta-value">
            {isConnected
              ? 'Online & Ready'
              : isWaitingReady
                ? 'Awaiting Boot Handshake'
                : isError
                  ? 'Connection Error'
                  : 'Idle / Disconnected'}
          </span>
        </div>
      </div>

      {isWaitingReady && (
        <div className="hw-ready-banner" role="status">
          <span className="hw-pulse-dot" aria-hidden="true" />
          <span>Port opened at 115200 baud. Waiting for ESP32 ready handshake...</span>
        </div>
      )}

      <div className="hw-connection-actions">
        <button
          type="button"
          className={`hw-btn ${
            isConnected
              ? 'hw-btn-secondary'
              : isError
                ? 'hw-btn-error'
                : isWaitingReady
                  ? 'hw-btn-secondary'
                  : 'hw-btn-primary'
          }`}
          onClick={onConnectToggle}
          disabled={isConnecting && !isWaitingReady}
        >
          {isWaitingReady
            ? 'Cancel Connection'
            : isConnecting
              ? 'Connecting...'
              : isError
                ? 'Error — Retry Connection'
                : isConnected
                  ? 'Disconnect USB Device'
                  : 'Connect USB Device'}
        </button>
        <p className="hw-browser-note">
          Requires <strong>Google Chrome</strong> or <strong>Microsoft Edge</strong> (desktop) with{' '}
          <code>Web Serial API</code> enabled. Ensure the Arduino Serial Monitor is closed before connecting.
        </p>
      </div>
    </section>
  );
}
