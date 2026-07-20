# MANUAL DO OPERADOR - Auto Trader

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