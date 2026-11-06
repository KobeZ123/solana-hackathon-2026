import { PageStub } from "../components/page-stub";

export const metadata = { title: "My tickets | Event Pool" };

export default function TicketsPage() {
  return (
    <PageStub
      title="My tickets"
      description="Events you have joined, with your ticket, claim and refund actions."
      ticket="T27"
    />
  );
}
