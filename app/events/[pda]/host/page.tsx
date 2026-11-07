import { HostDashboard } from "./host-dashboard";

export const metadata = { title: "Host dashboard | SOLSocial" };

export default async function HostPage({
  params,
}: {
  params: Promise<{ pda: string }>;
}) {
  const { pda } = await params;
  return <HostDashboard pda={pda} />;
}
