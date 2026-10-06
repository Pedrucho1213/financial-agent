import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

// Estilos de botón de iOS: relleno, tintado, gris y sin fondo.
export const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap font-semibold select-none transition-[transform,opacity,background-color] duration-150 ease-ios active:scale-[0.97] active:opacity-80 disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-5",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground",
        tinted: "bg-primary/15 text-tint",
        gray: "bg-fill text-tint",
        plain: "text-tint active:scale-100 active:opacity-50",
        destructive: "bg-destructive text-destructive-foreground",
        "destructive-tinted": "bg-destructive/15 text-destructive",
        "destructive-plain": "text-destructive active:scale-100 active:opacity-50",
      },
      size: {
        default: "h-11 rounded-xl px-4 text-[17px]",
        lg: "h-[50px] w-full rounded-xl px-5 text-[17px]",
        sm: "h-[34px] rounded-full px-3.5 text-[15px]",
        icon: "size-11 rounded-full",
        "icon-sm": "size-8 rounded-full [&_svg:not([class*='size-'])]:size-[18px]",
        text: "h-11 px-1 text-[17px] font-normal",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export type ButtonProps = ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean };

export function Button({ className, variant, size, asChild = false, type, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp
      data-slot="button"
      type={asChild ? undefined : (type ?? "button")}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}
