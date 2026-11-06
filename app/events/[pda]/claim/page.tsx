import { PageStub } from "../../../components/page-stub";

export const metadata = { title: "Claim or refund | Event Pool" };

export default async function ClaimPage({
  params,
}: {
  params: Promise<{ pda: string }>;
}) {
  const { pda } = await params;
  return (
    <PageStub
      title="Claim or refund"
      pda={pda}
      description="Claim your attendee payout after the event, or get a refund if it was cancelled."
      ticket="T27"
    />
  );
}
