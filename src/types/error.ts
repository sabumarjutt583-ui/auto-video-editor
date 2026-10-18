/** Error shown in the UI: a friendly sentence plus technical text for the "Details" toggle. */
export interface AppError {
  message: string;
  details: string;
  /** A short tag from the engine, e.g. "cancelled". */
  code?: string;
}
