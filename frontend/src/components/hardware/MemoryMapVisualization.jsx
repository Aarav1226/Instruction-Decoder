import { MEMORY_MAPS, MEMORY_REGIONS, formatHex16, formatDecimal } from './hardwareUtils';
import './MemoryMapVisualization.css';

const TOTAL_ADDRESS_SPACE = 0x10000; // 65,536 bytes (0x0000 - 0xFFFF)

/**
 * Reusable Memory Map Address Visualizer
 * Accurately renders address ranges proportional to actual 16-bit address space (0x0000 - 0xFFFF).
 * Supports default linear mapping and overlap mapping with visual conflict states and animated EA pointers.
 */
export default function MemoryMapVisualization({
  mapMode = MEMORY_MAPS.DEFAULT,
  addressValue = null,
  hasOverlapConflict = false,
  highlightedRegionId = null,
  showSummary = true,
  className = '',
}) {
  const regions = MEMORY_REGIONS[mapMode] || MEMORY_REGIONS[MEMORY_MAPS.DEFAULT];

  // Calculate pointer percentage accurately based on 0x0000 - 0xFFFF space
  const pointerPercent =
    addressValue !== null && !Number.isNaN(addressValue)
      ? Math.min(Math.max((addressValue / (TOTAL_ADDRESS_SPACE - 1)) * 100, 0), 100)
      : null;

  const isOverlapMode = mapMode === MEMORY_MAPS.OVERLAP;

  // Active accessed region(s)
  const activeRegions =
    addressValue !== null
      ? regions.filter((r) => addressValue >= r.start && addressValue <= r.end)
      : [];

  return (
    <div
      className={`mm-visualizer ${isOverlapMode ? 'is-overlap-mode' : ''} ${className}`}
      role="region"
      aria-label="Hardware Memory Map Visualization"
    >
      {/* Address Telemetry Bar */}
      {showSummary && (
        <div className="mm-telemetry-bar">
          <div className="mm-telemetry-item">
            <span className="mm-telemetry-label">Effective Address</span>
            <span className="mm-telemetry-value mm-mono">
              {addressValue !== null ? (
                <>
                  <strong className="mm-hex-value">{formatHex16(addressValue)}</strong>
                  <span className="mm-dec-value">({formatDecimal(addressValue)} dec)</span>
                </>
              ) : (
                <span className="mm-muted">Immediate / None</span>
              )}
            </span>
          </div>

          <div className="mm-telemetry-item">
            <span className="mm-telemetry-label">Target Region</span>
            <span className="mm-telemetry-value">
              {hasOverlapConflict ? (
                <span className="mm-badge-conflict">
                  <span className="mm-conflict-icon" aria-hidden="true">⚠️</span>
                  OVERLAP CONFLICT
                </span>
              ) : activeRegions.length > 0 ? (
                <span className={`mm-badge-region mm-region-${activeRegions[0].color}`}>
                  {activeRegions[0].name} ({activeRegions[0].permissions})
                </span>
              ) : (
                <span className="mm-muted">None (Immediate)</span>
              )}
            </span>
          </div>

          <div className="mm-telemetry-item">
            <span className="mm-telemetry-label">Map Mode</span>
            <span className="mm-telemetry-value">
              <span className={`mm-map-chip ${isOverlapMode ? 'is-overlap' : 'is-default'}`}>
                {isOverlapMode ? 'Overlap Map (0x7000–0x7FFF Conflict)' : 'Default Linear Map'}
              </span>
            </span>
          </div>
        </div>
      )}

      {/* Overlap Conflict Notice Banner */}
      {isOverlapMode && (
        <div
          className={`mm-overlap-banner ${hasOverlapConflict ? 'is-triggered' : 'is-info'}`}
          role={hasOverlapConflict ? 'alert' : 'status'}
        >
          <div className="mm-banner-header">
            <span className="mm-banner-icon" aria-hidden="true">
              {hasOverlapConflict ? '🚨' : 'ℹ️'}
            </span>
            <span className="mm-banner-title">
              {hasOverlapConflict
                ? 'OVERLAP CONFLICT DETECTED'
                : 'OVERLAP ARCHITECTURE ACTIVE'}
            </span>
          </div>
          <p className="mm-banner-body">
            {hasOverlapConflict ? (
              <>
                Address <strong className="mm-mono">{formatHex16(addressValue)}</strong> falls inside the overlapping range{' '}
                <strong className="mm-mono">0x7000 – 0x7FFF</strong> simultaneously decoded by{' '}
                <strong>RAM</strong> and <strong>I/O</strong> controllers.
              </>
            ) : (
              <>
                RAM (<span className="mm-mono">0x4000–0x7FFF</span>) and I/O (
                <span className="mm-mono">0x7000–0x9FFF</span>) intentionally overlap from{' '}
                <strong className="mm-mono">0x7000</strong> to <strong className="mm-mono">0x7FFF</strong> (4,096 bytes).
              </>
            )}
          </p>
        </div>
      )}

      {/* Main Memory Bar Graphic */}
      <div className="mm-track-container">
        {/* Scale indicators above track */}
        <div className="mm-scale-markers" aria-hidden="true">
          <span className="mm-scale-tick" style={{ left: '0%' }}>0x0000</span>
          <span className="mm-scale-tick" style={{ left: '25%' }}>0x4000</span>
          <span className="mm-scale-tick" style={{ left: `${(0x7000 / TOTAL_ADDRESS_SPACE) * 100}%` }}>
            {isOverlapMode ? '0x7000' : ''}
          </span>
          <span className="mm-scale-tick" style={{ left: '50%' }}>0x8000</span>
          <span className="mm-scale-tick" style={{ left: `${(0xA000 / TOTAL_ADDRESS_SPACE) * 100}%` }}>0xA000</span>
          <span className="mm-scale-tick" style={{ left: '100%', transform: 'translateX(-100%)' }}>0xFFFF</span>
        </div>

        {/* Proportional Memory Track */}
        <div className="mm-track">
          {regions.map((region) => {
            const leftPct = (region.start / TOTAL_ADDRESS_SPACE) * 100;
            const widthPct = ((region.end - region.start + 1) / TOTAL_ADDRESS_SPACE) * 100;
            const isTargeted =
              (highlightedRegionId === region.id) ||
              (addressValue !== null && addressValue >= region.start && addressValue <= region.end);

            return (
              <div
                key={region.id}
                className={`mm-region-block mm-color-${region.color} ${
                  isTargeted ? 'is-targeted' : ''
                } ${region.hasOverlapZone ? 'has-overlap-zone' : ''}`}
                style={{
                  left: `${leftPct}%`,
                  width: `${widthPct}%`,
                }}
                title={`${region.name}: ${formatHex16(region.start)} – ${formatHex16(region.end)} (${region.permissions})`}
              >
                <div className="mm-region-inner">
                  <span className="mm-region-name">{region.name}</span>
                  <span className="mm-region-bounds mm-mono">
                    {formatHex16(region.start)}–{formatHex16(region.end)}
                  </span>
                  <span className="mm-region-perm">{region.permissions}</span>
                </div>
              </div>
            );
          })}

          {/* Overlap Zone Visual Layer on the bar when in Overlap Mode */}
          {isOverlapMode && (
            <div
              className={`mm-overlap-slice ${hasOverlapConflict ? 'is-conflict' : ''}`}
              style={{
                left: `${(0x7000 / TOTAL_ADDRESS_SPACE) * 100}%`,
                width: `${(0x1000 / TOTAL_ADDRESS_SPACE) * 100}%`,
              }}
              title="Overlap Zone: RAM (0x4000-0x7FFF) and I/O (0x7000-0x9FFF) overlap between 0x7000 and 0x7FFF"
            >
              <div className="mm-overlap-badge">
                <span className="mm-overlap-badge-text">OVERLAP (0x7000–0x7FFF)</span>
              </div>
            </div>
          )}

          {/* Animated Effective Address Pointer */}
          {pointerPercent !== null && (
            <div
              className={`mm-ea-pointer ${hasOverlapConflict ? 'is-conflict' : ''}`}
              style={{ left: `${pointerPercent}%` }}
              aria-label={`Effective address indicator at ${formatHex16(addressValue)}`}
            >
              <div className="mm-ea-badge">
                <span className="mm-ea-badge-hex mm-mono">{formatHex16(addressValue)}</span>
                <span className="mm-ea-badge-dec mm-mono">{formatDecimal(addressValue)}</span>
              </div>
              <div className="mm-ea-needle" />
              <div className="mm-ea-dot" />
            </div>
          )}
        </div>
      </div>

      {/* Region Details / Legend Cards */}
      <div className="mm-legend-grid">
        {regions.map((region) => {
          const isTargeted =
            (highlightedRegionId === region.id) ||
            (addressValue !== null && addressValue >= region.start && addressValue <= region.end);

          const totalBytes = region.end - region.start + 1;
          const kbSize = (totalBytes / 1024).toFixed(0);

          return (
            <div
              key={region.id}
              className={`mm-legend-card mm-border-${region.color} ${
                isTargeted ? 'is-active-card' : ''
              }`}
            >
              <div className="mm-card-head">
                <span className={`mm-card-color-dot mm-bg-${region.color}`} />
                <span className="mm-card-name">{region.name}</span>
                <span className="mm-card-size mm-mono">{kbSize} KB</span>
              </div>
              <div className="mm-card-range mm-mono">
                {formatHex16(region.start)} – {formatHex16(region.end)}
              </div>
              <div className="mm-card-perm">
                <span className="mm-perm-tag">{region.permissions}</span>
              </div>
              <p className="mm-card-desc">{region.description}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
