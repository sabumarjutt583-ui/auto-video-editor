import { readEditor } from "../../editor/model";
import { useProjectStore } from "../../../store/projectStore";
import { profileEditor, profileToPatch, type ChannelProfile } from "../profile";

/** Puts a channel profile into the open project: its settings, style, captions, audio, render, and the channel link.
When a Step 0 record is given, the script's audit fields are saved with it, so a later audit can show
which channel, title, topic, word count and master prompt version produced the script. */
export function applyChannelProfile(profile: ChannelProfile, script?: string, record?: import("../../script/step0.ts").ScriptRecord): void {
  const store = useProjectStore.getState();
  const project = store.project;
  if (!project) throw new Error("The project is not open.");
  const editor = readEditor(project);
  store.update({
    ...profileToPatch(profile),
    channelId: profile.id,
    ...(script === undefined ? {} : { script }),
    ...(record === undefined
      ? {}
      : {
          scriptSource: record.source,
          scriptTopic: record.topic,
          // The project file stores 0 for "none asked" (a number field, never null).
          scriptWordsRequested: record.wordCountRequested ?? 0,
          scriptMasterPromptVersion: record.masterPromptVersion,
        }),
    editor: { ...editor, ...profileEditor(profile, editor) },
  });
}
