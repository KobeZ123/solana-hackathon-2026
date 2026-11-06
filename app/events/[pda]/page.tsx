import { EventView } from "./event-view";

export const metadata = { title: "Event | Event Pool" };

export default async function EventPage({
  params,
}: {
  params: Promise<{ pda: string }>;
}) {
  const { pda } = await params;
  return <EventView pda={pda} />;
}
