# Foto com Papai Noel — Sistema local de captura, vitrine e impressão

> Documento de referência do projeto. Para começar no Claude Code:
> *"Leia o PROJETO.md e vamos começar pela Fase 1."*

> **Atualização (2026-10-29):**
> - O computador central no evento pode ser **Mac ou Windows** (ainda não definido; o desenvolvimento é no Mac). Onde este documento diz "Mac" no papel de servidor/balcão, leia "computador central". O servidor e as páginas não podem depender de ferramenta de um sistema só (`sips`, `caffeinate`, `lp`/CUPS, launchd); o que for específico de sistema fica isolado em `scripts/`. Decidir o sistema antes da Fase 5 (ou junto com a impressora).
> - **A impressão fica para depois** (Fase 6). A prioridade é a foto chegar do iPhone ao servidor, à vitrine e ao balcão.
> - Stack ajustada: SQLite embutido do Node (`node:sqlite`, Node ≥ 22.13) no lugar do `better-sqlite3` (sem compilação nativa no Windows); HEIC→JPEG com `sharp` e fallback `heic-convert` (JS puro) no lugar do `sips`.

---

## 1. Contexto

Ação de fotos com Papai Noel em um shopping:

- O **fotógrafo** tira as fotos com um **iPhone**.
- Cada foto aparece **na hora** num **iPad** ao lado, que funciona como **vitrine/chamariz** (só exibe, sem interação do cliente).
- Ao mesmo tempo a foto chega num **Mac**, onde o **operador decide o que imprimir**.

### Restrições principais

1. **Zero dependência de internet.** A internet do shopping é ruim, então tudo roda numa rede Wi-Fi local própria.
2. **Nenhum recurso externo em tempo de execução:** nada de CDN, Google Fonts ou APIs na nuvem. Todo JS, CSS e fonte fica no projeto.
3. **Nenhuma foto pode se perder.** Se a rede piscar, o envio é refeito automaticamente.
4. **Impressora ainda indefinida.** O sistema imprime em qualquer impressora instalada no macOS (via CUPS/`lp`).

### Fora de escopo por enquanto (futuro)
- Moldura/arte de Natal aplicada na foto.
- QR code / envio digital para o cliente.
- Pagamento.
- App nativo iOS (ver seção 9: a arquitetura já está preparada para ele).

---

## 2. Arquitetura

```
              Roteador Wi-Fi próprio (SEM internet)
              /                 |                  \
        iPhone (Safari)     iPad (Safari)      Mac (servidor + balcão)
        /camera             /vitrine           /balcao
           |                    ^                  ^
           |  POST /api/photos  |  WebSocket       |  WebSocket
           +--------------------+------------------+
                                |
                          Servidor Node.js no Mac
                          - recebe e salva as fotos
                          - gera miniaturas
                          - avisa iPad e balcão em tempo real
                          - imprime via `lp` (CUPS)
```

- **O Mac é a central.** Um único servidor serve as 3 páginas, a API e o WebSocket.
- **Os clientes são "burros":** iPhone, iPad e balcão só falam com a API. Por isso dá para trocar a página do iPhone por um app nativo sem mexer no resto (seção 9).
- Endereço de acesso: `http://papainoel.local:3000`. Se o mDNS falhar, use o IP fixo do Mac (seção 7).

---

## 3. Stack

| Parte | Escolha | Motivo |
|---|---|---|
| Servidor | **Node.js (LTS) + Express** | simples, roda bem no Mac |
| Tempo real | **`ws`** (WebSocket puro) | leve, sem dependência de CDN |
| Upload | **`multer`** | multipart/form-data |
| Imagens | **`sharp`** (miniaturas, rotação EXIF) + **`sips`** do macOS como fallback para HEIC | `sips` já vem no Mac |
| Banco | **SQLite** via `better-sqlite3` | um arquivo, sem servidor, robusto |
| Descoberta (para o app nativo) | **`bonjour-service`** anunciando `_papainoel._tcp` | o app iOS acha o Mac sozinho |
| Impressão | `lp` / `lpstat` (CUPS nativo do macOS) | funciona com qualquer impressora instalada |
| Front-end | **HTML + JS puro (ou Vite gerando arquivos estáticos)** | tudo servido localmente |

---

## 4. Estrutura de pastas sugerida

