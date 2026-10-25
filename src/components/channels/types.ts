/** Asks the person for the notice that comes before making pictures; resolves false when refused. */
export type ConsentFn = () => Promise<boolean>;
