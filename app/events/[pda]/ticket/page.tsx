import { TicketView } from "./ticket-view";

export const metadata = { title: "My ticket | Event Pool" };

export default async function TicketPage({
  params,
}: {
  params: Promise<{ pda: string }>;
}) {
  const { pda } = await params;
  return <TicketView pda={pda} />;
}