```
papainoel/
├── PROJETO.md
├── package.json
├── server/
│   ├── index.js          # Express + WebSocket + Bonjour
│   ├── db.js             # SQLite: schema e queries
│   ├── routes/
│   │   ├── sessions.js
│   │   ├── photos.js
│   │   └── print.js
│   ├── images.js         # thumb/display, HEIC→JPEG, rotação EXIF
│   ├── printer.js        # wrapper de lp / lpstat
│   └── events.js         # broadcast WebSocket
├── public/
│   ├── camera/           # página do iPhone
│   ├── vitrine/          # página do iPad
│   ├── balcao/           # página do Mac (operador)
│   └── shared/           # CSS, JS comum, fontes locais
├── data/                 # NÃO versionar
│   ├── db.sqlite
│   └── fotos/AAAA-MM-DD/ # originais, display e thumbs
└── scripts/
    ├── start.sh          # sobe servidor + caffeinate
    └── backup.sh         # copia data/ para HD externo
```

---

## 5. Modelo de dados

### `sessions` (uma por família)
| campo | tipo | obs |
|---|---|---|
| id | TEXT (uuid) | |
| code | INTEGER | número curto exibido (ex.: **47**), reinicia por dia |
| created_at | TEXT ISO | |

### `photos`
| campo | tipo | obs |
|---|---|---|
| id | TEXT (uuid) | gerado pelo servidor |
| client_photo_id | TEXT UNIQUE | gerado pelo cliente → **idempotência** (reenvio não duplica) |
| session_id | TEXT | FK |
| path_original | TEXT | arquivo como recebido |
| path_display | TEXT | JPEG ~2048px para iPad/balcão |
| path_thumb | TEXT | JPEG ~400px |
| hidden_from_display | INTEGER 0/1 | ocultar da vitrine (pedido do cliente / LGPD) |
| print_count | INTEGER | quantas vezes foi impressa |
| created_at | TEXT ISO | |

---

## 6. Contrato da API (estável: o app nativo usará o mesmo)

Base: `http://papainoel.local:3000`

| Método | Rota | Corpo / resposta |
|---|---|---|
| `GET` | `/api/health` | `{ ok: true, version }`, usado pelos clientes para saber se o Mac está online |
| `POST` | `/api/sessions` | → `{ id, code }`: botão "Nova família" |
| `GET` | `/api/sessions/current` | → sessão atual `{ id, code }` |
| `POST` | `/api/photos` | multipart: `file`, `sessionId`, `clientPhotoId` → `{ id }`. Se o `clientPhotoId` já existe, devolve o mesmo `id` (200) |
| `GET` | `/api/photos?sessionId=&day=&since=&limit=` | lista de fotos (`day` = AAAA-MM-DD, dia da família) |
| `GET` | `/api/photos/:id/original` \| `/display` \| `/thumb` | arquivos de imagem |
| `PATCH` | `/api/photos/:id` | `{ hiddenFromDisplay: true }` |
| `GET` | `/api/printers` | lista de impressoras (`lpstat -p`) + padrão |
| `POST` | `/api/photos/:id/print` | `{ printer?, copies, media? }` → `{ jobId }` |

### Eventos WebSocket (`/ws`)
```json
{ "type": "session.created", "session": { "id": "...", "code": 47 } }
{ "type": "photo.created",   "photo":   { "id": "...", "sessionId": "...", "code": 47 } }
{ "type": "photo.updated",   "photo":   { "id": "...", "hiddenFromDisplay": true } }
{ "type": "print.queued",    "photoId": "...", "jobId": "..." }
```
Os clientes **sempre** reconectam automaticamente e, ao reconectar, buscam o que perderam via `GET /api/photos?since=`.

---

## 7. Infraestrutura no local do evento

- [ ] **Roteador Wi-Fi dedicado**, sem cabo de internet. Rede própria (ex.: `PapaiNoel`), senha forte.
- [ ] **Mac no roteador por cabo** (mais estável), ou Wi-Fi com sinal forte.
- [ ] **IP fixo para o Mac** (reserva DHCP no roteador), como plano B ao `.local`.
- [ ] Nome do Mac: *Ajustes → Geral → Compartilhamento → Nome do Host Local* = `papainoel`.
- [ ] **Firewall do macOS**: permitir conexões de entrada para o Node.
- [ ] **Mac sem dormir:** `caffeinate -dims` no `start.sh` + energia ligada na tomada.
- [ ] iPhone e iPad: **desligar "Endereço Wi-Fi privado"** para essa rede (evita trocas de identidade) e desligar o bloqueio automático de tela no iPad.
- [ ] iPad em **Acesso Guiado** (Ajustes → Acessibilidade) para travar na vitrine.
- [ ] Atenção: o iPhone às vezes alerta "rede sem internet" e pode tentar usar dados móveis. Manter conectado ao Wi-Fi do roteador e testar.

---

## 8. Fases de desenvolvimento

