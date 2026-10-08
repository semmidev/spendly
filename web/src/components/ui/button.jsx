import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva } from "class-variance-authority";

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-transparent bg-clip-padding text-[17px] font-semibold whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg]:inline-block [&_svg]:align-middle [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        outline:
          "border-border bg-card text-primary hover:bg-secondary aria-expanded:bg-secondary",
        secondary:
          "bg-secondary text-foreground hover:bg-secondary/70 aria-expanded:bg-secondary",
        ghost:
          "text-primary hover:bg-secondary aria-expanded:bg-secondary",
        destructive:
          "bg-destructive text-white hover:bg-destructive/90 focus-visible:border-destructive/40 focus-visible:ring-destructive/20",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-[50px] gap-2 px-4 py-2",
        xs: "h-7 gap-1.5 rounded-lg px-2.5 text-[13px] font-medium",
        sm: "h-9 gap-1.5 rounded-[10px] px-3 text-[15px] font-semibold",
        lg: "h-[50px] gap-2 px-5 text-[17px] font-semibold",
        icon: "size-11 rounded-xl flex items-center justify-center",
        "icon-xs":
          "size-7 rounded-lg flex items-center justify-center",
        "icon-sm":
          "size-8 rounded-[10px] flex items-center justify-center",
        "icon-lg": "size-11 rounded-xl flex items-center justify-center",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

import * as React from "react"

function Button({
  className,
  variant = "default",
  size = "default",
  asChild,
  render,
  children,
  ...props
}) {
  const renderProp = render || (asChild && React.isValidElement(children) ? children : undefined);
  const childrenProp = asChild && React.isValidElement(children) ? undefined : children;

  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      render={renderProp}
      {...(renderProp ? { nativeButton: false } : {})}
      {...props}
    >
      {childrenProp}
    </ButtonPrimitive>
  );
}

export { Button, buttonVariants }
