/**
 * The WebMCP login tools.
 *
 * An assistant may ask for a sign-in; it must never perform one. The passphrase derives the
 * key that decrypts the library, so it cannot travel through a tool argument, a model, or a
 * transcript — these tools therefore carry no credential field and must never gain one.
 * What they do instead is a handoff: put the right form in front of the person at the
 * keyboard, prefill only what the server already knows (their email, their display name),
 * and wait for them to finish.
 *
 * The tools are built here rather than in `app.js` so that the shape of the login surface —
 * above all the absence of a passphrase field — is testable without a browser.
 */

export const SIGN_IN_MODES = ['signin', 'signup', 'recover'];
export const SIGN_IN_TIMEOUT_MS = 180_000;
const POLL_MS = 250;
const LIMITS = { email: 254, name: 60 };

/** Tool arguments are untrusted: collapse whitespace and cap length before they reach a view. */
function clean(value, max) { return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max); }

/**
 * @param {object} deps
 * @param {object} deps.store            the encrypted sync client
 * @param {object} deps.state            the UI view state
 * @param {() => void} deps.render       repaint the page
 * @param {() => object} deps.snapshot   the account summary shared with `get-account-status`
 * @param {() => Promise<void>} deps.signOut  the application's own sign-out, so that the tool
 *   and the sign-out button cannot drift apart — dropping the key, telling the password
 *   manager to stop offering silent access, and resetting the view are one path, not two.
 * @param {() => boolean} deps.rekeyInFlight  true while a passphrase change is running
 */
export function createAuthTools({
  store, state, render, snapshot, signOut,
  rekeyInFlight = () => false,
  sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); }),
  now = () => Date.now(),
  timeoutMs = SIGN_IN_TIMEOUT_MS,
  pollMs = POLL_MS,
} = {}) {
  /* The form is what reports a failed re-key; sending the reader elsewhere loses the report. */
  function refuseDuringRekey() {
    if (rekeyInFlight()) throw new Error('A passphrase change is still running. Wait for it to finish before changing the session.');
  }

  /**
   * Signed in is not the same as finished: a sign-up lands on the recovery key, which is
   * shown exactly once. Handing control back there would let the next tool call repaint it
   * away before the reader had written it down.
   */
  function handedOff() { return store.signedIn && !(state.view === 'recovery-key' && state.recoveryKey); }

  /** Resolves once the reader has finished in the page, or false if they never did. */
  async function waitForReader() {
    const deadline = now() + timeoutMs;
    while (!handedOff()) {
      if (now() >= deadline) return false;
      await sleep(pollMs);
    }
    return true;
  }

  async function settle({ prompted, mode, waitingNote }) {
    const done = await waitForReader();
    return done
      ? { ...snapshot(), prompted, ...(mode ? { mode } : {}) }
      : { ...snapshot(), prompted, ...(mode ? { mode } : {}), waiting: true, note: waitingNote };
  }

  return [
    {
      name: 'start-sign-in',
      title: 'Ask the reader to sign in to 4.0-reads',
      description: 'Bring the 4.0-reads sign-in form up in front of the reader and wait while they fill it in. Use this whenever another tool reports that nobody is signed in: reading the library and every write tool need an account. This tool cannot sign anyone in by itself, and it takes no passphrase and no recovery key — the passphrase derives the key that decrypts the library, so it is typed into the page by the person at the keyboard and never passes through an assistant. Ask the reader to switch to this tab. On a browser with a saved passphrase or a passkey they can be back in with one gesture — a passkey unlock needs their fingerprint, face, or device PIN, which is why an assistant cannot do it for them. Set mode to signup for a new account, or recover to use a recovery key. email and name only prefill the visible fields. A sign-up ends on a recovery key the reader must write down, and this tool does not return until they have. If the reader has not finished within three minutes the tool returns waiting; check get-account-status again later rather than calling this repeatedly.',
      inputSchema: {
        type: 'object',
        properties: {
          mode: { type: 'string', enum: SIGN_IN_MODES },
          email: { type: 'string', maxLength: LIMITS.email },
          name: { type: 'string', maxLength: LIMITS.name },
        },
        additionalProperties: false,
      },
      execute: async ({ mode = 'signin', email = '', name = '' } = {}) => {
        refuseDuringRekey();
        if (!SIGN_IN_MODES.includes(mode)) throw new Error(`Unknown sign-in mode “${clean(mode, 20)}”. Use signin, signup, or recover.`);
        /* Recovered but no passphrase chosen yet: the page is locked to that one step. */
        if (store.needsNewPassphrase) {
          return { ...snapshot(), prompted: false, note: 'The reader recovered this account and is choosing a new passphrase. Nothing else is reachable until they do.' };
        }
        if (handedOff()) return { ...snapshot(), prompted: false, alreadySignedIn: true };
        /* Signed up moments ago and still on the recovery key: wait it out, do not repaint. */
        if (store.signedIn) return settle({ prompted: false, waitingNote: 'The reader is still saving the recovery key shown once at sign-up. Wait for them to confirm it before writing anything.' });

        state.authMode = mode;
        state.authError = '';
        state.authDraft = {
          name: clean(name, LIMITS.name),
          /* A live cookie with the key gone still knows who the reader is; save them the typing. */
          email: clean(email, LIMITS.email) || clean(store.profile?.email, LIMITS.email),
        };
        render();

        return settle({ prompted: true, mode, waitingNote: 'The form is open and waiting for the reader. Nothing was signed in; ask them to complete it in the page, then call get-account-status.' });
      },
    },

    {
      name: 'sign-out',
      title: 'Sign the reader out of 4.0-reads',
      description: 'End the 4.0-reads session on this device: the server session is dropped and the decryption key is cleared from this browser. The library stays on the server as ciphertext, and only the reader\'s passphrase — typed into the page — opens it again, so signing out is not undoable from here. Call this only when the reader asks to sign out.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { idempotentHint: true },
      execute: async () => {
        refuseDuringRekey();
        if (!store.signedIn && !store.profile) return { ...snapshot(), alreadySignedOut: true };
        await signOut();
        return { ...snapshot(), signedOut: true, note: 'Signed out. The library is still on the server, encrypted; the reader signs back in with their passphrase.' };
      },
    },
  ];
}
