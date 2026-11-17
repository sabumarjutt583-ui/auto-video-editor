import { useRef, useState } from "react";
import { Button } from "../ui";
import {
  exportStudioConfig, importStudioConfig, parseStudioError, studioOperationId,
} from "../../lib/script/studio/api.ts";
import type {
  ChannelStudioConfigV1, LegacyChannelSeed, StudioBackupV1, StudioAccountMetadata,
} from "../../lib/script/studio/types.ts";

interface Props {
  seed: LegacyChannelSeed;
  config: ChannelStudioConfigV1;
  claude: readonly StudioAccountMetadata[];
  chatgpt: readonly StudioAccountMetadata[];
  onImported: (value: ChannelStudioConfigV1) => void;
}
const cn = "w-full rounded border border-line bg-surface p-2 text-sm";
export function StudioBackupPanel({seed,config,claude,chatgpt,onImported}:Props) {
  const [exportText,setExportText]=useState("");
  const [importText,setImportText]=useState("");
  const [writerAccount,setWriterAccount]=useState("");
  const [reviewAccount,setReviewAccount]=useState("");
  const [confirm,setConfirm]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const retry=useRef<{key:string;operationId:string}|null>(null);

  async function exportOffline(){
    setBusy(true);setError("");setNotice("");
    try{
      const backup=await exportStudioConfig(seed);
      setExportText(JSON.stringify(backup,null,2));
      setNotice("Offline configuration JSON prepared. It includes private prompt text; keep your backup secure.");
    }catch(caught){
      setError(parseStudioError(caught)?.message ?? "Could not export local Studio settings.");
    }finally{setBusy(false);}
  }
  async function copyBackup(){
    if(!exportText) return;
    try{
      await navigator.clipboard.writeText(exportText);
      setNotice("Local configuration backup copied; keep its prompt text private.");
    }catch{
      setError("Clipboard access failed. Select and copy the JSON manually from the text box.");
    }
  }
  async function importOffline(){
    if(!confirm || config.revision!==0) {
      setError("Import requires explicit confirmation and a target channel without saved Studio settings.");
      return;
    }
    setBusy(true);setError("");setNotice("");
    try{
      if(importText.length>1_048_576)throw new Error("Backup JSON exceeds the size limit.");
      const parsed:unknown=JSON.parse(importText);
      if(!parsed || typeof parsed!=="object" || Array.isArray(parsed))throw new Error("Backup must be a JSON object.");
      const value=parsed as Partial<StudioBackupV1>;
      if(value.backupVersion!==1 || typeof value.sourceChannelId!=="string"
        || !value.config || value.config.schemaVersion!==1
        || value.config.channelId!==value.sourceChannelId) {
        throw new Error("Only validated Script Studio backup version 1 can be imported.");
      }
      // Account references are optionally explicitly rebound before Rust
      // ownership/identity validation. No browser profile or credential is copied.
      const configCopy:ChannelStudioConfigV1=JSON.parse(JSON.stringify(value.config)) as ChannelStudioConfigV1;
      if(writerAccount){
        configCopy.accounts.claudeAccountId=writerAccount;
        configCopy.accounts.allowedClaudeAccountIds=[writerAccount];
        configCopy.skills=configCopy.skills.map(skill=>({
          ...skill,claudeAccountId:writerAccount,
        }));
      }
      if(reviewAccount){
        configCopy.accounts.chatgptReviewAccountId=reviewAccount;
        configCopy.accounts.allowedChatgptAccountIds=[reviewAccount];
      }
      const backup:StudioBackupV1={backupVersion:1,sourceChannelId:value.sourceChannelId,config:configCopy};
      const key=JSON.stringify([seed.channelId,backup]);
      if(retry.current?.key!==key)retry.current={key,operationId:studioOperationId("import")};
      const result=await importStudioConfig(seed,backup,retry.current.operationId);
      onImported(result);retry.current=null;
      setConfirm(false);
      setNotice("Imported an independent channel-owned Studio configuration. No credentials or scripts were copied.");
    }catch(caught){
      setError(parseStudioError(caught)?.message ??
        (caught instanceof SyntaxError ? "Invalid backup JSON." :
          caught instanceof Error ? caught.message : "Studio import failed without changing existing records."));
    }finally{setBusy(false);}
  }
  return (
    <section className="rounded border border-line p-3 space-y-2" aria-label="Offline channel Studio configuration backup">
      <h4 className="font-semibold">Configuration Backup — Offline</h4>
      <p className="text-xs text-muted">Export includes master/reviewer prompt text and Skill/account IDs but no cookies,
        passwords, tokens, API keys or browser profile files. Keep the JSON private.</p>
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      {notice && <p role="status" className="text-xs text-muted">{notice}</p>}
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} onClick={() => void exportOffline()}>Export current channel configuration</Button>
        <Button disabled={busy || !exportText} onClick={() => void copyBackup()}>Copy backup JSON</Button>
      </div>
      {exportText && <textarea className={cn} readOnly rows={6} value={exportText}
        aria-label="Exported Studio configuration JSON"/>}
      <p className="text-xs text-muted">Import explicitly rebinds the backup to the currently selected channel.
        It never overwrites an existing saved Studio configuration.</p>
      {config.revision!==0 && <p className="text-xs text-muted">
        This channel already has saved Studio configuration (revision {config.revision}).
        Import into a separate new channel or use the normal editor; overwrite is prohibited.
      </p>}
      <label className="block text-xs">Paste Studio backup JSON
        <textarea className={cn} rows={7} value={importText} maxLength={1_048_576}
          onChange={e => {setImportText(e.target.value);setConfirm(false);}}/>
      </label>
      <label className="block text-xs">Explicitly rebind all imported Claude account references to (optional)
        <select className={cn} value={writerAccount} onChange={e => setWriterAccount(e.target.value)}>
          <option value="">Keep existing IDs and validate them</option>
          {claude.map(account => <option key={account.id} value={account.id}>{account.name} ({account.id})</option>)}
        </select>
      </label>
      <label className="block text-xs">Explicitly rebind the reviewer ChatGPT account to (optional)
        <select className={cn} value={reviewAccount} onChange={e => setReviewAccount(e.target.value)}>
          <option value="">Keep existing ID and validate it</option>
          {chatgpt.map(account => <option key={account.id} value={account.id}>{account.name} ({account.id})</option>)}
        </select>
      </label>
      <label className="flex gap-2 text-xs"><input type="checkbox" checked={confirm}
        onChange={e => setConfirm(e.target.checked)}/>
        I approve importing this JSON into channel {seed.channelId}. Imported Skill confirmations will be reset
        to locally registered (not provider verified).
      </label>
      <Button disabled={busy || config.revision!==0 || !confirm || !importText.trim()}
        onClick={() => void importOffline()}>Import and explicitly rebind channel ownership</Button>
    </section>
  );
}
