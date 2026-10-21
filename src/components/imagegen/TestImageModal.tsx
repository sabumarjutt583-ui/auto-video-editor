import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { toAppError } from "../../lib/errors";
import { imagegenTestImage } from "../../lib/imagegen/api";
import type { AppError } from "../../types";
import type { TestImage } from "../../types/imagegen";
import { ErrorNotice } from "../ErrorNotice";
import { Button, Modal } from "../ui";

/** Makes one real picture with the account, to prove that it works. */
export function TestImageModal({ accountId, accountName, onClose }: { accountId: string; accountName: string; onClose: () => void }) {
  const [image, setImage] = useState<TestImage | null>(null);
  const [error, setError] = useState<AppError | null>(null);

  useEffect(() => {
    let live = true;
    imagegenTestImage(accountId)
      .then((result) => live && setImage(result))
      .catch((failure: unknown) => live && setError(toAppError(failure, "The test picture could not be made.")));
    return () => {
      live = false;
    };
  }, [accountId]);

  return (
    <Modal title={`Test picture: ${accountName}`} onClose={onClose}>
      {!image && !error && (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Loader2 size={16} aria-hidden className="animate-spin" /> Making one picture. This can take up to a minute.
        </p>
      )}
      {image && (
        <>
          <img src={image.dataUrl} alt="Test result" className="w-full rounded-lg border border-line" />
          <p className="text-sm text-success">It works. Size {image.width} x {image.height}.</p>
        </>
      )}
      {error && <ErrorNotice error={error} />}
      <div className="flex justify-end">
        <Button onClick={onClose}>Close</Button>
      </div>
    </Modal>
  );
}
