"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import { useWallet } from "../wallet/context";
import {
  getToken,
  clearSession,
  signInWithWallet,
  subscribeSession,
} from "../api-client";

/**
 * Wallet sign-in for the API. One signature popup per session (12 h JWT);
 * the token is shared between all components via the api-client store.
 */
export function useAuth() {
  const { wallet } = useWallet();
  const address = wallet?.account.address;

  const token = useSyncExternalStore(
    subscribeSession,
    () => (address ? getToken(address) : null),
    () => null
  );

  const [isSigningIn, setIsSigningIn] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  /** Sign in (prompts the wallet to sign). Resolves with the JWT. */
  const signIn = useCallback(async (): Promise<string> => {
    if (!wallet) throw new Error("Connect a wallet first");
    if (!wallet.signMessage) {
      throw new Error("This wallet does not support message signing");
    }
    setIsSigningIn(true);
    setError(null);
    try {
      return await signInWithWallet(wallet.account.address, wallet.signMessage);
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      setError(e);
      throw e;
    } finally {
      setIsSigningIn(false);
    }
  }, [wallet]);

  /** Existing valid token for this wallet, or sign in. */
  const ensureToken = useCallback(async (): Promise<string> => {
    const existing = address ? getToken(address) : null;
    return existing ?? signIn();
  }, [address, signIn]);

  const signOut = useCallback(() => clearSession(), []);

  return {
    token,
    isAuthenticated: token !== null,
    isSigningIn,
    error,
    signIn,
    ensureToken,
    signOut,
  };
}
