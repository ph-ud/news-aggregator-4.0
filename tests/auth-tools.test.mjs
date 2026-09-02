import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthTools, SIGN_IN_MODES, SIGN_IN_TIMEOUT_MS } from '../src/auth-tools.js';

/**
 * A stand-in for the parts of the app the login tools touch. Time is fake: `sleep` advances
 * the clock instead of waiting, so a three-minute timeout costs nothing to test, and
 * `onPoll` can flip the store the way a reader completing the form would.
 */
function harness({ signedIn = false, profile = null, needsNewPassphrase = false, rekeyInFlight = false, view = 'library', recoveryKey = 'ABC', onPoll = () => {} } = {}) {
  const context = {
    clock: 0,
    polls: 0,
    renders: 0,
    signOuts: 0,
    state: { view, authMode: 'signin', authError: 'stale', authDraft: { name: '', email: '' }, selectedStoryId: 'story-1', recoveryKey },
    store: {
      signedIn, profile, needsNewPassphrase,
      async signOut() { this.signedIn = false; this.profile = null; },
    },
  };
  context.tools = Object.fromEntries(createAuthTools({
    store: context.store,
    state: context.state,
    render: () => { context.renders += 1; },
    /* Stands in for the application's sign-out, which the tool must reuse rather than repeat. */
    signOut: async () => { context.signOuts += 1; await context.store.signOut(); Object.assign(context.state, { view: 'library', authMode: 'signin', selectedStoryId: null, recoveryKey: '' }); },
    snapshot: () => ({ signedIn: context.store.signedIn, account: context.store.profile }),
    rekeyInFlight: () => rekeyInFlight,
    now: () => context.clock,
    sleep: async (ms) => { context.clock += ms; context.polls += 1; onPoll(context); },
  }).map((tool) => [tool.name, tool]));
  return context;
}

test('no login tool has anywhere to put a passphrase', () => {
  const tools = createAuthTools({ store: {}, state: {}, render() {}, snapshot: () => ({}) });
  const secret = /passphrase|password|recoveryKey|secret|credential|token/i;
  for (const tool of tools) {
    const fields = Object.keys(tool.inputSchema.properties);
    assert.equal(fields.some((field) => secret.test(field)), false, `${tool.name} must not accept a credential`);
    /* Without this an agent could simply add the field the schema declines to declare. */
    assert.equal(tool.inputSchema.additionalProperties, false, `${tool.name} must reject unknown arguments`);
    assert.match(tool.description, /passphrase/, `${tool.name} must say where the passphrase goes`);
  }
  assert.deepEqual(tools.map((tool) => tool.name), ['start-sign-in', 'sign-out']);
});

test('start-sign-in opens the form, prefills what is not secret, and waits for the reader', async () => {
  const context = harness({ onPoll: (self) => { if (self.polls === 2) self.store.signedIn = true; } });
  const result = await context.tools['start-sign-in'].execute({ mode: 'signup', email: '  reader@example.com ', name: 'Ada  Lovelace' });
  assert.equal(context.state.authMode, 'signup');
  assert.deepEqual(context.state.authDraft, { name: 'Ada Lovelace', email: 'reader@example.com' });
  assert.equal(context.state.authError, '', 'a stale error must not greet the reader');
  assert.equal(context.renders > 0, true, 'the form has to be painted before anyone can use it');
  assert.deepEqual(result, { signedIn: true, account: null, prompted: true, mode: 'signup' });
});

test('start-sign-in falls back to the email of a session whose key is gone', async () => {
  const context = harness({ profile: { email: 'known@example.com' }, onPoll: (self) => { self.store.signedIn = true; } });
  await context.tools['start-sign-in'].execute({});
  assert.equal(context.state.authDraft.email, 'known@example.com');
  assert.equal(context.state.authMode, 'signin');
});

test('start-sign-in reports back rather than blocking forever', async () => {
  const context = harness();
  const result = await context.tools['start-sign-in'].execute({});
  assert.equal(result.signedIn, false);
  assert.equal(result.waiting, true);
  assert.match(result.note, /get-account-status/);
  assert.equal(context.clock >= SIGN_IN_TIMEOUT_MS, true, 'the reader gets the full window');
  assert.equal(context.clock < SIGN_IN_TIMEOUT_MS * 2, true, 'and not appreciably more');
});

