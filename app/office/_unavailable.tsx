import { Unavailable as UnavailableCallout } from "@/app/_ui/states";

/**
 * A whole workspace page that could not load (Figma 39B, 88): the page keeps its title so
 * people know where they are, and says plainly that nothing is shown rather than showing
 * zero balances or an empty schedule.
 */
export function Unavailable({ area = "Subcontracting" }: { area?: string }) {
  return (
    <>
      <header className="space-y-1">
        <p className="eyebrow">Subcontracting</p>
        <h1 className="page-title">{area}</h1>
      </header>
      <UnavailableCallout area={area}>
        We couldn’t load this workspace. Reload to try again. If it keeps happening, ask an owner to check the connection.
      </UnavailableCallout>
    </>
  );
}
