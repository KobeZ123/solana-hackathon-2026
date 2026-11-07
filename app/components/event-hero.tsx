import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeftIcon } from "./icons";

/** Stable 0..1 values from a string, so every event gets its own (repeatable) atmosphere. */
function seeded(seed: string, i: number): number {
  let h = 2166136261 ^ (i * 16777619);
  for (let k = 0; k < seed.length; k++) {
    h ^= seed.charCodeAt(k);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}

/**
 * Image-led header for an event. With a cover URL it shows the photo; without one it paints a
 * deterministic lavender/mint glow over the grid texture so cards never look empty.
 */
export function EventHero({
  seed,
  coverUrl,
  backHref = "/",
  children,
}: {
  seed: string;
  coverUrl?: string | null;
  backHref?: string;
  /** Overlays pinned to the bottom-left (status pills). */
  children?: ReactNode;
}) {
  const x1 = 10 + Math.round(seeded(seed, 1) * 60);
  const y1 = 5 + Math.round(seeded(seed, 2) * 50);
  const x2 = 40 + Math.round(seeded(seed, 3) * 55);
  const y2 = 50 + Math.round(seeded(seed, 4) * 50);
  const mintShare = 0.14 + seeded(seed, 5) * 0.16;

  return (
    <div className="relative isolate aspect-[16/10] w-full overflow-hidden bg-surface sm:aspect-[16/7]">
      {coverUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={coverUrl}
          alt=""
          className="absolute inset-0 size-full object-cover"
        />
      ) : (
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            backgroundImage: [
              `radial-gradient(60% 80% at ${x1}% ${y1}%, rgba(191,165,237,0.5), transparent 70%)`,
              `radial-gradient(55% 70% at ${x2}% ${y2}%, rgba(165,211,178,${mintShare}), transparent 70%)`,
              "linear-gradient(rgba(255,255,255,0.045) 1px, transparent 1px)",
              "linear-gradient(90deg, rgba(255,255,255,0.045) 1px, transparent 1px)",
            ].join(","),
            backgroundSize: "auto, auto, 36px 36px, 36px 36px",
          }}
        />
      )}
      {/* readable edge for overlays + a smooth seam into the card body */}
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-t from-surface via-surface/10 to-black/30"
      />
      <Link
        href={backHref}
        aria-label="Back to events"
        className="absolute top-4 left-4 flex size-10 items-center justify-center rounded-full border border-white/10 bg-black/40 text-foreground backdrop-blur transition hover:bg-black/60"
      >
        <ArrowLeftIcon />
      </Link>
      {children && (
        <div className="absolute bottom-4 left-5 flex flex-wrap items-center gap-2 sm:left-7">
          {children}
        </div>
      )}
    </div>
  );
}
