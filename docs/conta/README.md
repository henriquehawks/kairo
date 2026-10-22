# Conta e sincronização

A conta existe para uma coisa só: os dados da pessoa acompanharem ela quando trocar
de computador. Tudo é cifrado antes de sair da máquina — o servidor guarda, mas não
consegue ler.

A conta está ligada desde a 0.3.3. `KAIRO_CONTA=0` desliga numa máquina só, sem
precisar de versão nova — é a saída de emergência. Com ela desligada as
rotas respondem `{ disponivel: false, emTestes: true }` e a seção some da interface,
do mesmo jeito que o Google Workspace.

## As peças

| Arquivo | Responsabilidade |
| --- | --- |
| `servidor/cofreDeDados.ts` | Criptografia. Puro, sem rede. |
| `servidor/contaSupabase.ts` | Único lugar que conhece o formato da Supabase. |
| `servidor/conta.ts` | Cadastro, login, recuperação. Junta cofre, servidor e cofre do SO. |
| `servidor/decisaoDeSincronizacao.ts` | O que sobe, o que desce, o que é conflito. Puro. |
| `servidor/sincronizacao.ts` | Executa o plano, com backup antes de gravar. |
| `servidor/rotasDaConta.ts` | Rotas `/ponte/conta/*`, atrás da trava. |
| `src/estado/conta.ts` | Estado na interface. Não é persistido de propósito. |
| `src/desktop/sincroniaDaConta.ts` | Gatilhos. Monta **só** na janela do sistema. |
| `src/modulos/configuracoes/SecaoConta.tsx` | A tela, dentro de Configurações. |

O código de conta vive em `servidor/` porque a CSP só deixa a interface falar com a
ponte (`connect-src ... http://127.0.0.1:47831`). Isso é proposital e não precisa
mudar: é a mesma regra que vale para todo o resto que usa rede.

## Como a criptografia funciona

Os dados **não** são cifrados pela senha. São cifrados por uma chave mestra sorteada,
e essa chave é guardada duas vezes no servidor: embrulhada por uma derivação da senha,
e embrulhada por uma derivação do código de recuperação.

Daí vêm duas propriedades:

- Trocar a senha re-embrulha a chave mestra. Nenhum dado é cifrado de novo.
- Existe um caminho de volta que não depende do dono do servidor.

A senha que vai para o login da Supabase é derivada por um caminho separado da que
abre o cofre, então quem guarda o login nunca recebe o material que abre os dados.

**Consequência que precisa estar clara para quem usa:** esquecer a senha e perder o
código de recuperação significa perder os dados da conta. Não há como contornar —
é o preço de o servidor não conseguir ler nada. Os dados locais continuam intactos.

## Como a sincronização decide

Cada chave guarda o JSON inteiro de uma área (`niko:financas` é todas as transações).
Então "o mais recente vence" resolve por área, não por registro.

- A coluna `atualizado` é o relógio da máquina que gravou.
- A coluna `versao` sobe sozinha por gatilho no Postgres, e é ela que detecta mudança
  dos dois lados sem depender de relógio nenhum.
- Mexeu nos dois lados: o mais recente vence, **mas** o conflito é registrado e um
  backup é feito antes de gravar.

O primeiro encontro entre uma máquina e uma conta tem três regras, e são elas que
evitam a perda de dados clássica:

1. Servidor vazio + dados aqui → **sobe**. Nunca o contrário.
2. Máquina nova + conta com dados → baixa.
3. Os dois com dados → **pergunta**. Nada acontece até a pessoa escolher.

## Criar o projeto na Supabase

1. Criar o projeto. Região São Paulo (`sa-east-1`), pela latência e pelos dados
   ficarem no país. O plano grátis basta e não pede cartão.
2. Guardar a *database password* no gerenciador de senhas. O Kairo não usa, mas
   recuperá-la depois dá trabalho.
3. Rodar `docs/conta/esquema.sql` inteiro no SQL Editor. É seguro repetir.
4. Conferir a RLS:
   ```sql
   select relname, relrowsecurity from pg_class where relname in ('cofre', 'dados');
   ```
   As duas precisam vir `true`. Sem isso, a chave que vai dentro do app lê a tabela
   inteira de todo mundo.
5. Confirmar que uma consulta sem login devolve lista vazia:
   ```bash
   curl -s "$URL/rest/v1/dados?select=*" -H "apikey: $CHAVE" -H "Authorization: Bearer $CHAVE"
   ```
6. Copiar a *Project URL* e a chave **publishable** (`sb_publishable_...`) de
   Settings → API Keys para `servidor/configuracaoDaConta.ts`.

A chave publicável é feita para ficar à vista: ela vai dentro do app instalado. Quem
protege os dados é a RLS, e por cima dela a criptografia.

**A chave `sb_secret_` nunca entra no repositório.** Ela ignora a RLS.

## O projeto pausa sozinho

Projeto grátis é pausado depois de uma semana sem atividade no banco. O workflow
`.github/workflows/manter-conta-ativa.yml` faz uma consulta por dia para evitar isso,
e de quebra falha se a resposta sem login trouxer dados — ou seja, serve de sentinela
da RLS.

## O que ainda não existe

- Arquivos de Estudos não sincronizam. Ficam em disco, fora do banco.
- `provedores.json` e `conexoes.json` não sincronizam.
- Chaves de IA e tokens de conexões **não sincronizam de propósito**: ficam no cofre
  do sistema operacional e precisam ser recadastrados na máquina nova.
- Exclusão de conta pelo app. O `on delete cascade` já está no esquema; falta a tela.
