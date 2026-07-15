# `context/glossary.md` — Dicionário Alfabético de Termos Técnicos

> **STATE: ACTIVE** — Dicionário — adições ok; remoção de termo obsoleto requer nota.
> Mudança de estado requer entrada em `memory/implementation-history.md`
> e, se estrutural, novo ADR em `decisions/ADR-NNNN.md`.

> **Divisão de responsabilidade (vs `terminology.md`):**
>
> - **`glossary.md` (este arquivo):** dicionário alfabético de
>   termos técnicos gerais da indústria (Blockchain, Trading,
>   RPC, Ethereum, Segurança, IA). Termos que você encontraria
>   em documentação externa.
> - **`terminology.md`:** convenções internas do projeto. Nomes
>   oficiais de módulos, acrônimos utilizados, significado
>   operacional.
>
> Não duplicar. Se o termo é específico do projeto, vai em
> `terminology.md`. Se é conceito geral da indústria, vai aqui.

---

## A

### ABI (Application Binary Interface)

Especificação de como interagir com um contrato Ethereum a partir
de fora da blockchain. Inclui assinaturas de funções, eventos, e
structs. Necessária para codificar/decodificar chamadas via
ethers/viem.

### Address (Ethereum)

Identificador de 20 bytes (40 hex chars + `0x` prefix) que
representa uma conta (EOA) ou contrato na blockchain Ethereum.
Formato checksum (EIP-55) mistura upper/lowercase para detectar
typos.

### AML (Anti-Money Laundering)

Conjunto de regulamentos que exigem que exchanges e provedores
de serviços financeiros monitorem e reportem transações
suspeitas. Em cripto, aplica-se principalmente a CEXs (Binance,
Coinbase).

### Anvil

Ferramenta do Foundry que roda um node Ethereum local para
desenvolvimento. Suporta fork de mainnet (replay de estado)
para testes de integração.

---

## B

### BPS (Basis Points)

Unidade de medida para taxas e percentages. 1 bps = 0.01%. 100
bps = 1%. Usado em slippage tolerance, taxas de trading,
impacto de preço.

### BSC (Binance Smart Chain)

Blockchain EVM-compatible lançada pela Binance em 2020. Mainnet
chainId 56. Block time ~3s. Gas fees baixas comparadas ao
Ethereum mainnet. Rede primária do projeto.

### Block

Unidade de dados na blockchain. Contém transações, header
(number, parentHash, stateRoot, etc.), e ommers/uncles. Em BSC,
blocos são produzidos a cada ~3 segundos.

### Broadcast (submeter tx)

Ato de enviar uma transação assinada para a rede blockchain via
`eth_sendRawTransaction`. O node propaga para seus pares (mempool
propagation) e o validador a inclui em um bloco.

### Broadcaster

No contexto deste projeto, módulo M3.3 que recebe uma tx assinada
e a envia para o RPC quorum. Lida com retries, gas bumping, e
nonce management.

---

## C

### Canary release

Estratégia de rollout onde uma mudança é exposta a uma pequena
porcentagem do tráfego primeiro (ex.: 1%), expandida gradualmente
se nada quebra, e revertida se regressão é detectada. No projeto,
implementado via `canaryPct` no `CanaryBroadcaster`.

### CELO

Blockchain EVM-compatible focada em mobile payments. Não usada
neste projeto.

### ChainId

Identificador único de uma blockchain. Ethereum mainnet = 1,
BSC mainnet = 56, Base = 8453. Usado para prevenir replay attacks
entre chains.

### Checksum address

Endereço Ethereum com case mixing (uppercase letters) que
funciona como checksum (EIP-55). Permite detectar typos em
endereços. Ex.: `0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed`.

### Cold wallet

Carteira offline usada para armazenar fundos de longo prazo.
Típico: hardware wallet (Ledger, Trezor) ou paper wallet.
Oposto de hot wallet.

