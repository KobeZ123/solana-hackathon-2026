import { Scanner } from "./scanner";

export const metadata = { title: "Scanner | Event Pool" };

export default async function ScanPage({
  params,
}: {
  params: Promise<{ pda: string }>;
}) {
  const { pda } = await params;
  return <Scanner pda={pda} />;
}
