import { PageStub } from "../../../components/page-stub";

export const metadata = { title: "Scanner | Event Pool" };

export default async function ScanPage({
  params,
}: {
  params: Promise<{ pda: string }>;
}) {
  const { pda } = await params;
  return (
    <PageStub
      title="Scanner"
      pda={pda}
      description="Set up your gate key and scan attendee QR codes to check them in."
      ticket="T25"
    />
  );
}
