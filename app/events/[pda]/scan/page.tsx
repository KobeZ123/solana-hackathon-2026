import { Scanner } from "./scanner";

export const metadata = { title: "Scanner | SOLSocial" };

export default async function ScanPage({
  params,
}: {
  params: Promise<{ pda: string }>;
}) {
  const { pda } = await params;
  return <Scanner pda={pda} />;
}