test('start-sign-in does nothing when the reader is already signed in', async () => {
  const context = harness({ signedIn: true, profile: { email: 'reader@example.com' } });
  const result = await context.tools['start-sign-in'].execute({ mode: 'signup' });
  assert.equal(result.alreadySignedIn, true);
  assert.equal(result.prompted, false);
  assert.equal(context.state.authMode, 'signin', 'an unnecessary prompt must not disturb the page');
  assert.equal(context.polls, 0);
});

test('start-sign-in leaves a recovered account on its forced passphrase step', async () => {
  const context = harness({ signedIn: true, needsNewPassphrase: true });
  const result = await context.tools['start-sign-in'].execute({ mode: 'recover' });
  assert.equal(result.prompted, false);
  assert.match(result.note, /new passphrase/);
  assert.equal(context.renders, 0, 'nothing may repaint over the passphrase form');
});

test('start-sign-in rejects a mode it does not offer', async () => {
  const context = harness();
  await assert.rejects(() => context.tools['start-sign-in'].execute({ mode: 'magic-link' }), /Unknown sign-in mode/);
  assert.equal(context.state.authMode, 'signin');
  assert.deepEqual(SIGN_IN_MODES, ['signin', 'signup', 'recover']);
});

test('sign-out goes through the application\'s own sign-out, not a copy of it', async () => {
  const context = harness({ signedIn: true, profile: { email: 'reader@example.com' } });
  Object.assign(context.state, { view: 'account', authMode: 'recover' });
  const result = await context.tools['sign-out'].execute({});
  /* A second implementation here is how the tool quietly stops clearing the password
     manager's silent access, or the key, once the real one grows a step. */
  assert.equal(context.signOuts, 1);
  assert.equal(result.signedOut, true);
  assert.equal(result.signedIn, false);
  assert.deepEqual({ ...context.state, authDraft: undefined }, { view: 'library', authMode: 'signin', authError: 'stale', authDraft: undefined, selectedStoryId: null, recoveryKey: '' });
});

test('sign-out is idempotent', async () => {
  const context = harness();
  const result = await context.tools['sign-out'].execute({});
  assert.equal(result.alreadySignedOut, true);
  assert.equal(context.signOuts, 0);
});

test('neither tool may cut across a passphrase change in flight', async () => {
  const context = harness({ signedIn: true, rekeyInFlight: true });
  for (const name of ['start-sign-in', 'sign-out']) {
    await assert.rejects(() => context.tools[name].execute({}), /passphrase change/, `${name} must stand down`);
  }
  assert.equal(context.signOuts, 0);
  assert.equal(context.renders, 0);
});

test('start-sign-in waits out the recovery key instead of painting over it', async () => {
  /* Shown exactly once: returning here would let the agent's next call destroy it. */
  const context = harness({ signedIn: true, view: 'recovery-key', onPoll: (self) => { if (self.polls === 3) self.state.view = 'library'; } });
  const result = await context.tools['start-sign-in'].execute({ mode: 'signup' });
  assert.equal(context.renders, 0, 'the recovery key must stay on screen');
  assert.equal(context.polls, 3);
  assert.equal(result.signedIn, true);
  assert.equal(result.prompted, false);
  assert.equal(result.waiting, undefined);
});

test('start-sign-in says so when the reader never confirms the recovery key', async () => {
  const context = harness({ signedIn: true, view: 'recovery-key' });
  const result = await context.tools['start-sign-in'].execute({ mode: 'signup' });
  assert.equal(result.waiting, true);
  assert.match(result.note, /recovery key/);
  assert.equal(context.renders, 0);
});

test('a sign-up handoff is not finished until the recovery key is confirmed', async () => {
  const context = harness({ onPoll: (self) => {
    /* The reader signs up, lands on the key, and only later confirms it. */
    if (self.polls === 1) { self.store.signedIn = true; self.state.view = 'recovery-key'; }
    if (self.polls === 4) { self.state.view = 'library'; self.state.recoveryKey = ''; }
  } });
  const result = await context.tools['start-sign-in'].execute({ mode: 'signup' });
  assert.equal(context.polls, 4);
  assert.equal(result.prompted, true);
  assert.equal(result.waiting, undefined);
});
