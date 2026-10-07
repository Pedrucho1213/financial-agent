import { Switch as SwitchPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

/** Interruptor de iOS (51×31, verde al encender). */
export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "relative inline-flex h-[31px] w-[51px] shrink-0 items-center rounded-full bg-fill-strong p-0.5 transition-colors duration-200 data-[state=checked]:bg-[#34c759] disabled:opacity-50 dark:data-[state=checked]:bg-[#30d158]",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block size-[27px] rounded-full bg-white shadow-[0_3px_8px_rgb(0_0_0/0.15),0_3px_1px_rgb(0_0_0/0.06)] transition-transform duration-300 ease-ios data-[state=checked]:translate-x-5" />
    </SwitchPrimitive.Root>
  );
}
