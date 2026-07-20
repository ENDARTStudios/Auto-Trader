# MANUAL DO OPERADOR - Auto Trader

## Ambiente de Desenvolvimento

O ambiente de desenvolvimento **deve ser Linux**. O signer process (`src/signer/main.ts`) usa Unix domain sockets (`/tmp/signer-*.sock`) via `net.createServer({ path: ... })`, que **não são suportados no Windows** — resultando em `ERR_SOCKET_UNSUPPORTED (-1399001328): socket type not supported`.

### Opções de Ambiente Linux

| Opção | Descrição | Quando Usar |
|-------|-----------|-------------|
| **WSL2 + Docker Desktop** | Windows Subsystem for Linux com Docker Desktop | Desenvolvedor Windows com Docker instalado |
| **Docker Nativo** | Container Linux rodando o projeto | CI/CD, servidores, ou máquina Linux |
| **VM Linux** | Máquina virtual com Linux | Caso WSL2/Docker não sejam viáveis |

### Configuração: WSL2 + Docker Desktop

1. Instale WSL2:
   ```powershell
   wsl --install
   ```
2. Reinicie o computador
3. Instale Docker Desktop para Windows (https://www.docker.com/products/docker-desktop)
4. Execute dentro do WSL ou via Docker Desktop:
   ```bash
   docker build -t auto-trader .
   docker run --rm auto-trader npm run test:ci
   ```

### Configuração: Docker Nativo (Container Linux)

```bash
docker build -t auto-trader .
docker run --rm auto-trader npm run test:ci
```

### Testes Compatíveis com Windows

Os seguintes testes **funcionam no Windows** e cobrem H0, H1, H2:

- `npm run test:vault`
- `npm run test:h0-kdf`
- `npm run test:h1-rpc`
- `npm run test:h2-contract`

Os testes do signer process (`test:signer`, `test:signer-process`, `test:signer-vault-integration`, `test:signer-dispatcher-structural`) **requerem Unix sockets e NÃO funcionam no Windows**.

---

## Limitações do Ambiente Windows

### Docker Indisponível
O ambiente Windows atual **não possui Docker instalado**. Os testes `test:ci` (994 testes) não podem ser executados diretamente no Windows devido a:

1. **Unix Sockets** - O signer process usa Unix sockets (`/tmp/signer-*.sock`) que não são suportados no Windows
2. **Node.js ERR_SOCKET_UNSUPPORTED** - `net.createConnection()` falha com `ERR_SOCKET_UNSUPPORTED (-1399001328): socket type not supported`

### Como Executar os Testes

#### Opção 1: WSL2 + Docker Desktop (Recomendado)
1. Instale o WSL2:
   ```powershell
   wsl --install
   ```
2. Reinicie o computador
3. Instale Docker Desktop para Windows (https://www.docker.com/products/docker-desktop)
4. Execute dentro do WSL ou via Docker Desktop:
   ```bash
   docker build -t auto-trader .
   docker run --rm auto-trader npm run test:ci
   ```

#### Opção 2: Container Linux Nativo
Se disponível, use um container ou máquina Linux:
```bash
docker build -t auto-trader .
docker run --rm auto-trader npm run test:ci
```

#### Opção 3: Testes Específicos (Sem Signer)
Os seguintes testes funcionam no Windows e cobrem H0, H1, H2:
- `npm run test:vault`
- `npm run test:h0-kdf`
- `npm run test:h1-rpc`
- `npm run test:h2-contract`

Os testes do signer process (`test:signer`, `test:signer-process`, `test:signer-vault-integration`) **requerem Linux/Unix sockets**.