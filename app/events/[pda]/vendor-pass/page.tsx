import { VendorPassView } from "./vendor-pass-view";

export const metadata = { title: "Vendor pass | SOLSocial" };

export default async function VendorPassPage({
  params,
}: {
  params: Promise<{ pda: string }>;
}) {
  const { pda } = await params;
  return <VendorPassView pda={pda} />;
}
