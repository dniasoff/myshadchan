import * as React from "react"
import * as SwitchPrimitive from "@radix-ui/react-switch"

import { cn } from "@/lib/utils"

function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        // The pill is 18.4px tall by design and must stay that way — it is
        // roughly a third of the 44px minimum touch target, which on a phone
        // makes every toggle in Settings, the listing form and the share
        // dialog a coin-flip to hit. The fix is a transparent `::before`
        // extension rather than a bigger pill: hit-testing on a pseudo-element
        // resolves to its originating element, so the switch becomes ~46x48px
        // to a finger while rendering identically. Do NOT "simplify" this into
        // `min-h-11` — that would stretch the pill itself and break the
        // thumb's `translate-x-[calc(100%-2px)]` geometry. `md:before:hidden`
        // mirrors the `md:` half of the `min-h-11 md:min-h-9` idiom: a mouse
        // does not need the halo, and an invisible one that outlives the
        // phone would sit over whatever is 8px to the side of the pill.
        "relative before:absolute before:-inset-y-3.5 before:-inset-x-2 before:content-[''] md:before:hidden",
        "peer data-[state=checked]:bg-primary data-[state=unchecked]:bg-input focus-visible:border-ring focus-visible:ring-ring/50 dark:data-[state=unchecked]:bg-input/80 inline-flex h-[1.15rem] w-8 shrink-0 items-center rounded-full border border-transparent shadow-xs transition-all outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "bg-background dark:data-[state=unchecked]:bg-foreground dark:data-[state=checked]:bg-primary-foreground pointer-events-none block size-4 rounded-full ring-0 transition-transform data-[state=checked]:translate-x-[calc(100%-2px)] data-[state=unchecked]:translate-x-0"
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
