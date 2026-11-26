import { MEMORY_MAPS } from './hardwareUtils';
import MemoryMapVisualization from './MemoryMapVisualization';
import './HardwareDecoder.css';

/**
 * HardwareMemoryMap wrapper card
 * Provides the interactive controls (Default vs Overlap toggle)
 * and hosts the reusable proportional MemoryMapVisualization.
 */
export default function HardwareMemoryMap({
  mapMode = MEMORY_MAPS.DEFAULT,
  onMapChange,
  addressValue = null,
  hasOverlapConflict = false,
}) {
  return (
    <section className="hw-card hw-memory-map-panel" aria-label="Hardware Memory Map">
      <div className="hw-card-header">
        <div>
          <span className="hw-eyebrow">16-Bit Architecture Address Space (0x0000–0xFFFF)</span>
          <h3>Hardware Memory Map</h3>
        </div>

        <div className="hw-map-toggle-group">
          <span className="hw-toggle-label">Map Mode:</span>
          <div className="hw-map-toggle" role="group" aria-label="Memory Map Mode">
            <button
              type="button"
              className={`hw-toggle-btn ${
                mapMode === MEMORY_MAPS.DEFAULT ? 'is-active' : ''
              }`}
              onClick={() => onMapChange(MEMORY_MAPS.DEFAULT)}
              aria-pressed={mapMode === MEMORY_MAPS.DEFAULT}
            >
              Default Map
            </button>
            <button
              type="button"
              className={`hw-toggle-btn ${
                mapMode === MEMORY_MAPS.OVERLAP ? 'is-active' : ''
              }`}
              onClick={() => onMapChange(MEMORY_MAPS.OVERLAP)}
              aria-pressed={mapMode === MEMORY_MAPS.OVERLAP}
            >
              Overlap Map
            </button>
          </div>
        </div>
      </div>

      <MemoryMapVisualization
        mapMode={mapMode}
        addressValue={addressValue}
        hasOverlapConflict={hasOverlapConflict}
        showSummary={true}
      />
    </section>
  );
}
