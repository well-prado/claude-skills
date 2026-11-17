create table logs (id bigint, texto text);
create table catalogo (codigo text primary key);
create table itens (id text primary key);
alter table itens enable row level security;
create table temporaria (x int);
drop table temporaria;
alter table catalogo add column if not exists nome text;
create table rascunhos (id bigint);
do $do$
declare t text;
begin
  foreach t in array array['rascunhos'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy "ler %1$s" on %1$I for select using (true)', t);
  end loop;
end $do$;