### Fase 1 — Servidor base
- [ ] Projeto Node, Express servindo `public/`, rota `/api/health`.
- [ ] SQLite com schema de `sessions` e `photos`.
- [ ] `POST /api/sessions` e `GET /api/sessions/current` (código diário incremental).
- [ ] `POST /api/photos` com idempotência por `clientPhotoId`.
- [ ] Processamento: corrigir rotação EXIF, converter HEIC→JPEG (`sharp`; fallback `sips -s format jpeg`), gerar `display` e `thumb`.
- [ ] Salvar em `data/fotos/AAAA-MM-DD/`.
- [ ] WebSocket `/ws` com broadcast de eventos.
- [ ] Anunciar `_papainoel._tcp` via Bonjour.
- *(Rotas de impressão ficam para a Fase 6.)*
- **Pronto quando:** dá para enviar uma foto via `curl` e ver o evento chegar num cliente WebSocket.

### Fase 2 — Página do iPhone (`/camera`)
- [ ] Botão grande **"📸 Tirar foto"** usando `<input type="file" accept="image/*" capture="environment">` (abre a câmera nativa, resolução total, funciona em `http`).
- [ ] Mostra o **código da família atual** em destaque + botão **"Nova família"** (pede confirmação).
- [ ] **Fila de envio offline:** cada foto vai para o IndexedDB com um `clientPhotoId` (uuid) e só sai da fila quando o servidor confirma. Retenta com backoff.
- [ ] Indicador de status: online/offline, fotos pendentes, última enviada.
- [ ] Interface pensada primeiro para a horizontal: dois botões meio a meio ("Nova família", com o código, e "Tirar foto") e, embaixo, uma faixa com as últimas fotos, indicando se cada uma já foi enviada (⏳ ou ✓).
- [ ] Manifest PWA para "Adicionar à Tela de Início" (ícone, tela cheia).
- **Pronto quando:** dá para tirar foto com o Wi-Fi desligado, religar e ver a foto chegar sozinha, sem duplicar.

### Fase 3 — Vitrine do iPad (`/vitrine`)
- [ ] Tela cheia, fundo escuro, visual natalino simples.
- [ ] Ao receber `photo.created`: exibe a foto **grande** com o código da família e a mantém na tela por ~1 min (configurável).
- [ ] Após ~1 min sem foto nova: **slideshow** aleatório das fotos recentes (ex.: últimas 2 h), respeitando `hidden_from_display`.
- [ ] Pré-carregar a imagem antes de trocar (sem "piscar").
- [ ] Reconexão automática + aviso discreto se perder conexão.
- [ ] Wake Lock / evitar que a tela apague.
- **Pronto quando:** fica horas ligada sem travar e mostra cada foto nova em menos de 2 s.

### Fase 4 — Balcão do Mac (`/balcao`)
- [ ] Fotos chegando em tempo real, **agrupadas por família** (código grande).
- [ ] **Busca pelo código** ("sou a 47").
- [ ] Visualização ampliada e botão **Abrir original** (para imprimir manualmente até a Fase 6). Seleção de fotos e cópias entram com a impressão.
- [ ] Botão **"Ocultar da vitrine"**.
- **Pronto quando:** o operador acha qualquer foto pelo código da família e vê as fotos novas chegando em tempo real.
- *(Impressão movida para a Fase 6.)*

### Fase 5 — Robustez e operação
- [x] Dois cliques para iniciar, no Mac (`Iniciar no Mac.command`) e no Windows (`Iniciar no Windows.bat`): sobem o servidor, impedem o computador de dormir e abrem o balcão.
- [x] `scripts/supervisor.js`: reinicia o servidor se ele cair ou parar de responder.
- [x] Logs em arquivo (`data/logs/AAAA-MM-DD.log`).
- [x] Página `/status`: fotos e famílias do dia, telas conectadas, espaço em disco.
- [ ] **Pendente para o futuro:** backup de `data/` para HD externo (manual + a cada X min, sugestão: 10 min).
- [ ] **Pendente para o futuro:** iniciar sozinho ao ligar o computador, depois de definir o sistema do evento.
- [ ] **Teste de estresse:** 300+ fotos seguidas, Wi-Fi caindo no meio, Mac reiniciando.

### Fase 6 — Futuro
- [ ] **Impressão:** `GET /api/printers`, `POST /api/photos/:id/print`, evento `print.queued`, seleção de foto(s), seletor de impressora e tamanho de papel no balcão, quantidade de cópias, marcar fotos já impressas (`print_count`). Mecanismo a definir quando a impressora e o sistema do computador forem escolhidos.
- [ ] Moldura/arte de Natal (aplicada no servidor com `sharp`, mantendo o original).
- [ ] Layout de impressão (várias fotos por folha, margens por tamanho de papel).
- [ ] App nativo iOS (seção 9).

