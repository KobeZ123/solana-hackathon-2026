import { PageStub } from "../../../components/page-stub";

export const metadata = { title: "My ticket | Event Pool" };

export default async function TicketPage({
  params,
}: {
  params: Promise<{ pda: string }>;
}) {
  const { pda } = await params;
  return (
    <PageStub
      title="My ticket"
      pda={pda}
      description="Your rotating check-in QR code. Keep this screen open at the door."
      ticket="T24"
    />
  );
}
