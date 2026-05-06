import { useState, useCallback, useEffect, useRef, memo } from "react";

export interface AspectRatioPreset {
  label: string;
  ratio: string;
  width: number;
  height: number;
}

const PRESETS: AspectRatioPreset[] = [
  { label: "Landscape", ratio: "16:9", width: 1920, height: 1080 },
  { label: "Portrait", ratio: "9:16", width: 1080, height: 1920 },
  { label: "Square", ratio: "1:1", width: 1080, height: 1080 },
  { label: "Instagram", ratio: "4:5", width: 1080, height: 1350 },
  { label: "Classic", ratio: "4:3", width: 1440, height: 1080 },
  { label: "Cinematic", ratio: "21:9", width: 2560, height: 1080 },
];

function matchPreset(width: number, height: number): AspectRatioPreset | null {
  const targetRatio = width / height;
  for (const preset of PRESETS) {
    const presetRatio = preset.width / preset.height;
    if (Math.abs(targetRatio - presetRatio) < 0.01) return preset;
  }
  return null;
}

function formatDimensions(width: number, height: number): string {
  const preset = matchPreset(width, height);
  if (preset) return preset.ratio;
  return `${width}×${height}`;
}

interface AspectRatioSelectorProps {
  width: number;
  height: number;
  onChange: (width: number, height: number) => void;
}

export const AspectRatioSelector = memo(function AspectRatioSelector({
  width,
  height,
  onChange,
}: AspectRatioSelectorProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleSelect = useCallback(
    (preset: AspectRatioPreset) => {
      setOpen(false);
      if (preset.width === width && preset.height === height) return;
      onChange(preset.width, preset.height);
    },
    [width, height, onChange],
  );

  useEffect(() => {
    if (!open) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [open]);

  const activePreset = matchPreset(width, height);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="h-7 flex items-center gap-1.5 px-2.5 rounded-md text-[11px] font-medium border border-neutral-700 text-neutral-300 transition-colors hover:border-neutral-500 hover:bg-neutral-800"
        title="Change aspect ratio"
        aria-label="Change aspect ratio"
        aria-expanded={open}
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <path d="M8 21h8" />
          <path d="M12 17v4" />
        </svg>
        <span>{formatDimensions(width, height)}</span>
      </button>
      {open && (
        <div
          className="absolute top-full left-0 mt-1.5 rounded-lg shadow-xl z-50 min-w-[180px] overflow-hidden"
          style={{ background: "#161618", border: "1px solid rgba(255,255,255,0.08)" }}
        >
          {PRESETS.map((preset) => {
            const isActive =
              activePreset?.width === preset.width && activePreset?.height === preset.height;
            return (
              <button
                key={preset.ratio}
                type="button"
                onClick={() => handleSelect(preset)}
                className="flex w-full items-center justify-between px-3 py-2 text-[11px] text-left transition-colors"
                style={{
                  color: isActive ? "#FAFAFA" : "#A1A1AA",
                  background: isActive ? "rgba(255,255,255,0.06)" : "transparent",
                }}
                onMouseEnter={(e) => {
                  if (!isActive) e.currentTarget.style.background = "rgba(255,255,255,0.04)";
                }}
                onMouseLeave={(e) => {
                  if (!isActive) e.currentTarget.style.background = "transparent";
                }}
              >
                <span className="font-medium">{preset.label}</span>
                <span className="text-[10px] tabular-nums" style={{ color: "#52525B" }}>
                  {preset.ratio} · {preset.width}×{preset.height}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
});
