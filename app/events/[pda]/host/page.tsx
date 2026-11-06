import { PageStub } from "../../../components/page-stub";

export const metadata = { title: "Host dashboard | Event Pool" };

export default async function HostPage({
  params,
}: {
  params: Promise<{ pda: string }>;
}) {
  const { pda } = await params;
  return (
    <PageStub
      title="Host dashboard"
      pda={pda}
      description="Live pool, ticket and check-in counts, plus end, cancel and withdraw actions."
      ticket="T26"
    />
  );
}
