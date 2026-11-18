import type {AutoView} from "./api.ts";

/** A historical approval for a previous script version is not current approval. */
export function currentVersionApproved(view:AutoView|null):boolean{
 const review=view?.review;
 const version=review?.versions.at(-1);
 const round=review?.rounds.at(-1);
 return Boolean(version&&round&&review?.approvals.some(a=>
  a.versionIndex===version.index&&a.scriptDigest===version.text.sha256&&a.roundIndex===round.index));
}
/** Human consent must refer to the exact current saved script preview. */
export function canApproveExact(view:AutoView|null,previewedDigest:string):boolean{
 const review=view?.review;
 const version=review?.versions.at(-1);
 const round=review?.rounds.at(-1);
 return Boolean(view&&!view.workerRunning&&view.task.stage==="awaiting_approval"&&
  version&&round&&round.versionIndex===version.index&&
  version.text.sha256===previewedDigest&&previewedDigest.length===64&&
  round.sections.length>0&&round.sections.every(s=>s.report!==null&&s.score!==null)&&
  !currentVersionApproved(view));
}
