/** The safe ranges of a GraphicSpec (phase 1 of docs/MOTION_GRAPHICS.md). Everything the AI writes is clamped to these. */
export const LIMITS = {
  minDuration: 0.3,
  maxDuration: 20,
  maxLayers: 16,
  maxTextChars: 120,
  maxChartRows: 12,
  maxListItems: 8,
  maxParticles: 300,
  maxKeyframes: 24,
  maxCameraKeys: 8,
  maxTimelineEvents: 8,
  maxPins: 12,
  maxRoutes: 6,
  maxCountries: 30,
  maxPoints: 16,
  maxHighlights: 8,
  maxKineticWords: 20,
  minCanvas: 64,
  maxCanvas: 4096,
  maxNumber: 1e12,
} as const;

export const SCHEMA_VERSION = 1;
export const RENDERER_VERSION = 1;
