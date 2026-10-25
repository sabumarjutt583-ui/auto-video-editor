import { readEditor } from "../../editor/model";
import { useProjectStore } from "../../../store/projectStore";
import { profileEditor, profileToPatch, type ChannelProfile } from "../profile";

/** Puts a channel profile into the open project: its settings, style, captions, audio, render, and the channel link. */
export function applyChannelProfile(profile: ChannelProfile, script?: string): void {
  const store = useProjectStore.getState();
  const project = store.project;
  if (!project) throw new Error("The project is not open.");
  const editor = readEditor(project);
  store.update({
    ...profileToPatch(profile),
    channelId: profile.id,
    ...(script === undefined ? {} : { script }),
    editor: { ...editor, ...profileEditor(profile, editor) },
  });
}
