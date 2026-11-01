-- Sihirli Sayılar Multiplayer MVP
-- Supabase SQL Editor'de bu dosyanın tamamını çalıştırın.
create extension if not exists pgcrypto;

create table if not exists public.sihiri_rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  host_token text not null,
  status text not null default 'waiting' check (status in ('waiting','playing','finished')),
  duration_seconds integer not null default 180 check (duration_seconds in (120,180,300)),
  challenge jsonb not null default '{}'::jsonb,
  starts_at timestamptz,
  winner_player_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.sihiri_players (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.sihiri_rooms(id) on delete cascade,
  player_token text not null,
  display_name text not null,
  is_host boolean not null default false,
  board_state jsonb not null default '{}'::jsonb,
  submitted_answer text,
  finished_at timestamptz,
  joined_at timestamptz not null default now(),
  unique(room_id, player_token)
);

alter table public.sihiri_rooms enable row level security;
alter table public.sihiri_players enable row level security;
revoke all on public.sihiri_rooms from anon, authenticated;
revoke all on public.sihiri_players from anon, authenticated;

create or replace function public.sihiri_room_payload(p_room_id uuid, p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.sihiri_rooms; p public.sihiri_players; result jsonb;
begin
  select * into r from public.sihiri_rooms where id=p_room_id;
  select * into p from public.sihiri_players where room_id=p_room_id and player_token=p_token;
  if p.id is null then raise exception 'Bu oda için oyuncu oturumu bulunamadı.'; end if;
  select jsonb_build_object(
    'room', jsonb_build_object(
      'id',r.id,'code',r.code,'status',r.status,'duration_seconds',r.duration_seconds,
      'challenge',r.challenge,'starts_at',r.starts_at,'created_at',r.created_at
    ),
    'player',jsonb_build_object(
      'player_id',p.id,'player_token',p.player_token,'display_name',p.display_name,'is_host',p.is_host
    ),
    'players',coalesce((
      select jsonb_agg(jsonb_build_object(
        'player_id',pl.id,'display_name',pl.display_name,'is_host',pl.is_host,
        'finished_at',pl.finished_at,'joined_at',pl.joined_at
      ) order by pl.joined_at)
      from public.sihiri_players pl where pl.room_id=p_room_id
    ),'[]'::jsonb),
    'winner',(select pl.display_name from public.sihiri_players pl where pl.id=r.winner_player_id)
  ) into result;
  return result;
end $$;

create or replace function public.sihiri_create_room(p_name text, p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.sihiri_rooms; p public.sihiri_players; c text;
begin
  if length(trim(coalesce(p_name,'')))=0 then p_name := 'Oyuncu'; end if;
  loop
    c := upper(substr(encode(gen_random_bytes(8),'hex'),1,6));
    exit when not exists(select 1 from public.sihiri_rooms where code=c and status <> 'finished');
  end loop;
  insert into public.sihiri_rooms(code,host_token) values(c,p_token) returning * into r;
  insert into public.sihiri_players(room_id,player_token,display_name,is_host)
  values(r.id,p_token,left(trim(p_name),24),true) returning * into p;
  return public.sihiri_room_payload(r.id,p_token);
end $$;

create or replace function public.sihiri_join_room(p_code text, p_name text, p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.sihiri_rooms; p public.sihiri_players;
begin
  select * into r from public.sihiri_rooms where code=upper(trim(p_code)) and status='waiting';
  if r.id is null then raise exception 'Oda bulunamadı veya tur başlamış.'; end if;
  select * into p from public.sihiri_players where room_id=r.id and player_token=p_token;
  if p.id is null then
    if (select count(*) from public.sihiri_players where room_id=r.id)>=4 then raise exception 'Oda dolu. En fazla 4 oyuncu katılabilir.'; end if;
    insert into public.sihiri_players(room_id,player_token,display_name)
    values(r.id,p_token,left(coalesce(nullif(trim(p_name),''),'Oyuncu'),24)) returning * into p;
  end if;
  return public.sihiri_room_payload(r.id,p_token);
end $$;

create or replace function public.sihiri_start_round(p_code text, p_token text, p_duration integer, p_challenge jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.sihiri_rooms;
begin
  select * into r from public.sihiri_rooms where code=upper(trim(p_code)) for update;
  if r.id is null then raise exception 'Oda bulunamadı.'; end if;
  if r.host_token<>p_token then raise exception 'Turu yalnızca oda sahibi başlatabilir.'; end if;
  if (select count(*) from public.sihiri_players where room_id=r.id)<2 then raise exception 'Başlamak için en az 2 oyuncu gerekli.'; end if;
  if p_duration not in (120,180,300) then raise exception 'Geçersiz süre.'; end if;
  update public.sihiri_rooms set status='playing',duration_seconds=p_duration,
    challenge=coalesce(p_challenge,'{}'::jsonb),starts_at=now()+interval '3 seconds',winner_player_id=null
    where id=r.id;
  update public.sihiri_players set board_state='{}'::jsonb,submitted_answer=null,finished_at=null where room_id=r.id;
  return public.sihiri_room_payload(r.id,p_token);
end $$;

create or replace function public.sihiri_room_state(p_code text, p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.sihiri_rooms;
begin
  select * into r from public.sihiri_rooms where code=upper(trim(p_code));
  if r.id is null then raise exception 'Oda bulunamadı.'; end if;
  return public.sihiri_room_payload(r.id,p_token);
end $$;

create or replace function public.sihiri_save_board(p_code text, p_token text, p_board_state jsonb)
returns boolean language plpgsql security definer set search_path = public as $$
declare r public.sihiri_rooms;
begin
  select * into r from public.sihiri_rooms where code=upper(trim(p_code));
  if r.id is null then raise exception 'Oda bulunamadı.'; end if;
  update public.sihiri_players set board_state=coalesce(p_board_state,'{}'::jsonb)
  where room_id=r.id and player_token=p_token;
  if not found then raise exception 'Oyuncu oturumu bulunamadı.'; end if;
  return true;
end $$;

-- Sunucu, tahtadaki 25 hücreyi kontrol eder ve ilk geçerli sonucu kazanan yapar.
create or replace function public.sihiri_submit_result(
  p_code text, p_token text, p_answer text, p_board_state jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r public.sihiri_rooms; p public.sihiri_players; piece record; cell jsonb;
  rr integer; cc integer; idx integer; covered integer:=0; seen boolean[]:=array_fill(false,ARRAY[25]);
  empty_idx integer; actual_answer text; now_time timestamptz:=clock_timestamp();
begin
  select * into r from public.sihiri_rooms where code=upper(trim(p_code)) for update;
  if r.id is null or r.status<>'playing' then raise exception 'Aktif tur bulunamadı.'; end if;
  select * into p from public.sihiri_players where room_id=r.id and player_token=p_token for update;
  if p.id is null then raise exception 'Oyuncu oturumu bulunamadı.'; end if;
  if now_time < r.starts_at then raise exception 'Tur henüz başlamadı.'; end if;
  if now_time > r.starts_at + make_interval(secs=>r.duration_seconds) then
    update public.sihiri_rooms set status='finished' where id=r.id;
    raise exception 'Süreniz doldu.';
  end if;
  if p.finished_at is not null then return public.sihiri_room_payload(r.id,p_token); end if;

  for piece in select value as val from jsonb_each(coalesce(p_board_state->'pieces','{}'::jsonb)) loop
    if piece.val->'anchor' is null or piece.val->'anchor'='null'::jsonb then continue; end if;
    for cell in select value from jsonb_array_elements(coalesce(piece.val->'cells','[]'::jsonb)) loop
      rr := (piece.val->'anchor'->>'r')::integer + (cell->>0)::integer;
      cc := (piece.val->'anchor'->>'c')::integer + (cell->>1)::integer;
      if rr<0 or rr>4 or cc<0 or cc>4 then raise exception 'Tahta dışına taşan parça var.'; end if;
      idx:=rr*5+cc+1;
      if seen[idx] then raise exception 'Parçalar çakışıyor.'; end if;
      seen[idx]:=true; covered:=covered+1;
    end loop;
  end loop;
  if covered<>24 then raise exception 'Tüm parçalar yerleşmemiş.'; end if;
  for idx in 1..25 loop if not seen[idx] then empty_idx:=idx-1; exit; end if; end loop;
  if empty_idx=12 then actual_answer:='center';
  elsif empty_idx<12 then actual_answer:=(empty_idx+1)::text;
  else actual_answer:=empty_idx::text; end if;
  if p_answer is distinct from actual_answer then raise exception 'Cevap veya tahta doğru değil.'; end if;

  update public.sihiri_players set board_state=p_board_state,submitted_answer=p_answer,finished_at=now_time
  where id=p.id;
  update public.sihiri_rooms set winner_player_id=p.id,status='finished'
  where id=r.id and winner_player_id is null;
  return public.sihiri_room_payload(r.id,p_token);
end $$;

create or replace function public.sihiri_leave_room(p_code text, p_token text)
returns boolean language plpgsql security definer set search_path = public as $$
declare r public.sihiri_rooms;
begin
  select * into r from public.sihiri_rooms where code=upper(trim(p_code));
  if r.id is null then return true; end if;
  delete from public.sihiri_players where room_id=r.id and player_token=p_token;
  if not exists(select 1 from public.sihiri_players where room_id=r.id) then
    delete from public.sihiri_rooms where id=r.id;
  elsif r.host_token=p_token then
    update public.sihiri_rooms set host_token=(select player_token from public.sihiri_players where room_id=r.id order by joined_at limit 1) where id=r.id;
    update public.sihiri_players set is_host=true where id=(select id from public.sihiri_players where room_id=r.id order by joined_at limit 1);
  end if;
  return true;
end $$;

revoke all on function public.sihiri_room_payload(uuid,text) from public, anon, authenticated;

grant execute on function public.sihiri_create_room(text,text) to anon, authenticated;
grant execute on function public.sihiri_join_room(text,text,text) to anon, authenticated;
grant execute on function public.sihiri_start_round(text,text,integer,jsonb) to anon, authenticated;
grant execute on function public.sihiri_room_state(text,text) to anon, authenticated;
grant execute on function public.sihiri_save_board(text,text,jsonb) to anon, authenticated;
grant execute on function public.sihiri_submit_result(text,text,text,jsonb) to anon, authenticated;
grant execute on function public.sihiri_leave_room(text,text) to anon, authenticated;
