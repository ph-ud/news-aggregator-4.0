import { DatabaseSync } from 'node:sqlite';

/**
 * The server stores opaque ciphertext. There is deliberately no `kind` column:
 * the record type lives inside the encrypted payload, so a database dump cannot
 * distinguish a saved story from a subscription. What a dump does reveal is
 * unavoidable sync metadata — record count, ciphertext size, update times.
 */
const SCHEMA = `
create table if not exists users (
  id             text primary key,
  email          text unique not null,
  name           text not null,
  kdf_salt       text not null,
  kdf_iterations integer not null,
  auth_hash      text not null,
  auth_salt      text not null,
  wrapped_mk     text not null,
  recovery_wrap  text not null,
  recovery_hash  text not null,
  recovery_salt  text not null,
  recovery_kdf_salt       text not null,
  recovery_kdf_iterations integer not null,
  created_at     text not null
);
create table if not exists sessions (
  token_hash text primary key,
  user_id    text not null references users(id) on delete cascade,
  created_at text not null,
  expires_at text not null
);
create table if not exists records (
  user_id    text not null references users(id) on delete cascade,
  id         text not null,
  iv         text not null,
  ct         text not null,
  updated_at text not null,
  deleted    integer not null default 0,
  primary key (user_id, id)
);
/* A passkey is a second wrapper around the same master key, opened by a secret the
   authenticator derives and never discloses. The server keeps the public key so it can
   check an assertion, and the wrapped key it still cannot open. A dump gains one fact it
   did not have: that an account has a passkey, and when it was added. */
create table if not exists passkeys (
  credential_id text primary key,
  user_id       text not null references users(id) on delete cascade,
  public_key    text not null,
  algorithm     integer not null,
  sign_count    integer not null default 0,
  wrapped_mk    text not null,
  created_at    text not null
);
/* Single-use, short-lived, and deleted on use: a challenge is what stops an assertion
   captured once from being replayed. */
create table if not exists challenges (
  challenge  text primary key,
  purpose    text not null,
  user_id    text,
  expires_at text not null
);
create index if not exists records_by_update on records(user_id, updated_at);
create index if not exists passkeys_by_user on passkeys(user_id);
create index if not exists sessions_by_user on sessions(user_id);
`;

export function openDatabase(location = process.env.DATABASE_PATH || './data/4.0-reads.db') {
  const db = new DatabaseSync(location);
  db.exec('pragma journal_mode = WAL');
  db.exec('pragma foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}
