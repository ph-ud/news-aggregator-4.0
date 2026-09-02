/**
 * The browser's password manager as a source for the passphrase.
 *
 * ChatGPT Atlas is Chromium with its own password store, and it imports the reader's existing
 * passwords; agent mode is explicitly denied access to that store and to autofill. So the
 * password manager is the one component in an agentic browser that can hand this page a
 * passphrase without the agent ever seeing it — which is exactly the boundary this app needs.
 * The reader picks a credential in browser-native UI, the page derives the keys locally, and
 * nothing about the secret reaches a tool call, a model, or the server.
 *
 * Two things this module is built around:
 *
 * - **Every call is best-effort.** `window.PasswordCredential` existing does not mean a store
 *   is reachable: an embedded or headless Chromium rejects `get()`, `store()`, and even
 *   `preventSilentAccess()` with NotSupportedError. Nothing here may throw, and nothing may
 *   block a sign-in — a failure only means the reader types the passphrase, as before.
 * - **Nothing is retrieved without the reader asking.** Silent retrieval on load would let
 *   anything that can open the page — an agent included — walk into an unlocked library.
 *   Retrieval is bound to a button the person presses, and `mediation: 'optional'` keeps the
 *   account chooser in browser UI the page cannot script.
 */

/** Reading a saved credential is the reader's gesture, never automatic. */
export const RETRIEVAL_MEDIATION = 'optional';

function container(scope) {
  return typeof scope?.PasswordCredential === 'function' && scope?.navigator?.credentials ? scope.navigator.credentials : null;
}

/** True when this browser has a password store the page may offer to use. */
export function credentialsAvailable(scope = globalThis) { return Boolean(container(scope)); }

/**
 * Offer the credential to the password manager, so the browser can fill it next time.
 * Call it after every successful sign-in, sign-up, and passphrase change — a stale saved
 * passphrase is worse than none, because autofill would then quietly fail to unlock.
 */
export async function rememberCredential({ email, name = '', passphrase }, scope = globalThis) {
  const credentials = container(scope);
  if (!credentials || !email || !passphrase) return 'unsupported';
  try {
    await credentials.store(new scope.PasswordCredential({ id: email, password: passphrase, name: name || email }));
    return 'stored';
  } catch { /* No store in this browser, or the reader declined. Neither is an error here. */ return 'failed'; }
}

/**
 * Ask the browser for a saved credential. Returns null whenever there is nothing to use —
 * no store, nothing saved, the reader dismissed the chooser, or a credential with no password
 * (a federated or passkey entry). The caller falls back to the form.
 */
export async function savedCredential(scope = globalThis) {
  const credentials = container(scope);
  if (!credentials) return null;
  try {
    const credential = await credentials.get({ password: true, mediation: RETRIEVAL_MEDIATION });
    if (!credential || typeof credential.password !== 'string' || !credential.password || !credential.id) return null;
    return { email: credential.id, passphrase: credential.password };
  } catch { return null; }
}

/**
 * After a sign-out, the browser must not hand the next page load a credential on its own.
 * This is what keeps signing out meaningful on a shared or agent-driven browser.
 */
export async function forgetSilentAccess(scope = globalThis) {
  const credentials = container(scope);
  if (!credentials?.preventSilentAccess) return;
  try { await credentials.preventSilentAccess(); } catch { /* nothing to prevent */ }
}
