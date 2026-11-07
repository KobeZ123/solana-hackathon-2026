import { ClaimView } from "./claim-view";

export const metadata = { title: "Claim or refund | Event Pool" };

export default async function ClaimPage({
  params,
}: {
  params: Promise<{ pda: string }>;
}) {
  const { pda } = await params;
  return <ClaimView pda={pda} />;
}
