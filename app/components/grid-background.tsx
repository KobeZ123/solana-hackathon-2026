"use client";

export function GridBackground() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0" aria-hidden="true">
      {/* Ambient glow */}
      <div
        className="absolute inset-0 transition-opacity duration-500"
        style={{
          background: [
            "radial-gradient(ellipse 30% 28% at 30% 50%, rgba(214,185,136,0.07) 0%, transparent 70%)",
            "radial-gradient(ellipse 30% 28% at 70% 50%, rgba(220,224,226,0.04) 0%, transparent 70%)",
          ].join(", "),
        }}
      />

      {/* Large grid — champagne (left) */}
      <div
        className="absolute inset-0 opacity-80 dark:opacity-60"
        style={{
          backgroundImage: `
            linear-gradient(to right, rgba(214,185,136,0.18) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(214,185,136,0.18) 1px, transparent 1px)
          `,
          backgroundSize: "80px 80px",
          mask: "radial-gradient(ellipse 30% 35% at 30% 50%, black, transparent)",
          WebkitMask:
            "radial-gradient(ellipse 30% 35% at 30% 50%, black, transparent)",
        }}
      />

      {/* Large grid — chrome (right) */}
      <div
        className="absolute inset-0 opacity-80 dark:opacity-60"
        style={{
          backgroundImage: `
            linear-gradient(to right, rgba(220,224,226,0.10) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(220,224,226,0.10) 1px, transparent 1px)
          `,
          backgroundSize: "80px 80px",
          mask: "radial-gradient(ellipse 30% 35% at 70% 50%, black, transparent)",
          WebkitMask:
            "radial-gradient(ellipse 30% 35% at 70% 50%, black, transparent)",
        }}
      />

      {/* Small grid — champagne (left) */}
      <div
        className="absolute inset-0 opacity-80 dark:opacity-60"
        style={{
          backgroundImage: `
            linear-gradient(to right, rgba(214,185,136,0.10) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(214,185,136,0.10) 1px, transparent 1px)
          `,
          backgroundSize: "16px 16px",
          mask: "radial-gradient(ellipse 30% 35% at 30% 50%, black, transparent)",
          WebkitMask:
            "radial-gradient(ellipse 30% 35% at 30% 50%, black, transparent)",
        }}
      />

      {/* Small grid — chrome (right) */}
      <div
        className="absolute inset-0 opacity-80 dark:opacity-60"
        style={{
          backgroundImage: `
            linear-gradient(to right, rgba(220,224,226,0.10) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(220,224,226,0.10) 1px, transparent 1px)
          `,
          backgroundSize: "16px 16px",
          mask: "radial-gradient(ellipse 30% 35% at 70% 50%, black, transparent)",
          WebkitMask:
            "radial-gradient(ellipse 30% 35% at 70% 50%, black, transparent)",
        }}
      />
    </div>
  );
}
