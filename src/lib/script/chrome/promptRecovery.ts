import type {PartState,ObjectRef} from "../execution/types.ts";
/** Object filenames carry immutable Rust revision IDs. Never guess from timestamps. */
export function immutableRevision(ref:ObjectRef|null|undefined):number|null{
 if(!ref)return null;
 const match=/^object-(\d{6})-/.exec(ref.filename);
 return match?Number(match[1]):null;
}
/** After a response import, the previously prepared prompt must not be re-offered. */
export function pendingPromptKind(part:PartState):"prompt"|"continuation"|null{
 if(part.committed||!part.prepared)return null;
 if(!part.fragments.length)return "prompt";
 const fragment=part.fragments.at(-1);
 const continuation=part.continuationPrompts.at(-1);
 const fragmentRevision=immutableRevision(fragment);
 const continuationRevision=immutableRevision(continuation);
 if(fragmentRevision===null||continuationRevision===null)return null;
 return continuationRevision>fragmentRevision?"continuation":null;
}
