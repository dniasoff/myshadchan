import { useTranslate } from "ra-core";
import { cn } from "@/lib/utils";
import type { CallStatus } from "../types";
import { getCallStatusDescriptor } from "./callStatus";

/**
 * The call-status chip (FR40). Lifted from the design canvas, where it was the
 * best-modelled piece of the reference workspace, and re-parented onto the real
 * entity so every surface renders a status the same way.
 */
export const CallStatusChip = ({
  status,
  className,
}: {
  status?: CallStatus | string | null;
  className?: string;
}) => {
  const translate = useTranslate();
  const descriptor = getCallStatusDescriptor(status);

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        descriptor.className,
        className,
      )}
    >
      {translate(descriptor.labelKey, { _: descriptor.label })}
    </span>
  );
};
