import { Camera, CheckCircle2, FlaskConical, LogIn, Pause, Play, ShieldCheck, Trash2 } from "lucide-react";
import { useState } from "react";

import { accountStatusLabel, accountTone, type Tone } from "../../lib/imagegen/format";
import type { AccountView } from "../../types/imagegen";
import { Button, IconButton } from "../ui";

const TONE_CLASSES: Record<Tone, string> = {
  good: "bg-success/15 text-success",
  wait: "bg-accent-soft text-accent-fg",
  bad: "bg-danger/15 text-danger",
  neutral: "bg-surface-2 text-muted",
};

export interface AccountActions {
  signIn: (id: string) => void;
  finishSignIn: (id: string) => void;
  verify: (id: string) => void;
  test: (account: AccountView) => void;
  setEnabled: (id: string, enabled: boolean) => void;
  remove: (id: string) => void;
  peek: (account: AccountView) => void;
}

export function AccountRow({ account, actions }: { account: AccountView; actions: AccountActions }) {
  const [confirming, setConfirming] = useState(false);
  const working = ["signing_in", "checking", "testing"].includes(account.status);
  const connected = !["not_connected", "signed_out"].includes(account.status);
  const detail = account.flagged || (account.status === "limit_reached" ? account.cooldownReason : "") || account.verifyMessage || account.lastError;

  return (
    <li className="flex flex-col gap-2 rounded-xl border border-line bg-surface-2 p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-sm font-semibold">{account.name}</span>
        {account.email && <span className="text-xs text-muted">{account.email}</span>}
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${TONE_CLASSES[accountTone(account.status)]}`}>{accountStatusLabel(account)}</span>
        <span className="ml-auto text-xs text-muted">
          {account.stats.completed} done, {account.stats.failed} failed
        </span>
      </div>
      {detail && <p className="text-xs text-muted">{detail}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {account.status === "signing_in" ? (
          <Button variant="primary" icon={CheckCircle2} onClick={() => actions.finishSignIn(account.id)}>
            I have signed in
          </Button>
        ) : (
          <Button icon={LogIn} disabled={working} onClick={() => actions.signIn(account.id)}>
            Sign in
          </Button>
        )}
        <Button icon={ShieldCheck} disabled={working || !connected} onClick={() => actions.verify(account.id)}>
          Verify
        </Button>
        <Button icon={FlaskConical} disabled={working || !connected} onClick={() => actions.test(account)}>
          Test image
        </Button>
        <Button icon={account.enabled ? Pause : Play} disabled={working} onClick={() => actions.setEnabled(account.id, !account.enabled)}>
          {account.enabled ? "Pause" : "Resume"}
        </Button>
        <IconButton icon={Camera} label="Show background browser" onClick={() => actions.peek(account)} />
        {confirming ? (
          <span className="inline-flex items-center gap-2 text-sm">
            <span className="text-muted">Remove and sign out?</span>
            <Button variant="danger" onClick={() => actions.remove(account.id)}>
              Yes, remove
            </Button>
            <Button onClick={() => setConfirming(false)}>Cancel</Button>
          </span>
        ) : (
          <IconButton icon={Trash2} label="Remove account" danger disabled={working} onClick={() => setConfirming(true)} />
        )}
      </div>
    </li>
  );
}
