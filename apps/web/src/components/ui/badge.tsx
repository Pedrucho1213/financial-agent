import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

const badgeVariants = cva(
  "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-[3px] text-[12px] leading-none font-semibold whitespace-nowrap [&_svg]:size-3",
  {
    variants: {
      variant: {
        default: "bg-primary/15 text-tint",
        secondary: "bg-fill text-muted-foreground",
        warning: "bg-warning text-warning-foreground",
        positive: "bg-positive/15 text-positive",
      },
    },
    defaultVariants: { variant: "secondary" },
  },
);

export function Badge({ className, variant, ...props }: ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}
