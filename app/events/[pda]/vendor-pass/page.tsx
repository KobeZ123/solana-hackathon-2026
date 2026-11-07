import { VendorPassView } from "./vendor-pass-view";

export const metadata = { title: "Vendor pass | Event Pool" };

export default async function VendorPassPage({
  params,
}: {
  params: Promise<{ pda: string }>;
}) {
  const { pda } = await params;
  return <VendorPassView pda={pda} />;
}
