import { CONNECTION_STATES, LED_INDICATORS } from './hardwareUtils';
import './HardwareDecoder.css';

export default function HardwareStatusPanel({ connectionState, activeLed }) {
  const isConnected = connectionState === CONNECTION_STATES.CONNECTED;
  const isError = connectionState === CONNECTION_STATES.ERROR;

  return (
    <section className="hw-card hw-status-panel" aria-label="Hardware Status">
      <div className="hw-card-header">
        <div>
          <span className="hw-eyebrow">Physical Board Telemetry</span>
          <h3>Hardware Status</h3>
        </div>
        <span className={`hw-board-chip ${isConnected ? 'is-online' : ''} ${isError ? 'is-error' : ''}`}>
          ESP32-WROOM
        </span>
      </div>

      <div className="hw-board-visual">
        <div className="hw-board-silkscreen">
          <span>GPIO / DECODER BUS</span>
          <span className="hw-mono">{isConnected ? 'LINK: ACTIVE' : 'LINK: STANDBY'}</span>
        </div>

        <div className="hw-led-grid">
          {LED_INDICATORS.map((led) => {
            const isActive = activeLed === led.key;
            const isErrorLed = activeLed === 'error';
            return (
              <div
                key={led.key}
                className={`hw-led-item ${isActive ? 'is-active' : 'is-dim'} ${isErrorLed && led.key !== 'error' ? 'is-error-pulse' : ''}`}
              >
                <span
                  className={`hw-led-bulb led-${led.color} ${isActive ? 'is-lit' : ''} ${isErrorLed && led.key !== 'error' ? 'is-error' : ''}`}
                  aria-label={`${led.label} LED ${isActive ? 'active' : 'inactive'}`}
                />
                <div className="hw-led-text">
                  <span className="hw-led-label">{led.label}</span>
                  <span className="hw-led-desc">{led.description}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {isError && (
        <div className="hw-error-indicator" role="alert">
          <span className="hw-error-dot" aria-hidden="true" />
          <span>Device error state detected</span>
        </div>
      )}
    </section>
  );
}
