import { usePipelineStore, type Finished, type MakeVideoInput } from "../../store/pipelineStore";

export type { Finished, MakeVideoInput };

/** The "Make video" run (it lives in a store, so it goes on while another page is open). */
export function useMakeVideo() {
  return usePipelineStore();
}
