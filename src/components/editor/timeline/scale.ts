import { createContext, useContext } from "react";

export interface TimelineScale {
  pixelsPerSecond: number;
  duration: number;
}

export const TimelineScaleContext = createContext<TimelineScale>({ pixelsPerSecond: 40, duration: 0 });
export function useTimelineScale(): TimelineScale {
  return useContext(TimelineScaleContext);
}
