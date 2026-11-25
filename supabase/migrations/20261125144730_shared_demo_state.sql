create table public.demo_sessions (
  id uuid primary key,
  version bigint not null default 1 check (version > 0),
  state jsonb not null check (
    jsonb_typeof(state) = 'object'
    and pg_column_size(state) <= 262144
  ),
  updated_at timestamptz not null default now()
);

comment on table public.demo_sessions is
  'Estado compartilhado da demonstração Mesa Atenta; normalizar antes de produção.';

alter table public.demo_sessions enable row level security;

revoke all on table public.demo_sessions from public, anon, authenticated;
grant select, update on table public.demo_sessions to anon, authenticated;
grant all on table public.demo_sessions to service_role;

create policy "demo compartilhada pode ser lida"
on public.demo_sessions for select
to anon, authenticated
using (id = 'a9a04ad0-3c28-4f21-8cf1-8be2f7d66b21'::uuid);

create policy "demo compartilhada pode ser atualizada"
on public.demo_sessions for update
to anon, authenticated
using (id = 'a9a04ad0-3c28-4f21-8cf1-8be2f7d66b21'::uuid)
with check (
  id = 'a9a04ad0-3c28-4f21-8cf1-8be2f7d66b21'::uuid
  and jsonb_typeof(state) = 'object'
  and pg_column_size(state) <= 262144
);

insert into public.demo_sessions (id, version, state)
values (
  'a9a04ad0-3c28-4f21-8cf1-8be2f7d66b21',
  1,
  jsonb_build_object(
    'next', 6,
    'calls', '[]'::jsonb,
    'rules', jsonb_build_object('churrasqueira', 8, 'buffet', 8),
    'receipts', '{}'::jsonb,
    'cleaning', jsonb_build_array(jsonb_build_object(
      'id', 1, 'table_no', 12,
      'created', extract(epoch from now())::bigint - 180,
      'started', null, 'finished', null
    )),
    'readings', jsonb_build_array(
      jsonb_build_object('place','churrasqueira','people',8,'observed',extract(epoch from now())::bigint - 65,'wait_seconds',420,'threshold',8),
      jsonb_build_object('place','churrasqueira','people',9,'observed',extract(epoch from now())::bigint - 10,'wait_seconds',390,'threshold',8),
      jsonb_build_object('place','buffet','people',3,'observed',extract(epoch from now())::bigint - 12,'wait_seconds',120,'threshold',8)
    ),
    'alerts', jsonb_build_array(jsonb_build_object(
      'id',2,'place','churrasqueira','opened',extract(epoch from now())::bigint - 10,
      'acknowledged',null,'action',null,'action_at',null,'closed',null
    )),
    'observations', jsonb_build_array(
      jsonb_build_object('id',5,'kind','comentario','item','Farofa','source','Buffet','note','Quais ingredientes entram na farofa?','first_value',null,'second_value',null),
      jsonb_build_object('id',4,'kind','sobra','item','Farofa','source','Retirada','first_value',3,'second_value',8,'note',''),
      jsonb_build_object('id',3,'kind','mix','item','Composição por peso','source','Pesagem','first_value',160,'second_value',322,'note','')
    )
  )
);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'demo_sessions'
  ) then
    alter publication supabase_realtime add table public.demo_sessions;
  end if;
end $$;
