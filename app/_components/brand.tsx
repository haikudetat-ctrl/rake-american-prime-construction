import Image from "next/image";
import logo from "@/public/brand/american-prime-logo.png";
import mark from "@/public/brand/american-prime-mark.png";

/** Full American Prime Construction logo on a white plate (it is navy, so it needs a light ground). */
export function BrandLogo({ className = "", plate = true }: { className?: string; plate?: boolean }) {
  return (
    <span className={`block ${plate ? "rounded-md bg-white px-3 py-2.5" : ""} ${className}`}>
      <Image src={logo} alt="American Prime Construction" className="h-auto w-full" priority />
    </span>
  );
}

/**
 * Dark top bar for customer-facing and field pages: the roof mark plus the
 * business name, with an optional link or control on the right.
 */
export function BrandBar({ name, children }: { name?: string | null; children?: React.ReactNode }) {
  return (
    <header className="bg-ink text-white">
      <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 py-3">
        <span className="flex min-w-0 items-center gap-2.5">
          <span className="flex shrink-0 rounded bg-white px-1.5 py-1">
            <Image src={mark} alt="" className="h-7 w-auto" priority />
          </span>
          <span className="truncate font-display text-base font-bold tracking-wide uppercase sm:text-xl">
            {name ?? "American Prime"}
          </span>
        </span>
        {children}
      </div>
    </header>
  );
}
