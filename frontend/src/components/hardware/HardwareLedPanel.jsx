import { LED_INDICATORS, HARDWARE_TEST_CONDITIONS } from './hardwareUtils';

export default function HardwareLedPanel({
  activeLeds,
  activeResult,
  onConditionClick,
  isHwConnected,
}) {
  const currentLeds = activeLeds || {
    blue: false,
    green: false,
    yellow: false,
    white: false,
    red: false,
  };

  const hasError = Boolean(activeResult?.error && activeResult.error.length > 0);

  // Collect names of all currently active LEDs
  const activeLedNames = LED_INDICATORS.filter((led) => currentLeds[led.key]).map(
    (led) => led.label
  );

  return (
    <section
      className="w-full glass-panel rounded-2xl p-5 md:p-6 flex flex-col gap-5 border border-white/80 shadow-md relative overflow-hidden"
      aria-label="Hardware LED Indicators and Error Telemetry"
    >
      {/* Dynamic atmospheric back-glow keyed to the active LED colors */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        {currentLeds.red && (
          <div className="absolute right-10 top-0 w-80 h-80 rounded-full bg-rose-600/15 blur-3xl animate-pulse" />
        )}
        {currentLeds.blue && (
          <div className="absolute left-10 top-0 w-80 h-80 rounded-full bg-blue-600/15 blur-3xl" />
        )}
        {currentLeds.green && (
          <div className="absolute left-1/3 top-0 w-80 h-80 rounded-full bg-emerald-600/15 blur-3xl" />
        )}
        {currentLeds.yellow && (
          <div className="absolute right-1/3 top-0 w-80 h-80 rounded-full bg-amber-500/15 blur-3xl" />
        )}
        {currentLeds.white && (
          <div className="absolute left-1/2 top-0 w-80 h-80 rounded-full bg-slate-200/25 blur-3xl" />
        )}
      </div>

      {/* HEADER: Title & Active LED Combination Pill */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-brand-sand/30 z-10">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-brand-dark text-brand-cream flex items-center justify-center shadow-sm">
            <span className="material-symbols-outlined text-[20px]">lightbulb</span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] text-brand-taupe font-bold uppercase tracking-wider">
                PHYSICAL BOARD TELEMETRY // STAGE 01
              </span>
              <span className="text-brand-slate text-xs">//</span>
              <span className="font-mono text-[10px] text-brand-deep font-bold uppercase">
                5-CHANNEL LED ARRAY
              </span>
            </div>
            <h3 className="font-sans text-lg md:text-xl font-bold text-brand-dark tracking-tight">
              Hardware LED Indicators & Bus Activity
            </h3>
          </div>
        </div>

        {/* Live Multi-LED State Pill */}
        <div className="flex items-center gap-2">
          <div className="px-3.5 py-1.5 rounded-xl bg-white/70 border border-brand-sand/50 shadow-sm flex items-center gap-2 font-mono text-xs font-bold text-brand-dark">
            <span className="text-brand-taupe text-[10px] uppercase">ACTIVE STATE:</span>
            {activeLedNames.length > 0 ? (
              <span className="flex items-center gap-1.5 text-brand-dark font-extrabold">
                {activeLedNames.join(' + ')}
              </span>
            ) : (
              <span className="text-brand-taupe italic">Standby (All LEDs Dim)</span>
            )}
          </div>
        </div>
      </div>

      {/* 5 PHYSICAL LED BULBS ARRAY WITH REALISTIC 3D GLOW */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5 z-10">
        {LED_INDICATORS.map((led) => {
          const isLit = Boolean(currentLeds[led.key]);

          return (
            <div
              key={led.key}
              className={`p-3.5 rounded-xl flex flex-col justify-between gap-3 transition-all duration-300 border ${
                isLit
                  ? 'bg-white/95 border-white shadow-md'
                  : 'bg-white/40 border-brand-sand/30 opacity-65 hover:opacity-85'
              }`}
            >
              {/* Top row: GPIO badge and State */}
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] text-brand-taupe font-bold px-1.5 py-0.5 rounded bg-brand-sand/20">
                  {led.gpio}
                </span>
                <span
                  className={`font-mono text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full border ${
                    isLit
                      ? led.key === 'red'
                        ? 'bg-rose-100 text-rose-800 border-rose-300'
                        : led.key === 'green'
                          ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                          : led.key === 'blue'
                            ? 'bg-blue-100 text-blue-800 border-blue-300'
                            : led.key === 'yellow'
                              ? 'bg-amber-100 text-amber-800 border-amber-300'
                              : 'bg-slate-100 text-slate-800 border-slate-300'
                      : 'bg-slate-100 text-slate-400 border-slate-200'
                  }`}
                >
                  {isLit ? 'LIT / ACTIVE' : 'DIM / INACTIVE'}
                </span>
              </div>

              {/* Center: 3D LED Physical Bulb */}
              <div className="flex items-center gap-3.5 my-1">
                <div className="relative flex items-center justify-center p-1">
                  {/* Metal bezel housing ring */}
                  <div
                    className={`w-9 h-9 rounded-full flex items-center justify-center transition-all duration-300 ${
                      isLit
                        ? 'bg-slate-800 ring-2 ring-slate-400 shadow-inner'
                        : 'bg-slate-900/80 ring-1 ring-slate-700/60'
                    }`}
                  >
                    {/* The 5mm Diffused Optical Bulb */}
                    <div
                      className={`w-6 h-6 rounded-full relative transition-all duration-300 ${
                        isLit && led.key === 'red' ? 'animate-pulse' : ''
                      }`}
                      style={{
                        backgroundColor: isLit ? led.colorHex : '#1e293b',
                        boxShadow: isLit
                          ? `0 0 16px 5px ${led.activeGlow}, 0 0 32px 10px ${led.activeGlow}, inset 0 1px 3px rgba(255,255,255,0.9)`
                          : 'inset 0 2px 4px rgba(0,0,0,0.8), 0 0 2px rgba(255,255,255,0.1)',
                        border: isLit ? '1.5px solid rgba(255,255,255,0.8)' : '1.5px solid #334155',
                      }}
                    >
                      {/* Specular highlight glint (curved lens reflection) */}
                      <span className="absolute top-0.5 left-1 w-2 h-1 rounded-full bg-white/70 transform -rotate-45" />
                    </div>
                  </div>
                </div>

                <div className="flex flex-col">
                  <span className="font-sans text-sm font-bold text-brand-dark">
                    {led.label}
                  </span>
                  <span className="font-mono text-[11px] font-bold text-brand-deep">
                    {led.bus}
                  </span>
                </div>
              </div>

              {/* Bottom: Architectural rule description */}
              <div className="pt-2 border-t border-brand-sand/20">
                <p className="font-body text-[11px] text-brand-taupe leading-tight">
                  {led.description}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* PROMINENT NON-INTRUSIVE ARCHITECTURAL ERROR BANNER */}
      {hasError ? (
        <div
          className="p-4 rounded-xl border border-rose-300 bg-rose-50/90 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4 z-10 animate-fade-in"
          role="alert"
        >
          <div className="flex items-start gap-3.5">
            <div className="w-8 h-8 rounded-lg bg-rose-600 text-white flex items-center justify-center shrink-0 shadow-[0_0_10px_rgba(225,29,72,0.5)]">
              <span className="material-symbols-outlined text-[20px]">warning</span>
            </div>
            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded bg-rose-200 text-rose-900 font-mono text-[10px] font-extrabold uppercase tracking-wider border border-rose-300">
                  FAULT CODE
                </span>
                <span className="font-mono text-sm font-black text-rose-950 uppercase tracking-tight">
                  {activeResult.error}
                </span>
              </div>
              <p className="font-body text-xs text-rose-900 mt-1">
                {activeResult.error === 'INVALID OPCODE' &&
                  'The opcode nibble [15:12] is not between 1 and 4. Instruction is invalid.'}
                {activeResult.error === 'INVALID MODE' &&
                  'STORE instruction executed with Immediate addressing mode (00). Immediate operands cannot be write targets.'}
                {activeResult.error === 'OUT OF RANGE' &&
                  `Calculated effective address 0x${(activeResult.ea || 0).toString(16).toUpperCase()} overflows the 16-bit address space (> 0xFFFF).`}
                {activeResult.error === 'UNMAPPED ADDR' &&
                  `Target effective address 0x${(activeResult.ea || 0).toString(16).toUpperCase()} falls outside configured ROM, RAM, and I/O windows.`}
                {activeResult.error === 'OVERLAP CONFLICT' &&
                  'Target effective address falls in the 0x7000–0x7FFF window belonging simultaneously to RAM and I/O. Bus arbitration conflict detected.'}
                {activeResult.error === 'PERMISSION DENIED' &&
                  `Attempted STORE (memory write) into read-only ROM at address 0x${(activeResult.ea || 0).toString(16).toUpperCase()}. Access violation blocked.`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 font-mono text-xs font-bold text-rose-900 shrink-0 bg-white/70 px-3 py-2 rounded-lg border border-rose-200 shadow-inner">
            <span className="w-2 h-2 rounded-full bg-rose-600 animate-ping" />
            <span>RED LED ILLUMINATED ({activeLedNames.join(' + ')})</span>
          </div>
        </div>
      ) : (
        <div className="px-4 py-2.5 rounded-xl border border-emerald-300/60 bg-emerald-50/50 flex items-center justify-between gap-3 text-xs font-mono font-bold text-emerald-900 z-10">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-emerald-700 text-[18px]">check_circle</span>
            <span>BUS HEALTHY // ALL HARDWARE TRACES AND PERMISSIONS NOMINAL</span>
          </div>
          <span className="text-[11px] text-emerald-800 font-semibold hidden md:inline">
            Status: {isHwConnected ? 'Hardware Silicon Synced' : 'Software Core Reference'}
          </span>
        </div>
      )}

      {/* INTERACTIVE 10-CONDITION TEST BENCH */}
      <div className="flex flex-col gap-2.5 p-3.5 rounded-xl bg-white/50 border border-brand-sand/40 z-10">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-brand-sand/30">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-brand-dark text-[18px]">tune</span>
            <span className="font-mono text-xs font-bold text-brand-dark uppercase tracking-wider">
              10-CONDITION LED & ERROR TEST BENCH:
            </span>
            <span className="font-mono text-[11px] text-brand-taupe hidden lg:inline">
              Click any condition to test exact hardware error and multiple LED combinations:
            </span>
          </div>
          <span className="font-mono text-[10px] text-brand-taupe font-bold">
            SECTION 2, 6 & 11 OF DEVICE_GUIDE.MD
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
          {HARDWARE_TEST_CONDITIONS.map((cond) => {
            const isCurrentlySelected =
              activeResult?.instr?.toUpperCase() === cond.code.toUpperCase() &&
              (!cond.error || activeResult?.error === cond.error);

            const isErrorCond = Boolean(cond.error);

            return (
              <button
                key={cond.id}
                type="button"
                onClick={() => onConditionClick && onConditionClick(cond.code, cond.map)}
                className={`p-2 rounded-lg font-mono text-left flex flex-col justify-between transition-all border shadow-sm ${
                  isCurrentlySelected
                    ? isErrorCond
                      ? 'bg-rose-100 border-rose-400 ring-2 ring-rose-400 text-rose-950 shadow-md scale-[1.02]'
                      : 'bg-emerald-100 border-emerald-400 ring-2 ring-emerald-400 text-emerald-950 shadow-md scale-[1.02]'
                    : isErrorCond
                      ? 'bg-white hover:bg-rose-50/80 border-rose-200 text-rose-900'
                      : 'bg-white hover:bg-brand-sand/30 border-brand-sand/50 text-brand-dark'
                }`}
                title={`${cond.name}: ${cond.description} (Expected LEDs: ${cond.ledDesc})`}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="font-bold text-[11px] truncate">
                    {cond.shortName}
                  </span>
                  <span className="text-[10px] text-brand-taupe font-bold px-1 rounded bg-black/5">
                    0x{cond.code}
                  </span>
                </div>
                <div className="flex items-center justify-between mt-1 pt-1 border-t border-black/5 text-[10px]">
                  <span className="truncate text-brand-taupe">{cond.instruction}</span>
                  <span
                    className={`font-extrabold ml-1 shrink-0 ${
                      cond.expectedLeds.includes('red')
                        ? 'text-rose-700'
                        : cond.expectedLeds.includes('green')
                          ? 'text-emerald-700'
                          : cond.expectedLeds.includes('blue')
                            ? 'text-blue-700'
                            : cond.expectedLeds.includes('yellow')
                              ? 'text-amber-700'
                              : 'text-slate-700'
                    }`}
                  >
                    {cond.ledDesc}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
