import pg from 'pg';

let pool = null;
let migrated = null;
let migratedFor = null;

function connectionString() {
  return (
    process.env.POSTGRES_URL ||
    process.env.DATABASE_URL ||
    process.env.SUPABASE_DB_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    ''
  );
}

export function dbConfigured() {
  return Boolean(globalThis.__TL_DB || connectionString());
}

function client() {
  if (globalThis.__TL_DB) return globalThis.__TL_DB;
  if (!pool) {
    const cs = connectionString();
    if (!cs) throw new Error('Database is not configured. Add POSTGRES_URL from Supabase.');
    const u = new URL(cs);
    const local = ['localhost', '127.0.0.1'].includes(u.hostname);
    // Supabase pooler certificates are not in the default trust store, so query-string sslmode is
    // dropped and TLS is set explicitly. Traffic is still encrypted.
    pool = new pg.Pool({
      host: u.hostname,
      port: Number(u.port || 5432),
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: decodeURIComponent(u.pathname.replace(/^\//, '')) || 'postgres',
      ssl: local ? false : { rejectUnauthorized: false },
      max: 3,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 8000,
    });
  }
  return pool;
}

const SCHEMA = [
  `create table if not exists tl_customers (
    id serial primary key,
    token text unique not null,
    first_name text not null,
    phone text not null,
    grade text,
    weekly_budget numeric(10,2) not null default 50,
    ref_code text,
    plan text not null default 'monthly',
    status text not null default 'pending',
    test boolean not null default false,
    stripe_session_id text,
    stripe_customer_id text,
    stripe_subscription_id text,
    created_at timestamptz not null default now(),
    activated_at timestamptz,
    connected_at timestamptz,
    last_report_at timestamptz
  )`,
  `create index if not exists tl_customers_phone_idx on tl_customers(phone)`,
  `create table if not exists tl_transactions (
    id bigserial primary key,
    customer_id int not null references tl_customers(id) on delete cascade,
    amount numeric(10,2) not null,
    merchant text not null default 'Unknown',
    category text not null default 'Other',
    card text,
    source text not null default 'shortcut',
    occurred_at timestamptz not null default now()
  )`,
  `create index if not exists tl_tx_customer_time_idx on tl_transactions(customer_id, occurred_at desc)`,
  `create table if not exists tl_messages (
    id bigserial primary key,
    customer_id int references tl_customers(id) on delete cascade,
    direction text not null default 'out',
    kind text not null default 'info',
    body text not null,
    status text not null default 'queued',
    provider_id text,
    error text,
    created_at timestamptz not null default now()
  )`,
  `create index if not exists tl_messages_customer_idx on tl_messages(customer_id, created_at desc)`,
  `alter table tl_customers add column if not exists login_code text`,
  `alter table tl_customers add column if not exists login_expires timestamptz`,
  `alter table tl_customers add column if not exists login_tries int not null default 0`,
  `alter table tl_customers add column if not exists login_sent_at timestamptz`,
  `create table if not exists tl_feedback (
    id bigserial primary key,
    customer_id int references tl_customers(id) on delete set null,
    rating int,
    message text,
    page text,
    created_at timestamptz not null default now()
  )`,
  `create table if not exists tl_reps (
    code text primary key,
    name text not null,
    territory text,
    created_at timestamptz not null default now()
  )`,
];

async function migrate() {
  const c = client();
  if (!migrated || migratedFor !== c) {
    migratedFor = c;
    migrated = (async () => {
      for (const stmt of SCHEMA) await c.query(stmt);
    })().catch((e) => {
      migrated = null;
      throw e;
    });
  }
  return migrated;
}

export async function q(sql, params = []) {
  await migrate();
  const r = await client().query(sql, params);
  return r.rows;
}

export async function one(sql, params = []) {
  const rows = await q(sql, params);
  return rows[0] || null;
}

export async function ping() {
  await migrate();
  await client().query('select 1');
  return true;
}
