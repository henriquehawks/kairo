-- Administrador e lista de convidados.
--
-- Rode depois do esquema.sql, no SQL Editor do projeto. É seguro repetir.
--
-- A regra de quem é administrador mora AQUI, no banco, e não no app. O app é
-- instalado na máquina das pessoas: qualquer verificação feita lá pode ser
-- editada por quem quiser. O que vale é o e-mail que está dentro do token, e
-- quem confere é o Postgres.

-- Troque aqui se um dia o e-mail mudar. É o único lugar no banco.
create or replace function public.e_admin() returns boolean
language sql stable
set search_path = public
as $$
  select coalesce(auth.jwt() ->> 'email', '') = 'henrique.coruja@grupolana.com.br';
$$;

-- ---------------------------------------------------------------------------
-- Lista de convidados: só quem está aqui consegue criar conta.
-- ---------------------------------------------------------------------------
-- Sem isto, qualquer pessoa que extraia a chave publicável de dentro do app
-- cria conta no seu projeto. A chave é pública por natureza; o portão é este.

create table if not exists public.convidados (
  email     text primary key,
  convidado timestamptz not null default now()
);

alter table public.convidados enable row level security;

drop policy if exists convidados_do_admin on public.convidados;
create policy convidados_do_admin on public.convidados
  for all to authenticated
  using (public.e_admin())
  with check (public.e_admin());

insert into public.convidados (email) values ('henrique.coruja@grupolana.com.br')
  on conflict (email) do nothing;

create or replace function public.so_convidados() returns trigger
language plpgsql security definer
set search_path = public, auth
as $$
begin
  if not exists (select 1 from public.convidados c where lower(c.email) = lower(new.email)) then
    raise exception 'email_nao_convidado';
  end if;
  return new;
end;
$$;

drop trigger if exists so_convidados on auth.users;
create trigger so_convidados before insert on auth.users
  for each row execute function public.so_convidados();

-- ---------------------------------------------------------------------------
-- Leitura: quem existe e quanto ocupa.
-- ---------------------------------------------------------------------------
-- Com criptografia de ponta a ponta, isto é tudo que dá para saber — quem e
-- quando, nunca o quê. O conteúdo das áreas não é legível nem aqui.

create or replace function public.pessoas_do_kairo()
returns table (
  usuario_id       uuid,
  email            text,
  criado           timestamptz,
  ultimo_acesso    timestamptz,
  confirmado       boolean,
  areas            bigint,
  bytes            bigint,
  ultima_sincronia timestamptz
)
language plpgsql security definer
set search_path = public, auth
as $$
begin
  if not public.e_admin() then
    raise exception 'sem_permissao';
  end if;
  return query
    select u.id,
           u.email::text,
           u.created_at,
           u.last_sign_in_at,
           u.email_confirmed_at is not null,
           count(d.chave),
           coalesce(sum(length(d.valor)), 0)::bigint,
           case when max(d.atualizado) is null then null
                else to_timestamp(max(d.atualizado) / 1000.0) end
      from auth.users u
      left join public.dados d on d.usuario_id = u.id
     group by u.id, u.email, u.created_at, u.last_sign_in_at, u.email_confirmed_at
     order by u.created_at;
end;
$$;

revoke all on function public.pessoas_do_kairo() from public, anon;
grant execute on function public.pessoas_do_kairo() to authenticated;

create or replace function public.resumo_do_kairo()
returns table (pessoas bigint, com_dados bigint, ativos_7d bigint, bytes bigint)
language plpgsql security definer
set search_path = public, auth
as $$
begin
  if not public.e_admin() then
    raise exception 'sem_permissao';
  end if;
  return query
    select (select count(*) from auth.users),
           (select count(distinct d.usuario_id) from public.dados d),
           (select count(*) from auth.users u where u.last_sign_in_at > now() - interval '7 days'),
           (select coalesce(sum(length(d.valor)), 0)::bigint from public.dados d);
end;
$$;

revoke all on function public.resumo_do_kairo() from public, anon;
grant execute on function public.resumo_do_kairo() to authenticated;

-- Como conferir.
--
-- O SQL Editor roda como postgres, sem token nenhum: auth.jwt() vem vazio e estas
-- funções respondem sem_permissao. Isso é a trava funcionando, não defeito.
-- Para testar por aqui, finja o token na mesma execução:
--
--   select set_config('request.jwt.claims', '{"email":"henrique.coruja@grupolana.com.br"}', true);
--   select * from public.resumo_do_kairo();
--
-- O teste de verdade é abrir Ajustes > Conta no app, logado como administrador.
--
-- E confira que o portão do cadastro ficou de pé:
--   select tgname, tgenabled from pg_trigger where tgrelid = 'auth.users'::regclass;
