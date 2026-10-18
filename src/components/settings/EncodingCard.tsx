import { Cpu } from "lucide-react";
import { useEffect, useState } from "react";

import { listEncoders, type EncoderInfo } from "../../lib/render/api";
import type { AppSettings } from "../../types";
import { Card, Checkbox } from "../ui";

interface EncodingCardProps {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
}

/** Which video encoder the render uses: the graphics card when it works, or always the CPU. */
export function EncodingCard({ settings, onChange }: EncodingCardProps) {
  const [encoders, setEncoders] = useState<EncoderInfo[] | null>(null);
  useEffect(() => {
    let stale = false;
    listEncoders().then((list) => !stale && setEncoders(list)).catch(() => !stale && setEncoders([]));
    return () => {
      stale = true;
    };
  }, []);
  const gpu = encoders?.find((e) => e.gpu);
  return (
    <Card title="Video encoding" description="A graphics card makes rendering much faster. The app tests it at startup and uses it when it works." icon={Cpu}>
      <p className="text-sm" data-testid="encoder-status">
        {encoders === null ? "Checking this computer…" : gpu ? `Graphics-card encoder found: ${gpu.label}.` : "No graphics-card encoder found. The CPU will be used."}
      </p>
      <Checkbox label="Always use the CPU (slower, but works the same everywhere)" checked={settings.forceCpuEncoding} onChange={(e) => onChange({ forceCpuEncoding: e.target.checked })} />
    </Card>
  );
}
