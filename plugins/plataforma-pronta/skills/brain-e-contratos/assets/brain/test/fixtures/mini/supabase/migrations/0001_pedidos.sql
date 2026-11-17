-- Pedidos: a tabela principal
create table if not exists public.pedidos (
  id uuid primary key default gen_random_uuid(),
  total numeric(10, 2) not null,
  criado_em timestamptz default now(),
  constraint total_positivo check (total > 0)
);
alter table public.pedidos enable row level security;
create policy "dono lê" on public.pedidos for select using (true);