---

## 9. Caminho para o app nativo iOS (quando/se precisar)

**Motivo para migrar:** na versão web, a cada foto o fotógrafo precisa tocar em "Usar foto". O app nativo permite **um toque = uma foto enviada**, sequência rápida e disparador Bluetooth.

**O que muda:** só o cliente do iPhone. Servidor, vitrine e balcão continuam iguais, porque o app usa **exatamente a mesma API** da seção 6.

### Plano
- [ ] Projeto **SwiftUI** no Xcode, alvo iPhone.
- [ ] Câmera própria com **AVFoundation** (`AVCapturePhotoOutput`), salvando em JPEG de alta qualidade.
- [ ] **Descoberta automática do Mac** via Bonjour (`NWBrowser` procurando `_papainoel._tcp`), com fallback de IP manual nas configurações.
- [ ] **Fila offline persistente** (arquivos em disco + registro local), mesmo `clientPhotoId` para idempotência.
- [ ] Upload multipart para `POST /api/photos`. Mostrar código da família e botão "Nova família".
- [ ] Suporte a **botão de volume / disparador Bluetooth** como obturador.
- [ ] `Info.plist`:
  - `NSCameraUsageDescription`
  - `NSLocalNetworkUsageDescription`
  - `NSBonjourServices` = `["_papainoel._tcp"]`
  - `NSAppTransportSecurity` → `NSAllowsLocalNetworking = true` (permite `http` na rede local)

### Instalação
- **Apple ID gratuito:** instala pelo Xcode via cabo; **expira a cada 7 dias**. Definir reinstalação fixa semanal (ex.: segunda antes de abrir). Exige "Modo de Desenvolvedor" ligado no iPhone.
- **Apple Developer Program (~US$ 99/ano):** vale 1 ano, permite TestFlight. Recomendado se o app nativo for para o evento.

> Dica: manter a página web `/camera` funcionando mesmo depois do app nativo. Ela é o **plano B** se o app expirar ou der problema no dia.

---

## 10. Checklist de teste antes do evento

### Pendências para concluir as Fases 3 e 4
- [ ] **Vitrine (Fase 3):** fica algumas horas ligada, na tomada, sem travar, continua trocando as fotos e a tela não apaga.
- [ ] **Balcão (Fase 4), busca:** digitar o código mostra só aquela família; um código inexistente mostra a mensagem; `Esc` limpa.
- [ ] **Balcão (Fase 4), ocultar:** "Ocultar da vitrine" tira a foto do iPad na hora e "Mostrar na vitrine" traz de volta.
- [ ] **Balcão (Fase 4), original:** "Abrir original" abre a foto na orientação certa e dá para imprimir ou salvar em PDF.
- [ ] **Balcão (Fase 4), queda:** ao parar o servidor aparece o aviso; ao ligar de novo, o aviso some e as fotos perdidas aparecem.

### Pendências da Fase 5
- [ ] **Estresse completo:** `npm run estresse` com 300+ fotos, derrubando o Wi-Fi e reiniciando o computador no meio.
- [ ] **Windows:** num PC Windows, rodar `npm install` e dar dois cliques em `Iniciar no Windows.bat`. Conferir se o balcão abre, se o servidor volta após ser encerrado à força, se a tela não apaga e se os logs são gravados.
- [ ] **Firewall do Windows:** permitir o Node na rede privada e confirmar o acesso pelo iPhone e pelo iPad.

### Evento completo

- [ ] Montar tudo **em casa com o roteador desconectado da internet**.
- [ ] Tirar 50 fotos seguidas: todas chegam no iPad e no balcão, sem duplicata.
- [ ] Desligar o Wi-Fi do iPhone no meio, tirar 5 fotos, religar: todas chegam.
- [ ] Reiniciar o Mac no meio: iPhone segura a fila, iPad e balcão reconectam sozinhos.
- [ ] Deixar a vitrine ligada por 8 h seguidas.
- [ ] Imprimir na impressora real, no tamanho real de papel, conferindo corte e cores.
- [ ] Backup para HD externo funcionando.
- [ ] Bateria: iPhone e iPad aguentam o turno? (Levar carregadores/power bank.)

---

## 11. Decisões em aberto

- [ ] Modelo da impressora e tamanho da foto (10x15, 15x20…).
- [ ] Quanto tempo a vitrine mostra cada foto nova, e quantas horas de histórico entram no slideshow.
- [ ] Aviso de privacidade/LGPD no local (placa) e política de exclusão das fotos após o evento.
- [ ] Web vs. nativo para o iPhone: decidir após os testes da Fase 2.
