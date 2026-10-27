import { PenLine, Play } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { toAppError } from "../../lib/errors";
import type { ChannelProfile } from "../../lib/pipeline/profile";
import { canWriteScript } from "../../lib/pipeline/profile";
import { countScriptWords, type ScriptRecord } from "../../lib/script/step0";
import { scriptCheck, scriptConfirmSignedIn, scriptSignIn, scriptStatus, type ScriptStatus } from "../../lib/script/api";
import { writeScriptForStep0 } from "../../lib/script/write";
import type { MakeVideoInput } from "../../store/pipelineStore";
import type { AppError } from "../../types";
import { ErrorNotice } from "../ErrorNotice";
import { Button, Card, Field, Select, TextInput } from "../ui";

interface Props {
  profiles: ChannelProfile[];
  busy: boolean;
  /** Starts the video with the Step 0 script, exactly like the channel's New video form. */
  onMakeVideo: (input: MakeVideoInput) => void;
  ensureConsent: () => Promise<boolean>;
}

/** Step 0 — Script Writing, on the Dashboard: the first step of a new video.
Pick a channel, give a title/topic and a word count, then either paste your
own script (it is used as-is, Claude is never called) or press "Write with
Claude" (the tool composes one question from this channel's master prompt +
title + topic + word count and sends it to Claude through the existing Claude
flow). "Open Claude" opens Claude through the same sign-in/profile the
Settings card uses — it is a Claude account, not a Google login, and the app
never sees a password. Every script made here belongs only to its channel:
the channel id travels with the script record into the project, and nothing
from one channel is ever used for another. */
export function Step0Card({ profiles, busy, onMakeVideo, ensureConsent }: Props) {
  const [channelId, setChannelId] = useState(profiles[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [topic, setTopic] = useState("");
  const [wordCountText, setWordCountText] = useState("");
  const [script, setScript] = useState("");
  const [writing, setWriting] = useState(false);
  const [record, setRecord] = useState<ScriptRecord | null>(null);
  const [status, setStatus] = useState<ScriptStatus | null>(null);
  const [working, setWorking] = useState<"" | "sign-in" | "check">("");
  const [error, setError] = useState<AppError | null>(null);

  const profile = profiles.find((p) => p.id === channelId) ?? profiles[0] ?? null;
  const parsedWordCount = wordCountText.trim() === "" ? null : Number(wordCountText);
  const wordCount = parsedWordCount !== null && Number.isFinite(parsedWordCount) ? parsedWordCount : null;

  const load = useCallback(async () => {
    try {
      setStatus(await scriptStatus());
    } catch (caught) {
      setError(toAppError(caught, "Claude's status could not be read."));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (profiles.length > 0 && !profiles.some((p) => p.id === channelId)) setChannelId(profiles[0]!.id);
  }, [profiles, channelId]);

  async function runClaudeAction(kind: "sign-in" | "check", action: () => Promise<ScriptStatus>) {
    setError(null);
    setWorking(kind);
    try {
      setStatus(await action());
    } catch (caught) {
      setError(toAppError(caught, kind === "sign-in" ? "Claude could not be opened." : "Claude could not be checked."));
      await load();
    } finally {
      setWorking("");
    }
  }

  async function writeWithClaude() {
    if (!profile) return;
    setError(null);
    setWriting(true);
    try {
      const written = await writeScriptForStep0(profile, { title, topic, wordCount });
      setScript(written.script);
      setRecord(written.record);
    } catch (caught) {
      setError(toAppError(caught, "The script could not be written."));
    } finally {
      setWriting(false);
    }
  }

  const canWrite = profile !== null && canWriteScript(profile);
  const statusLine = !status ? "Reading…" : !status.consent ? "Not set up" : working === "sign-in" ? "Sign-in window is open" : status.connected ? "Signed in to Claude" : "Not signed in";
  const canStart = profile !== null && !busy && (script.trim() !== "" || topic.trim() !== "" || title.trim() !== "");

  return (
    <Card title="Step 0 — Script Writing" description="The first step of a new video, before Voice Generation. Pick a channel, then paste your own script or let Claude write one from this channel's master prompt.">
      {error && <ErrorNotice error={error} />}
      <Field label="Channel" htmlFor="step0-channel" hint="Every script made here belongs only to this channel. It is never used for another channel.">
        <div className="flex flex-wrap gap-2">
          <Select id="step0-channel" value={profile?.id ?? ""} disabled={busy || profiles.length === 0} onChange={(e) => setChannelId(e.target.value)}>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          <Link to="/channels" className="text-sm text-accent underline">
            New channel
          </Link>
        </div>
      </Field>
      {profile && !canWrite && <p className="text-sm text-muted">This channel has no script writer or no master prompt yet. Set them in the channel Settings, or paste your own script below — a pasted script works without Claude.</p>}
      <Field label="Video title" htmlFor="step0-title" hint="The title of the new video. Empty = the topic is used as the title.">
        <TextInput id="step0-title" value={title} maxLength={200} disabled={busy} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label="Topic" htmlFor="step0-topic" hint="What the video is about. Needed only when Claude writes the script.">
        <TextInput id="step0-topic" value={topic} maxLength={2000} disabled={busy} onChange={(e) => setTopic(e.target.value)} />
      </Field>
      <Field label="Word count (optional)" htmlFor="step0-words" hint="How long the script from Claude should be, in words (50 to 20000). Empty = let the master prompt decide. This is an instruction to Claude, not an exact cut.">
        <TextInput id="step0-words" inputMode="numeric" value={wordCountText} disabled={busy} onChange={(e) => setWordCountText(e.target.value)} />
      </Field>
      <Field label="Script" htmlFor="step0-script" hint="Paste your own script here and it is used as-is — Claude is never called for a pasted script. Or leave it empty and press 'Write with Claude'.">
        <textarea
          id="step0-script"
          value={script}
          disabled={busy}
          rows={10}
          onChange={(e) => {
            setScript(e.target.value);
            setRecord(null);
          }}
          placeholder="Paste the narration here, or let Claude write it below"
          className="w-full resize-y rounded-lg border border-line bg-surface-2 p-3 text-sm text-fg placeholder:text-muted/70 focus:border-accent disabled:opacity-50"
        />
      </Field>
      {record && (
        <p className="text-xs text-muted" role="status">
          Script from {record.source === "claude" ? "Claude" : "your own text"} · {record.wordCountActual.toLocaleString()} words
          {record.wordCountRequested !== null ? ` (asked for ${record.wordCountRequested.toLocaleString()})` : ""} · channel {record.channelId} · master prompt {record.masterPromptVersion}
        </p>
      )}
      {!record && script.trim() !== "" && <p className="text-xs text-muted">Script: {countScriptWords(script).toLocaleString()} words · source: your own text.</p>}
      <div>
        <p className="text-sm">
          Claude: <strong>{statusLine}</strong>
          {status && status.limitedUntil > Date.now() ? ` · resting until ${new Date(status.limitedUntil).toLocaleTimeString()} (usage limit)` : ""}
        </p>
        <p className="text-xs text-muted">Claude sign-in is a Claude account, not a Google login. The app opens your own browser on Claude's sign-in page and never sees your password. Claude's own limits and checks still apply.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" loading={working === "sign-in"} disabled={busy || working !== ""} onClick={() => void runClaudeAction("sign-in", scriptSignIn)}>
          Open Claude
        </Button>
        {working === "sign-in" && <Button onClick={() => void scriptConfirmSignedIn()}>I have signed in</Button>}
        <Button loading={working === "check"} disabled={busy || working !== ""} onClick={() => void runClaudeAction("check", scriptCheck)}>
          Check the connection
        </Button>
        {!status?.consent && (
          <Link to="/settings" className="text-sm text-accent underline">
            Set up Claude in Settings first
          </Link>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button icon={PenLine} loading={writing} disabled={busy || writing || !canWrite || (title.trim() === "" && topic.trim() === "")} onClick={() => void writeWithClaude()}>
          Write with Claude
        </Button>
        <Button
          variant="primary"
          icon={Play}
          disabled={!canStart}
          onClick={() => {
            if (!profile) return;
            onMakeVideo({ profile, name: title.trim() || topic.trim(), script, topic, wordCount: wordCount ?? undefined, voiceFile: null, ensureConsent });
          }}
        >
          Make video from this script
        </Button>
      </div>
    </Card>
  );
}
