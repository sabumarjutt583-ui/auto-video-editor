import { Plus, Users } from "lucide-react";
import { useState } from "react";

import { toAppError } from "../../lib/errors";
import {
  imagegenAddAccount,
  imagegenFinishSignIn,
  imagegenRemoveAccount,
  imagegenSignIn,
  imagegenUpdateAccount,
  imagegenVerify,
} from "../../lib/imagegen/api";
import type { AppError } from "../../types";
import type { AccountView } from "../../types/imagegen";
import { ErrorNotice } from "../ErrorNotice";
import { Button, Card, TextInput } from "../ui";
import { AccountRow, type AccountActions } from "./AccountRow";
import { BackgroundBrowserModal } from "./BackgroundBrowserModal";
import { TestImageModal } from "./TestImageModal";

interface AccountsPanelProps {
  accounts: readonly AccountView[];
  /** Asks for the one-time notice first; resolves true when the person accepted. */
  ensureConsent: () => Promise<boolean>;
}

export function AccountsPanel({ accounts, ensureConsent }: AccountsPanelProps) {
  const [name, setName] = useState("");
  const [error, setError] = useState<AppError | null>(null);
  const [testing, setTesting] = useState<AccountView | null>(null);
  const [peeking, setPeeking] = useState<AccountView | null>(null);

  async function run(job: () => Promise<unknown>) {
    setError(null);
    try {
      await job();
    } catch (failure) {
      setError(toAppError(failure, "That did not work."));
    }
  }

  const gated = (job: () => Promise<unknown>) => run(async () => ((await ensureConsent()) ? job() : undefined));

  const actions: AccountActions = {
    signIn: (id) => void gated(() => imagegenSignIn(id)),
    finishSignIn: (id) => void run(() => imagegenFinishSignIn(id)),
    verify: (id) => void gated(() => imagegenVerify(id)),
    test: (account) => void ensureConsent().then((ok) => ok && setTesting(account)),
    setEnabled: (id, enabled) => void run(() => imagegenUpdateAccount(id, undefined, enabled)),
    remove: (id) => void run(() => imagegenRemoveAccount(id)),
    peek: setPeeking,
  };

  function add() {
    const trimmed = name.trim();
    if (trimmed === "") return;
    void run(async () => {
      await imagegenAddAccount(trimmed);
      setName("");
    });
  }

  return (
    <Card title="Google accounts" description="Each account makes pictures in turn. More accounts mean more pictures before a limit is reached. Use a separate Google account, not your channel account." icon={Users}>
      {accounts.length === 0 && <p className="text-sm text-muted">No account yet. Add one, then press Sign in.</p>}
      <ul className="flex flex-col gap-2">
        {accounts.map((account) => (
          <AccountRow key={account.id} account={account} actions={actions} />
        ))}
      </ul>
      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          add();
        }}
      >
        <TextInput value={name} onChange={(event) => setName(event.target.value)} placeholder="Name, for example Account 1" aria-label="New account name" maxLength={40} />
        <Button type="submit" icon={Plus} disabled={name.trim() === ""}>
          Add account
        </Button>
      </form>
      {error && <ErrorNotice error={error} />}
      {testing && <TestImageModal accountId={testing.id} accountName={testing.name} onClose={() => setTesting(null)} />}
      {peeking && <BackgroundBrowserModal accountId={peeking.id} accountName={peeking.name} onClose={() => setPeeking(null)} />}
    </Card>
  );
}
