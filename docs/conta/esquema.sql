-- Esquema da conta do Kairo, para colar no editor SQL do projeto na Supabase.
--
-- O servidor guarda só conteúdo cifrado: `dados.valor` e as duas cópias da chave
-- mestra em `cofre` saem da máquina já embrulhadas, e a senha que abre o cofre
-- nunca chega aqui. Quem tiver acesso ao banco não lê nada de ninguém.
--
-- Rode inteiro de uma vez. É seguro repetir: tudo é "if not exists".

create table if not exists public.cofre (
  usuario_id              uuid primary key references auth.users on delete cascade,
  custo                   smallint not null,
  sal_da_senha            text not null,
  sal_da_recuperacao      text not null,
  chave_pela_senha        text not null,
  chave_pela_recuperacao  text not null,
  criado_em               timestamptz not null default now(),
  atualizado_em           timestamptz not null default now()
);

create table if not exists public.dados (
  usuario_id  uuid not null references auth.users on delete cascade,
  chave       text not null,
  valor       text not null,
  -- Relógio da máquina que gravou. Serve para decidir qual lado é o mais novo.
  atualizado  bigint not null,
  -- Contador do servidor. Não depende de relógio e detecta quando os dois lados
  -- mexeram na mesma chave desde a última visita.
  versao      bigint not null default 1,
  primary key (usuario_id, chave),
  constraint chave_do_kairo check (chave ~ '^niko:[a-z0-9_-]{1,60}$'),
  constraint valor_com_limite check (length(valor) <= 30000000)
);

create index if not exists dados_por_usuario on public.dados (usuario_id, atualizado desc);

-- Cada gravação sobe a versão sozinha, sem o cliente poder escolher o número.
create or replace function public.subir_versao() returns trigger
language plpgsql as $$
begin
  new.versao := coalesce(old.versao, 0) + 1;
  return new;
end;
$$;

drop trigger if exists dados_sobe_versao on public.dados;
create trigger dados_sobe_versao before insert or update on public.dados
  for each row execute function public.subir_versao();

drop trigger if exists cofre_marca_atualizacao on public.cofre;
create or replace function public.marcar_atualizacao() returns trigger
language plpgsql as $$
begin
  new.atualizado_em := now();
  return new;
end;
$$;
create trigger cofre_marca_atualizacao before update on public.cofre
  for each row execute function public.marcar_atualizacao();

-- Sem isto qualquer pessoa com a chave pública lê a tabela inteira.
alter table public.cofre enable row level security;
alter table public.dados enable row level security;

drop policy if exists cofre_do_dono on public.cofre;
create policy cofre_do_dono on public.cofre
  for all to authenticated
  using (auth.uid() = usuario_id)
  with check (auth.uid() = usuario_id);

drop policy if exists dados_do_dono on public.dados;
create policy dados_do_dono on public.dados
  for all to authenticated
  using (auth.uid() = usuario_id)
  with check (auth.uid() = usuario_id);

-- Confira depois de rodar: as duas precisam aparecer com rowsecurity = true.
-- select relname, relrowsecurity from pg_class where relname in ('cofre', 'dados');