### Contract verification

Verificação de que o source code de um contrato corresponde ao
bytecode deployado. Feito via Etherscan/Sourcify. Sem verificação,
o contrato é uma "caixa preta" e deve ser tratado como não
confiável.

### Counter (métrica)

Tipo de métrica que só incrementa (nunca decrementa). Usada para
contar eventos (tx count, error count, request count).

---

## D

### DApp (Decentralized Application)

Aplicação que usa smart contracts como backend. Frontend tipicamente
em React/Vue, comunicando com a blockchain via ethers/viem.

### DDoS (Distributed Denial of Service)

Ataque onde múltiphos hosts (frequentemente botnet) sobrecarregam
um serviço com requests. Em cripto, pode atacar RPC nodes,
exchanges, ou o próprio contrato.

### DexScreener

Serviço que agrega dados de DEXs (PancakeSwap, Uniswap, etc.):
preços, liquidez, volume, pares. Usado no projeto para
`TokenSelector` e `PriceFeed` em DEX mode.

### Drawdown

Queda percentual do pico de equity até o ponto atual. Métrica
de risco. RiskManager tem circuit breaker que para o engine se
drawdown > threshold (ex.: 20%).

---

## E

### EIP (Ethereum Improvement Proposal)

Documento que propõe mudança no protocolo Ethereum ou convenção
da comunidade. EIPs importantes: EIP-55 (checksum address),
EIP-155 (chainId em tx), EIP-1193 (provider API), EIP-712
(typed data signing).

### EOA (Externally Owned Account)

Conta Ethereum controlada por chave privada (em oposição a
contract account). Pode enviar transações; não tem código.

### ERC-20

Padrão de token fungível na Ethereum (EIP-20). Define interface
mínima: `transfer`, `approve`, `transferFrom`, `balanceOf`,
`allowance`. Maioria dos tokens USDC, USDT, UNI, etc. são ERC-20.

### ERC-721

Padrão de token não-fungível (NFT) na Ethereum (EIP-721). Cada
token é único.

### Etherscan

Block explorer para Ethereum e EVM-compatible chains (BscScan
para BSC). Mostra transações, contratos (com ABI se verificado),
eventos, holders. Usado no projeto para `ContractVerification`.

### EVM (Ethereum Virtual Machine)

Máquina virtual que executa smart contracts em blockchains
EVM-compatible (Ethereum, BSC, Base, Arbitrum, Optimism, etc.).
Permite reuso de tooling e contratos entre chains.

---

## F

### Fencing token

Inteiro monotônico crescente emitido por um sistema de lock
distribuído. Permite que recursos (ex.: broadcaster) rejeitem
operações de writers stale. Padrão descrito por Martin Kleppmann
em "How to do distributed locking" (2016).

### Fork (blockchain)

1. **Hard fork:** mudança no protocolo que quebra compatibilidade
   (ex.: ETH/ETC split).
2. **Soft fork:** mudança backwards-compatible.
3. **Chain fork:** dois blocos válidos no mesmo height; resolved
   pela regra de "longest chain wins".
4. **Test fork:** anvil/hardhat faz fork de mainnet state para
   testes locais.

### Front-running

Ataque onde um adversário observa uma tx no mempool e envia sua
própria tx com gas price maior para ser incluída primeiro. Em
DEXs, pode ser usado para comprar um token antes da vítima e
revender imediatamente após.

---

## G

### Gas

Unidade de medida do esforço computacional de uma operação na
EVM. Usuários pagam gas fees em ETH/BNB para que validadores
processem suas transações. Gas price é medido em gwei (1 gwei =
10^-9 ETH).

### Gas bumping

Técnica de aumentar o gas price de uma tx pendente para acelerar
sua inclusão em bloco. Implementado no `Broadcaster` (M3.3) para
retries.

### Gauge (métrica)

