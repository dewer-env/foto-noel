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
| `GET` | `/api/printer` | impressora e papéis que o servidor encontrou: `{ supported, printer, sizes, papers, printers }` |
| `POST` | `/api/photos/:id/print` | `{ size: "4x6" \| "6x8" }` → `{ printer, paper, size, printCount }`; avisa `photo.printed`. Só com o servidor no Windows (senão 501). |

### Eventos WebSocket (`/ws`)
```json
{ "type": "session.created", "session": { "id": "...", "code": 47 } }
{ "type": "photo.created",   "photo":   { "id": "...", "sessionId": "...", "code": 47 } }
{ "type": "photo.updated",   "photo":   { "id": "...", "hiddenFromDisplay": true } }
{ "type": "photo.printed",   "photo":   { "id": "...", "printCount": 2 } }
```
*(Evento `print.queued` fica para quando houver controle das impressões.)*
Os clientes **sempre** reconectam automaticamente e, ao reconectar, buscam o que perderam via `GET /api/photos?since=`.

---

## 7. Infraestrutura no local do evento

- [ ] **Roteador Wi-Fi dedicado**, sem cabo de internet. Rede própria (ex.: `PapaiNoel`), senha forte.
- [ ] **Computador no Wi-Fi** (decisão de 2026-11-05: só Wi-Fi, sem cabo, para simplificar). Deixar o computador perto do roteador, com sinal forte, e de preferência na rede de 5 GHz.
- [x] **IP fixo por reserva DHCP no roteador** só para o Windows, em `192.168.100.10` (roteador ZTE, gateway `192.168.100.1`) (decisão de 2026-11-05). A reserva é do adaptador Wi-Fi e exige o endereço físico fixo: desligar "Endereços de hardware aleatórios" para a rede. Testado em 2026-11-05: funciona e continua igual depois de reiniciar; ícones na Tela de Início do iPhone e do iPad. O Mac fica sem reserva.
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
- *(Os testes que faltam estão na etapa final, seção 10.)*

### Fase 6 — Futuro
- [x] **Impressão direta na Kodak 305, só no Windows (2026-11-05):** dois botões na foto ampliada do balcão, "Imprimir 10x15" e "Imprimir 15x20", sem diálogo. O servidor (`server/printing.js`) acha a Kodak pelo nome, escolhe o papel do driver pelas medidas e chama `server/imprimir.ps1`, que usa a impressão nativa do Windows. Imprime uma versão em JPEG, em resolução total e já girada (`_versoes/<id>-print.jpg`, gerada na primeira impressão). A foto preenche a folha, como no app da Kodak, cortando o excesso no centro; uma impressão vai por vez. `GET /api/printer` mostra o que o servidor encontrou.
- [x] **Contagem de impressões (2026-11-05):** quando o Windows aceita a impressão, o servidor soma 1 em `print_count` e avisa `photo.printed`. O balcão mostra "🖨 2x" na miniatura e "Impressa 2x" ou "Ainda não impressa" na foto ampliada, igual em todos os balcões abertos. A contagem não diz se o papel saiu de fato da impressora.
- **Decidido em 2026-11-05: sem quantidade de cópias e sem seleção de várias fotos**, para manter a impressão simples e com menos chance de erro. Cada clique imprime uma cópia.
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

## 10. Etapa final de testes

Todos os testes que faltam ficam aqui e serão feitos juntos, numa última etapa, depois de terminar o desenvolvimento. Nenhum deles impede avançar nas outras fases.

### Já testado
- [x] **Windows, funcionamento básico:** o sistema rodou num PC Windows, com acesso pela rede local, e também funcionou com o Mac ligado ao mesmo tempo.
- [x] **Mac, Fase 5:** dois cliques para iniciar, reinício após `kill -9`, logs, encerramento limpo e estresse de 15 fotos com o servidor derrubado no meio (nenhuma perdida ou duplicada).

### 1. Balcão
- [ ] **Busca:** digitar o código mostra só aquela família; um código inexistente mostra a mensagem; `Esc` limpa.
- [ ] **Ocultar:** "Ocultar da vitrine" tira a foto do iPad na hora e "Mostrar na vitrine" traz de volta.
- [ ] **Original:** "Abrir original" abre a foto na orientação certa e dá para imprimir ou salvar em PDF.
- [ ] **Queda:** ao parar o servidor aparece o aviso; ao ligar de novo, o aviso some e as fotos perdidas aparecem.

