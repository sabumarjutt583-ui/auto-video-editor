import { Modal } from "../../ui";
import { AnalyzeForm } from "./AnalyzeForm";
import { ReviewForm } from "./ReviewForm";
import { useStyleCreator, type CreatorStart } from "./useStyleCreator";
import type { StyleProfile } from "../../../types";

interface CreateStyleModalProps {
  start: CreatorStart;
  onSaved: (style: StyleProfile) => void;
  onClose: () => void;
  /** Close this window and open the by-hand form (only when creating). */
  onManual?: () => void;
}

/** "Create custom style": pictures -> the AI writes the style -> review and edit -> save. Also used to edit and re-analyze. */
export function CreateStyleModal({ start, onSaved, onClose, onManual }: CreateStyleModalProps) {
  const creator = useStyleCreator(start, onSaved);
  const title = creator.editing ? (creator.step === "review" ? "Edit custom style" : "Re-analyze custom style") : creator.step === "review" ? "Review the new style" : "Create custom style";
  return (
    <Modal title={title} wide onClose={creator.busy ? () => undefined : onClose}>
      {creator.step === "form" || !creator.draft ? <AnalyzeForm creator={creator} onManual={creator.editing ? undefined : onManual} onCancel={onClose} /> : <ReviewForm creator={creator} onCancel={onClose} />}
    </Modal>
  );
}
