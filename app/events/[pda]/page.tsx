import Link from "next/link";
import { PageStub } from "../../components/page-stub";

export const metadata = { title: "Event | Event Pool" };

const SECTIONS = [
  { slug: "ticket", label: "My ticket" },
  { slug: "claim", label: "Claim / refund" },
  { slug: "host", label: "Host dashboard" },
  { slug: "scan", label: "Scanner" },
];

export default async function EventPage({
  params,
}: {
  params: Promise<{ pda: string }>;
}) {
  const { pda } = await params;
  return (
    <PageStub
      title="Event"
      pda={pda}
      description="Event summary, join action and gated details for ticket holders."
      ticket="T23"
    >
      <ul className="mt-4 grid grid-cols-2 gap-2">
        {SECTIONS.map((s) => (
          <li key={s.slug}>
            <Link
              href={`/events/${pda}/${s.slug}`}
              className="flex h-12 items-center justify-center rounded-xl border border-border-low bg-card text-sm font-medium transition hover:bg-cream"
            >
              {s.label}
            </Link>
          </li>
        ))}
      </ul>
    </PageStub>
  );
}