### 2. Robustez do computador
- [ ] **Status:** a página `/status` mostra fotos e famílias do dia, telas conectadas e espaço em disco.
- [ ] **Queda só do servidor no Windows:** com a janela aberta, encerrar apenas o processo da porta 3000 (comando abaixo). Ele deve voltar sozinho e o log deve registrar `servidor parou`. Fechar a janela, ao contrário, deve deixar tudo desligado.
  `Get-NetTCPConnection -LocalPort 3000 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }`
- [ ] **Servidor travado:** quando ele para de responder sem cair, o supervisor reinicia em cerca de 30 s.
- [ ] **Computador acordado no Windows:** a tela não apaga. `powercfg /requests`, como administrador, mostra um processo `powershell` em DISPLAY e SYSTEM.
- [ ] **Logs no Windows:** o arquivo do dia é gravado em `data\logs\`.
- [ ] **Estresse completo:** `npm run estresse` com 300+ fotos, derrubando o Wi-Fi e reiniciando o computador no meio.

### 3. Evento completo
Fazer no computador escolhido para o evento.
- [ ] Montar tudo **em casa com o roteador desconectado da internet**.
- [ ] Tirar 50 fotos seguidas: todas chegam no iPad e no balcão, sem duplicata.
- [ ] Desligar o Wi-Fi do iPhone no meio, tirar 5 fotos, religar: todas chegam.
- [ ] Reiniciar o computador no meio: iPhone segura a fila, iPad e balcão reconectam sozinhos.
- [ ] Deixar a vitrine ligada por 8 h seguidas, na tomada: não trava, continua trocando as fotos e a tela não apaga.
- [ ] Testar com o fotógrafo real, para decidir entre web e app nativo: o toque extra em "Usar foto" atrapalha o ritmo?
- [ ] Bateria: iPhone e iPad aguentam o turno? (Levar carregadores/power bank.)

### 4. Impressão na Kodak 305 (Windows)
- [x] **Driver:** instalado no Windows (2026-11-05).
- [x] **Lista de papéis:** `imprimir.ps1 -Mode list` rodou no Windows e encontrou a `KODAK 305 Photo Printer`. O driver informa os papéis com sobra para a impressão sem borda (`4 x 6 in (102 x 152 mm)` = 409x622, `6 x 8 in (152 x 203 mm)` = 622x811), e o servidor escolhe esses dois, sem as variantes "x 2" e "border".
- [x] **O que o servidor encontrou:** `http://localhost:3000/api/printer` mostra a Kodak em `printer` e um papel em `4x6` e em `6x8`. Se algum vier `null`, mandar a resposta inteira.
- [x] **Botões (2026-11-05: os dois tamanhos, na horizontal e na vertical):** "Imprimir 10x15" e "Imprimir 15x20" imprimem a foto certa, preenchendo a folha sem faixas brancas, sem diálogo, tanto na horizontal quanto na vertical. No 10x15, conferir se o corte de cerca de 7% em cima e embaixo não corta cabeças.
- [ ] **Papel real:** conferir corte, margem, cores e o tempo por cópia nos dois tamanhos.
- [ ] **Erros:** com a Kodak desligada ou sem papel, o balcão mostra uma mensagem clara e o log do dia registra o motivo.
- [ ] **Foto em HEIC:** imprime normalmente, já que a versão de impressão é convertida para JPEG.
- [ ] **Contagem:** cada impressão aceita soma 1 na miniatura e na foto ampliada; uma impressão com erro não soma; a contagem aparece em outro balcão aberto sem recarregar e continua depois de reiniciar o servidor.

### 5. Depende do que ainda será feito
- [ ] Backup para HD externo funcionando (pendente da Fase 5).
- [ ] Iniciar sozinho ao ligar o computador (pendente da Fase 5).

---

## 11. Decisões em aberto

- [x] Modelo da impressora: Kodak 305.
- [x] Tamanho da foto: duas opções, 10x15 e 15x20 (2026-11-05). A foto preenche a folha, como no app da Kodak. O 15x20 tem quase a mesma proporção 4:3 da câmera do iPhone (corte de cerca de 2%); no 10x15 corta cerca de 7% em cima e 7% embaixo numa foto horizontal, então o fotógrafo deve deixar uma folga no enquadramento.
- [ ] Computador do evento. A impressão, por enquanto, só funciona com o servidor no Windows.
- [ ] Quanto tempo a vitrine mostra cada foto nova, e quantas horas de histórico entram no slideshow.
- [ ] Aviso de privacidade/LGPD no local (placa) e política de exclusão das fotos após o evento.
- [ ] Web vs. nativo para o iPhone: decidir após os testes da Fase 2.