Tipo de métrica que pode incrementar, decrementar, ou ser setada
para um valor absoluto. Usada para valores que sobem e descem
(heap used, active connections, canaryPct).

### Gwei

Sub-unidade de ETH/BNB. 1 gwei = 10^-9 ETH. Usado para gas price.

---

## H

### Hash-chain

Sequência de entradas onde cada entrada inclui o hash da
anterior. Permite detectar tampering (modificar uma entrada
quebra a cadeia). Usado no audit log do projeto (H0).

### Histogram (métrica)

Tipo de métrica que observa distribuição de valores em buckets.
Usada para latências, tamanhos, durações. Permite calcular
p50, p90, p99.

### Hot wallet

Carteira online conectada à internet. Necessária para operações
automatizadas, mas maior risco de comprometimento. Oposto de
cold wallet.

---

## I

### IPC (Inter-Process Communication)

Comunicação entre processos no mesmo host. Pode ser via pipes
(stdin/stdout), sockets, shared memory, ou message queues. No
projeto, engine e signer comunicam via stdin/stdout com
protocolo binário.

### Impermanent loss

Perda que ocorre em LPs (Liquidity Providers) de AMMs quando o
preço relativo dos tokens muda. Não é "perda" até que a posição
seja retirada, daí "impermanent".

---

## K

### KDF (Key Derivation Function)

Função que deriva uma chave criptograficamente forte de uma
entrada de baixa entropia (ex.: password). PBKDF2, scrypt,
argon2 são KDFs comuns. BIP-39 usa PBKDF2 para derivar seed de
mnemonic.

### KMS (Key Management Service)

Serviço para gerenciar chaves criptográficas de forma segura.
AWS KMS, GCP KMS, HashiCorp Vault são exemplos. No projeto, M6+
usa Vault/KMS para mnemonic do signer.

---

## L

### Lease (distributed lock)

Mecanismo de coordenação distribuída que garante que apenas um
processo execute uma operação crítica por vez. Tipicamente tem
TTL (time-to-live) — se o holder crasha, a lease expira. No
projeto, `WriterLease` (M4) implementa lease com fencing tokens.

### Liquidity

Capacidade de comprar/vender um asset sem afetar
significativamente o preço. Liquidez alta = spread baixo = baixo
slippage. Liquidez baixa = spread alto = alto slippage. Em DEXs,
medida via TVL (Total Value Locked) no pool.

### LLM (Large Language Model)

Modelo de linguagem treinado em grandes quantidades de texto.
GLM-4.6 (via z-ai-web-dev-sdk) é usado no ScamDetector para
análise de tokens.

---

## M

### Mainnet

Rede principal de uma blockchain (em oposição a testnet). Tem
valor econômico real. BSC mainnet chainId 56.

### MEV (Maximal Extractable Value)

Valor que pode ser extraído por um validador/miner ao reordenar,
incluir, ou excluir transações em um bloco. Inclui sandwich
attacks, arbitragem, liquidações. Mitigado no projeto via
`MevBaseline` (H1.4).

### Membrane / Mempool

Conjunto de transações pendentes esperando inclusão em bloco.
Validadores pegam do mempool para construir blocos. Público em
Ethereum (qualquer node pode ver); privado em Flashbots Protect.

### Mnemonic (seed phrase)

Sequência de 12 ou 24 palavras que deriva uma chave privada.
Definido em BIP-39. Permite backup human-legível de carteiras.
NUNCA deve ser compartilhada ou logada.

---

## N

### Nonce

Número que garante que cada transação de um endereço é única.
Incrementa a cada tx enviada. Em PoW blockchain, também se
refere ao número usado no mining.

---

## P

### Paper trading

Simulação de trading sem dinheiro real. Ordens são simuladas com
preços reais, mas nenhuma tx é enviada para a blockchain. Útil
para validar estratégias sem risco. Modo default do projeto.

### PancakeSwap

