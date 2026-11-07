import { apiFetch, apiJson } from "../api-client";

/** Mirrors the server's `VendorView` / `OfferView` (app/lib/server/vendors.ts). */
export type ApiVendor = {
  wallet: string;
  name: string;
  logoUrl: string | null;
  description: string;
  vendorKey: string | null;
  updatedAt: string;
};

export type ApiOffer = {
  eventPda: string;
  vendor: string;
  /** Lamports, decimal string. */
  amount: string;
  status: "proposed" | "approved" | "delivered" | "paid" | "rejected";
  offerHash: string;
  offerText: string | null;
  offerVerified: boolean;
  vendorProfile: {
    name: string;
    logoUrl: string | null;
    description: string;
  } | null;
};

/** POST /api/vendors (JWT). Requires the on-chain VendorProfile to exist. */
export function postVendor(body: {
  name: string;
  logoUrl?: string;
  description?: string;
}): Promise<ApiVendor> {
  return apiJson<ApiVendor>("/api/vendors", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** GET /api/vendors/[wallet]; null when the API has no profile (404). */
export async function fetchVendor(wallet: string): Promise<ApiVendor | null> {
  const res = await apiFetch(`/api/vendors/${wallet}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Vendor request failed (${res.status})`);
  return (await res.json()) as ApiVendor;
}

/** POST /api/events/[pda]/offers (JWT vendor); text must hash to the on-chain offer_hash. */
export function postOffer(pda: string, text: string): Promise<ApiOffer> {
  return apiJson<ApiOffer>(`/api/events/${pda}/offers`, {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

/** GET /api/events/[pda]/offers (JWT host or vendor). */
export async function fetchOffers(pda: string): Promise<ApiOffer[]> {
  const body = await apiJson<{ offers: ApiOffer[] }>(
    `/api/events/${pda}/offers`
  );
  return body.offers;
}
