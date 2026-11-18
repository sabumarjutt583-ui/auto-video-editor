import type {ExecutionState} from "../execution/types.ts";
import type {ScriptStudioPlanV1} from "../studio/types.ts";
/** Side-effect free guidance: the Rust execution store still owns and validates preparation. */
export function nextLocalPartToPrepare(state:ExecutionState,plan:ScriptStudioPlanV1):number|null{
 if(state.status!=="active"||state.completedParts>=state.totalParts)return null;
 const next=state.parts[state.completedParts];
 if(!next||next.prepared||next.index!==state.completedParts+1)return null;
 if(plan.outlineRequired&&state.outlineVersions.length===0)return null;
 if(plan.continuityRequired&&state.completedParts>0
   &&!state.continuityNotes.some(note=>note.afterPart===state.completedParts))return null;
 return next.index;
}
