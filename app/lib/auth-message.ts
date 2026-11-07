/**
 * Sign-in-with-wallet message. Shared by the client (which signs it) and the server
 * (which verifies it): both MUST use this function so the signed bytes are identical.
 *
 * Format (exact, UTF-8, no trailing newline):
 *   `Sign in to SOLSocial: ${nonce}`
 */
export const SIGN_IN_PREFIX = "Sign in to SOLSocial: ";

export function buildSignInMessage(nonce: string): string {
  return `${SIGN_IN_PREFIX}${nonce}`;
}
