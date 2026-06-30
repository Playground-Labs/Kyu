import * as React from "react";
import { cn } from "@/lib/utils";

const base =
  "inline-flex h-9 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-full px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 active:translate-y-px [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0";

const variants = {
  default: "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90",
  ghost: "hover:bg-accent hover:text-accent-foreground",
};

const sizes = {
  default: "h-9 px-4",
  sm: "h-8 px-3 text-xs",
  icon: "size-9 p-0",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", ...props }, ref) => (
    <button className={cn(base, variants[variant], sizes[size], className)} ref={ref} {...props} />
  ),
);
Button.displayName = "Button";

export { Button };
