import { useMemo } from 'react';
import { compareDecoderResults, OFFICIAL_TEST_CASES } from './hardwareUtils';

export default function ComparisonCard({
  softwareResult,
  hardwareResult,
  isHardwareConnected,
  onConnectClick,
  onPresetClick,
}) {
  const comparison = useMemo(() => {
    return compareDecoderResults(softwareResult, hardwareResult, isHardwareConnected);
  }, [softwareResult, hardwareResult, isHardwareConnected]);

  if (!comparison) return null;

  const { status, isMatch, title, subtitle, matchedCount, totalCount, fields, differences } = comparison;

  const isUnavailable = status === 'UNAVAILABLE';

  const handleExportComparison = () => {
    const report = {
      timestamp: new Date().toISOString(),
      status,
      isMatch,
      instruction: softwareResult?.instr || '—',
      conformanceRate: `${matchedCount}/${totalCount}`,
      softwareDecoder: softwareResult,
      hardwareDecoder: hardwareResult || null,
      fieldComparison: fields.map((f) => ({
        field: f.label,
        software: f.swValue,
        hardware: f.hwValue,
        matches: f.matches,
      })),
      differences: differences.map((d) => d.label),
    };

    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `coa-comparison-audit-${softwareResult?.instr || 'report'}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section
      id="comparison-section"
      className="w-full glass-panel p-5 md:p-6 rounded-2xl flex flex-col gap-5 border border-white/80 shadow-lg relative overflow-hidden"
      aria-label="Hardware vs Software Comparison"
    >
      {/* Decorative backdrop light */}
      <div
        className={`absolute -right-20 -top-20 w-72 h-72 rounded-full blur-3xl pointer-events-none transition-colors duration-500 ${
          isUnavailable
            ? 'bg-brand-slate/20'
            : isMatch
              ? 'bg-emerald-400/15'
              : 'bg-rose-500/20'
        }`}
      />

      {/* TOP HEADER: Comparison Status Badge & Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-3 border-b border-brand-sand/30 z-10">
        <div className="flex items-center gap-3">
          <div
            className={`w-9 h-9 rounded-xl flex items-center justify-center shadow-sm ${
              isUnavailable
                ? 'bg-brand-sand/40 text-brand-deep'
                : isMatch
                  ? 'bg-emerald-500 text-white shadow-[0_0_12px_rgba(16,185,129,0.5)]'
                  : 'bg-rose-500 text-white shadow-[0_0_12px_rgba(239,68,68,0.5)] animate-pulse'
            }`}
          >
            <span className="material-symbols-outlined text-[20px]">
              {isUnavailable ? 'compare' : isMatch ? 'verified' : 'gpp_bad'}
            </span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] text-brand-taupe font-bold uppercase tracking-wider">
                COA LAB VERIFICATION ENGINE
              </span>
              <span className="text-brand-slate text-xs">//</span>
              <span className="font-mono text-[10px] text-brand-deep font-bold uppercase">
                11-POINT ARCHITECTURAL AUDIT
              </span>
            </div>
            <h3 className="font-sans text-lg md:text-xl font-bold text-brand-dark tracking-tight">
              Hardware vs Software Decoder Comparison
            </h3>
          </div>
        </div>

        {/* Status Indicator Pill */}
        <div className="flex items-center gap-2.5">
          <div
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl font-mono text-xs font-bold uppercase tracking-wider border shadow-sm ${
              isUnavailable
                ? 'bg-amber-50 text-amber-900 border-amber-300'
                : isMatch
                  ? 'bg-emerald-100/90 text-emerald-900 border-emerald-400'
                  : 'bg-rose-100/90 text-rose-900 border-rose-400 animate-pulse'
            }`}
          >
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                isUnavailable
                  ? 'bg-amber-500'
                  : isMatch
                    ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,1)]'
                    : 'bg-rose-500 shadow-[0_0_8px_rgba(239,68,68,1)]'
              }`}
            />
            <span>{title}</span>
          </div>

          <button
            type="button"
            onClick={handleExportComparison}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/70 hover:bg-white text-brand-dark font-mono text-xs font-bold border border-brand-sand/50 shadow-sm transition-all"
            title="Export JSON Verification Report for Faculty Evaluation"
          >
            <span className="material-symbols-outlined text-[15px]">download</span>
            <span className="hidden sm:inline">Export Audit</span>
          </button>
        </div>
      </div>

      {/* VERDICT SUMMARY BANNER */}
      <div
        className={`p-4 rounded-xl border flex flex-col md:flex-row md:items-center justify-between gap-3 shadow-sm transition-colors ${
          isUnavailable
            ? 'bg-white/60 border-brand-sand/40'
            : isMatch
              ? 'bg-emerald-50/70 border-emerald-300'
              : 'bg-rose-50/80 border-rose-300'
        }`}
      >
        <div className="flex items-start gap-3">
          <span
            className={`material-symbols-outlined text-[24px] mt-0.5 ${
              isUnavailable
                ? 'text-brand-taupe'
                : isMatch
                  ? 'text-emerald-600'
                  : 'text-rose-600'
            }`}
          >
            {isUnavailable ? 'info' : isMatch ? 'check_circle' : 'error'}
          </span>
          <div className="flex flex-col">
            <span
              className={`font-mono text-xs font-extrabold uppercase tracking-wide ${
                isUnavailable
                  ? 'text-brand-deep'
                  : isMatch
                    ? 'text-emerald-900'
                    : 'text-rose-900'
              }`}
            >
              {isUnavailable
                ? 'STANDBY: AWAITING PHYSICAL HARDWARE'
                : isMatch
                  ? 'CONFORMANCE VERIFIED: 100% MATCH ACROSS ALL 11 ARCHITECTURAL POINTS'
                  : `DISCREPANCY ALERT: ${differences.length} ARCHITECTURAL FIELD(S) DIFFER`}
            </span>
            <p className="font-body text-xs text-brand-dark mt-0.5">{subtitle}</p>
          </div>
        </div>

        {/* Action Button or Stats Pill */}
        <div className="flex items-center gap-2 self-end md:self-auto">
          {isUnavailable ? (
            <button
              type="button"
              onClick={onConnectClick}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-dark hover:bg-brand-deep text-brand-cream font-mono text-xs font-bold uppercase tracking-wider shadow-sm transition-all"
            >
              <span className="material-symbols-outlined text-[16px]">usb</span>
              Connect Hardware
            </button>
          ) : (
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-white/80 border border-brand-sand/40 font-mono text-xs font-bold text-brand-dark shadow-inner">
              <span className="text-brand-taupe text-[11px]">RATE:</span>
              <span className={isMatch ? 'text-emerald-700' : 'text-rose-700 font-extrabold'}>
                {matchedCount} / {totalCount} Points ({Math.round((matchedCount / totalCount) * 100)}%)
              </span>
            </div>
          )}
        </div>
      </div>

      {/* QUICK INJECTOR BAR FOR FACULTY DEMO */}
      <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl bg-white/40 border border-brand-sand/30">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-brand-taupe text-[16px]">science</span>
          <span className="font-mono text-xs font-bold text-brand-deep uppercase">
            FACULTY DEMO PRESETS:
          </span>
          <span className="font-mono text-[11px] text-brand-taupe hidden lg:inline">
            Inject official test cases from DEVICE_GUIDE.md Section 11 to demonstrate matching results:
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {OFFICIAL_TEST_CASES.slice(0, 5).map((preset) => (
            <button
              key={preset.code}
              type="button"
              onClick={() => onPresetClick && onPresetClick(preset.code, preset.map)}
              className="px-2.5 py-1 rounded-lg bg-white hover:bg-brand-sand/40 text-brand-dark font-mono text-xs font-bold border border-brand-sand/50 shadow-sm transition-colors"
              title={`${preset.label} (${preset.map} Map)`}
            >
              {preset.code} <span className="text-[10px] text-brand-taupe">({preset.label.split(' ')[0]})</span>
            </button>
          ))}
          {OFFICIAL_TEST_CASES.slice(5, 7).map((preset) => (
            <button
              key={preset.code}
              type="button"
              onClick={() => onPresetClick && onPresetClick(preset.code, preset.map)}
              className="px-2 py-1 rounded-lg bg-white hover:bg-rose-50 text-rose-800 font-mono text-xs font-bold border border-rose-200 shadow-sm transition-colors"
              title={`${preset.label} (${preset.map} Map)`}
            >
              {preset.code} <span className="text-[10px] text-rose-600">(Err)</span>
            </button>
          ))}
        </div>
      </div>

      {/* COMPARISON MATRIX TABLE */}
      <div className="overflow-x-auto rounded-xl border border-brand-sand/40 bg-white/50 shadow-inner">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-brand-sand/20 border-b border-brand-sand/40 font-mono text-[11px] font-bold text-brand-deep uppercase tracking-wider">
              <th className="py-2.5 px-4 w-[28%]">Architectural Parameter</th>
              <th className="py-2.5 px-4 w-[28%]">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-brand-slate" />
                  <span>Software Decoder (JS Core)</span>
                </div>
              </th>
              <th className="py-2.5 px-4 w-[28%]">
                <div className="flex items-center gap-1.5">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      isUnavailable ? 'bg-amber-400' : 'bg-emerald-500'
                    }`}
                  />
                  <span>Hardware Decoder (ESP32)</span>
                </div>
              </th>
              <th className="py-2.5 px-4 w-[16%] text-center">Conformance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-brand-sand/20 font-mono text-xs">
            {fields.map((field) => {
              const rowMismatch = field.matches === false;
              const rowMatch = field.matches === true;

              return (
                <tr
                  key={field.id}
                  className={`transition-colors ${
                    rowMismatch
                      ? 'bg-rose-100/60 hover:bg-rose-100/80'
                      : rowMatch
                        ? 'hover:bg-white/80'
                        : 'hover:bg-white/40'
                  }`}
                >
                  {/* Parameter Label & Description */}
                  <td className="py-2.5 px-4">
                    <div className="flex flex-col">
                      <span className="font-bold text-brand-dark">{field.label}</span>
                      <span className="font-sans text-[11px] text-brand-taupe">
                        {field.description}
                      </span>
                    </div>
                  </td>

                  {/* Software Decoder Value */}
                  <td className="py-2.5 px-4">
                    <span className="font-extrabold text-brand-dark px-2 py-0.5 rounded bg-white/70 border border-brand-sand/40 inline-block shadow-sm">
                      {field.swValue}
                    </span>
                  </td>

                  {/* Hardware Decoder Value */}
                  <td className="py-2.5 px-4">
                    {isUnavailable ? (
                      <span className="text-brand-taupe italic text-[11px] px-2 py-0.5 rounded bg-slate-100 border border-dashed border-slate-300 inline-block">
                        Awaiting ESP32 Link
                      </span>
                    ) : (
                      <span
                        className={`font-extrabold px-2 py-0.5 rounded inline-block shadow-sm border ${
                          rowMismatch
                            ? 'bg-rose-200/90 text-rose-950 border-rose-400'
                            : 'bg-emerald-100/80 text-emerald-950 border-emerald-300'
                        }`}
                      >
                        {field.hwValue}
                      </span>
                    )}
                  </td>

                  {/* Conformance Status Pill */}
                  <td className="py-2.5 px-4 text-center">
                    {isUnavailable ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-slate-100 text-brand-taupe text-[10px] font-bold border border-slate-200">
                        <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                        STANDBY
                      </span>
                    ) : rowMatch ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold border border-emerald-300">
                        <span className="material-symbols-outlined text-[13px]">check</span>
                        MATCH
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-rose-200 text-rose-900 text-[10px] font-bold border border-rose-400 animate-pulse">
                        <span className="material-symbols-outlined text-[13px]">close</span>
                        MISMATCH
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* FOOTER NOTE: Academic Context & Hardware Equivalence */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-brand-taupe font-mono text-[11px] pt-1">
        <div className="flex items-center gap-1.5">
          <span className="material-symbols-outlined text-[15px]">info</span>
          <span>
            Numeric equivalencies (decimal vs hex) are matched without formatting false positives.
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span>Authoritative Source:</span>
          <span className="px-1.5 py-0.5 rounded bg-brand-cream/80 text-brand-deep font-bold border border-brand-sand/50">
            DEVICE_GUIDE.md (Sections 3–6)
          </span>
        </div>
      </div>
    </section>
  );
}