DEX principal da BSC. AMM (Automated Market Maker) similar ao
Uniswap. Usado implicitamente via DexScreener no projeto.

### Prisma

ORM TypeScript-friendly usado no projeto. Define schema em
`schema.prisma`, gera client tipado, e gerencia migrations.

---

## R

### RPC (Remote Procedure Call)

Protocolo de chamada remota. Em blockchain, JSON-RPC 2.0 é o
padrão para falar com nodes. Métodos comuns: `eth_call`,
`eth_sendRawTransaction`, `eth_getBalance`, etc.

### Reentrancy

Vulnerabilidade de smart contract onde uma função externa (ex.:
`transfer`) chama de volta o contrato original antes de
atualizar estado. Famosa pelo hack do DAO (2016). Mitigada via
checks-effects-interactions pattern ou mutex.

### Rollup

Solução de scaling L2 que processa transações off-chain e
postsa dados para L1. Optimistic rollups (Optimism, Arbitrum)
e zero-knowledge rollups (zkSync, StarkNet) são tipos.

---

## S

### Sandwich attack

Ataque MEV onde o atacante coloca uma ordem antes (front-run) e
depois (back-run) de uma vítima, capturando a diferença de
preço. Vítima paga preço pior; atacante lucra. Mitigado no
projeto via `MevBaseline` (H1.4).

### Scam token

Token fraudulento projetado para roubar fundos de investidores.
Táticas: honeypot (compra OK, venda reverte), rug pull
(criador remove liquidez), tax exorbitante, fake name/symbol
impersonating real token.

### Shadow run

Técnica de validação onde uma mudança é executada em paralelo
com a versão atual, mas o output da versão nova é descartado.
Permite comparar resultados sem afetar produção. Implementado
em M5.2.

### Slippage

Diferença entre o preço esperado de uma ordem e o preço real
executado. Causado por mudanças no AMM pool entre submit e
execução. Tolerância configurável em BPS (ex.: 30 = 0.3%).

### Smart contract

Programa que roda na blockchain. Imutável após deploy (salvo
upgrade patterns). Define regras automáticas sem intermediário.

### Stablecoin

Token cujo valor é atrelado a um asset estável (geralmente USD).
USDC, USDT, DAI são exemplos. USDC é a unidade de reserve e
trading no projeto.

---

## T

### Testnet

Rede de teste de uma blockchain. Não tem valor econômico.
BSC testnet chainId 97. Usada para testes antes de mainnet.

### TP (Take Profit)

Ordem que fecha automaticamente uma posição quando o preço atinge
um nível favorável predefinido. Implementado no `Portfolio`.

### Tx (Transaction)

Operação que muda o estado da blockchain. Assinada por um EOA,
inclui `from`, `to`, `value`, `data`, `gas`, `gasPrice`, `nonce`.
Confirmada quando incluída em um bloco.

---

## V

### Vault (HashiCorp)

Ferramenta de secret management. Armazena segredos
criptografados, controla acesso via policies, audita acessos.
No projeto, M6+ usa Vault para mnemonic do signer.

---

## W

### Wallet

Software ou hardware que gerencia chaves privadas e facilita
interação com a blockchain. MetaMask (software), Ledger
(hardware), WalletConnect (protocolo) são exemplos.

### Wei

Menor unidade de ETH/BNB. 1 ETH = 10^18 wei. Usado em amount
fields de transações para precisão.

### Whitelist

Lista de endereços/tokens autorizados. Apenas itens na lista
são aceitos. No projeto, `TokenAuthority` (H2.3) mantém
whitelist de tokens.

---

## Relacionado

- `context/terminology.md` — termos internos do projeto (não duplicar aqui).
- `context/project-summary.md` — visão geral usando estes termos.
- `contracts/rpc.md` — termos de RPC/blockchain.
- `standards/security.md` — termos de segurança.
- `MANIFEST.md` — princípios do Project OS e tabela de IDs canônicos.

