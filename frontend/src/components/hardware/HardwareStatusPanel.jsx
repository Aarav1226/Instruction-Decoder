import { CONNECTION_STATES, LED_INDICATORS } from './hardwareUtils';
import './HardwareDecoder.css';

export default function HardwareStatusPanel({ connectionState, activeLeds, activeLed }) {
  const isConnected = connectionState === CONNECTION_STATES.CONNECTED;
  const isError = connectionState === CONNECTION_STATES.ERROR;

  // Supports both multi-LED object { blue, green, yellow, white, red } and legacy string
  const ledsState = typeof activeLeds === 'object' && activeLeds !== null
    ? activeLeds
    : {
        blue: activeLed === 'blue',
        green: activeLed === 'green',
        yellow: activeLed === 'yellow',
        white: activeLed === 'white',
        red: activeLed === 'error' || activeLed === 'red',
      };

  const hasAnyError = Boolean(ledsState.red || isError);

  return (
    <section className="hw-card hw-status-panel" aria-label="Hardware Status">
      <div className="hw-card-header">
        <div>
          <span className="hw-eyebrow">Physical Board Telemetry</span>
          <h3>Hardware Status</h3>
        </div>
        <span className={`hw-board-chip ${isConnected ? 'is-online' : ''} ${hasAnyError ? 'is-error' : ''}`}>
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
            const isActive = Boolean(ledsState[led.key]);
            return (
              <div
                key={led.key}
                className={`hw-led-item ${isActive ? 'is-active' : 'is-dim'} ${ledsState.red && led.key === 'red' ? 'is-error-pulse' : ''}`}
              >
                <span
                  className={`hw-led-bulb led-${led.key} ${isActive ? 'is-lit' : ''}`}
                  aria-label={`${led.label} ${isActive ? 'active' : 'inactive'}`}
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

      {hasAnyError && (
        <div className="hw-error-indicator" role="alert">
          <span className="hw-error-dot" aria-hidden="true" />
          <span>Device architectural error detected</span>
        </div>
      )}
    </section>
  );
}
