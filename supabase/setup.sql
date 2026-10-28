-- Velerion: shared storage for short links.
-- Run once in Supabase → SQL Editor → New query → paste → Run.
--
-- Security model
--   * Links are created only through create_link(), which is rate limited even when the code is
--     already taken (so failed creates can't be used to probe which codes exist).
--   * Only the public demo links (is_public) can be listed. Everyone else's links are private:
--     they open only through resolve_link(exact code), which is rate limited.
--   * A link's creator holds a random delete token (never readable). It is needed to delete
--     the link (delete_link) and to list your own links (my_links).
--   * The public role has no INSERT/UPDATE/DELETE rights; the server sets clicks, created_at, is_public.
--   * Rate limits use the last X-Forwarded-For entry (added by Supabase; earlier ones can be forged).
--     IPv6 clients are counted per /64.

create table if not exists public.links (
  code         text primary key check (code ~ '^[A-Za-z0-9_-]{1,24}$'),
  url          text not null check (url ~ '^https?://' and length(url) <= 2048),
  clicks       integer not null default 0 check (clicks between 0 and 100000000),
  created_at   timestamptz not null default now(),
  delete_token uuid,
  is_public    boolean not null default false
);

alter table public.links enable row level security;

revoke all on public.links from anon, authenticated;
grant select (code, url, clicks, created_at) on public.links to anon;

drop policy if exists "only public demo links are listable" on public.links;
drop policy if exists "anyone can add links" on public.links;
create policy "only public demo links are listable" on public.links for select to anon using (is_public);

create index if not exists links_delete_token_idx on public.links (delete_token) where delete_token is not null;

-- Private helpers (not reachable through the API) ------------------------------
create schema if not exists private;
revoke all on schema private from anon, authenticated;

create table if not exists private.request_log (
  client text not null,          -- md5 of the caller's IP, never the IP itself
  kind   text not null,
  at     timestamptz not null default now()
);
create index if not exists request_log_idx on private.request_log (kind, client, at);

-- One client = one IPv4 address or one IPv6 /64 (a single home or server usually owns a whole /64).
create or replace function private.client_id()
returns text language plpgsql stable set search_path = ''
as $$
declare
  v_raw text;
  v_ip  inet;
begin
  select nullif(trim(parts[array_length(parts, 1)]), '') into v_raw
  from (select string_to_array(
    coalesce(nullif(current_setting('request.headers', true), ''), '{}')::json->>'x-forwarded-for', ',') as parts) p;
  if v_raw is null then
    return md5('unknown');
  end if;
  begin
    v_ip := v_raw::inet;
  exception when others then
    return md5(v_raw);
  end;
  if family(v_ip) = 6 then
    v_ip := network(set_masklen(v_ip, 64));
  end if;
  return md5(host(v_ip) || '/' || masklen(v_ip));
end;
$$;

create or replace function private.rate_limit(p_kind text, p_limit int, p_global int)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_client text := private.client_id();
  v_mine int;
  v_all  int;
begin
  -- One check at a time per client and kind, so parallel requests can't all read the same count.
  perform pg_advisory_xact_lock(hashtext(p_kind || ':' || v_client));
  delete from private.request_log where at < now() - interval '5 minutes';
  select count(*) into v_mine from private.request_log where kind = p_kind and client = v_client and at > now() - interval '1 minute';
  select count(*) into v_all  from private.request_log where kind = p_kind and at > now() - interval '1 minute';
  if v_mine >= p_limit then
    raise exception 'Too many requests from your network. Please wait a minute and try again.';
  end if;
  if v_all >= p_global then
    raise exception 'The service is busy right now. Please try again in a minute.';
  end if;
  insert into private.request_log (client, kind) values (v_client, p_kind);
end;
$$;

-- New links are always private, with server-set clicks and time (create_link does the rate limiting).
create or replace function private.before_link_insert()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  new.clicks := 0;
  new.created_at := clock_timestamp();
  new.is_public := false;
  return new;
end;
$$;

drop trigger if exists links_before_insert on public.links;
create trigger links_before_insert before insert on public.links
  for each row execute function private.before_link_insert();

-- API functions -----------------------------------------------------------------

-- Create a link. Returns false if the code is taken. The rate-limit row is committed either way,
-- so probing for existing codes is limited just like resolve_link.
create or replace function public.create_link(p_code text, p_url text, p_token uuid)
returns boolean language plpgsql security definer set search_path = ''
as $$
begin
  if p_code is null or p_code !~ '^[A-Za-z0-9_-]{1,24}$' then
    raise exception 'Endings may use letters, numbers, "-" and "_" (24 max).';
  end if;
  if p_url is null or length(p_url) > 2048 or p_url !~ '^https?://[^/?#@[:space:]]+([/?#]|$)' then
    raise exception 'Only http and https links without a username or password can be shortened.';
  end if;
  if p_token is null then
    raise exception 'A delete token is required.';
  end if;
  perform private.rate_limit('insert', 20, 300);
  insert into public.links (code, url, delete_token) values (p_code, p_url, p_token)
    on conflict (code) do nothing;
  return found;
end;
$$;

-- Open a link by its exact code (counts a click unless p_click = false).
create or replace function public.resolve_link(p_code text, p_click boolean default true)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  v_url text;
begin
  if p_code is null or p_code !~ '^[A-Za-z0-9_-]{1,24}$' then
    return null;
  end if;
  perform private.rate_limit('resolve', 120, 5000);
  if p_click then
    update public.links set clicks = clicks + 1 where code = p_code returning url into v_url;
  else
    select url into v_url from public.links where code = p_code;
  end if;
  return v_url;
end;
$$;

-- List the links whose secret tokens the caller holds.
create or replace function public.my_links(p_tokens uuid[])
returns table (code text, url text, clicks integer, created_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
begin
  if p_tokens is null or cardinality(p_tokens) = 0 then
    return;
  end if;
  if cardinality(p_tokens) > 500 then
    raise exception 'Too many tokens (500 max).';
  end if;
  perform private.rate_limit('mine', 30, 3000);
  return query
    select l.code, l.url, l.clicks, l.created_at
    from public.links l
    where l.delete_token = any (p_tokens)
    order by l.created_at, l.code;
end;
$$;

-- Delete a link: only with the token generated when it was created.
create or replace function public.delete_link(p_code text, p_token uuid)
returns boolean language plpgsql security definer set search_path = ''
as $$
begin
  if p_code is null or p_token is null then
    return false;
  end if;
  perform private.rate_limit('delete', 30, 3000);
  delete from public.links where code = p_code and delete_token = p_token;
  return found;
end;
$$;

revoke execute on all functions in schema private from public, anon, authenticated;
revoke execute on function public.create_link(text, text, uuid) from public, authenticated;
revoke execute on function public.resolve_link(text, boolean) from public, authenticated;
revoke execute on function public.my_links(uuid[]) from public, authenticated;
revoke execute on function public.delete_link(text, uuid) from public, authenticated;
grant execute on function public.create_link(text, text, uuid) to anon;
grant execute on function public.resolve_link(text, boolean) to anon;
grant execute on function public.my_links(uuid[]) to anon;
grant execute on function public.delete_link(text, uuid) to anon;

-- The 32 demo links are loaded by an admin (SQL editor, not the API); then make them the public set:
--   update public.links set is_public = true where delete_token is null;
