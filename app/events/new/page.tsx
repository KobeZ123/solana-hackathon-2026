import { CreateEventForm } from "./create-event-form";

export const metadata = { title: "Create event | Event Pool" };

export default function NewEventPage() {
  return (
    <div className="mx-auto w-full max-w-xl">
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
        Create event
      </h1>
      <p className="mt-3 mb-6 text-sm leading-relaxed text-foreground/60">
        Set the entry fee, capacity, schedule and attendee payout, then publish
        your event on Solana.
      </p>
      <CreateEventForm />
    </div>
  );
}
