export { area, centre, clampBox, inflate, inside, iou, overlap, touches, union, FRAME, type Box } from "./geometry.ts";
export { frameToSource, sourceToFrame, withCameraMove, type Fit } from "./mapping.ts";
export { findSubject, grayOf, type Subject } from "./saliency.ts";
export { isClear, mainExtent, MIN_SCALE, movedSpec, placeGraphic, SUBJECT_GAP, coveredArea, type PlaceAction, type PlaceInput, type PlaceResult } from "./solver.ts";
export { parseSubjects, SUBJECT_SYSTEM, subjectQuestion } from "./subjects.ts";
export { captionZone, frameSize, safeArea } from "./zones.ts";
export { subjectsOnScreen, type OnScreenInput } from "./onScreen.ts";
export { placeAll, type Placeable, type PlacementContext, type PlacementNote } from "./plan.ts";
