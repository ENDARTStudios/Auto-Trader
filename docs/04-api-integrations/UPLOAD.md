# Upload de arquivos — contrato e segurança (/api/upload)

> Implementado na rodada 10. Antes era um stub `501` ("Fase 6.1 adiada").
> Status: **real em storage local**; sem antivírus e sem object storage ainda.

## 1. Autenticação e autorização

- Exige sessão válida + permissão **`wallets:write`** (`requirePermission`), igual
  ao stub anterior.
- `UPLOAD_ENABLED=0` desliga o recurso: `POST` e `GET` respondem **503**
  `{"error":"upload_disabled"}` / `{"enabled":false}`.

## 2. Contrato

### `GET /api/upload`

Status real do storage (nunca expõe caminho absoluto do host):

```json
{
  "status": "ok",
  "enabled": true,
  "dir": ".local/uploads",
  "acceptedMimes": ["image/png", "image/jpeg", "application/pdf"],
  "maxBytes": { "image/png": 5242880, "image/jpeg": 5242880, "application/pdf": 10485760, "default": 1048576 },
  "storage": "local-filesystem",
  "notes": "Arquivo não é servido publicamente; sem ClamAV/S3 nesta versão …"
}
```

### `POST /api/upload` — `multipart/form-data`, campo `file`

Sucesso: **201**

```json
{ "ok": true, "id": "<uuid>", "filename": "<uuid>.png", "mime": "image/png", "size": 12345, "sha256": "<64 hex>" }
```

| Erro | HTTP | Quando |
|---|---|---|
| `file_required` | 400 | multipart sem o campo `file` |
| `invalid_multipart` | 400 | corpo não é multipart |
| `empty_file` | 400 | arquivo de 0 byte |
| `magic_bytes_mismatch` | 400 | conteúdo não corresponde ao mime declarado |
| `file_too_large` | 413 | acima de `maxBytes[mime]` |
| `mime_not_allowed` | 415 | fora da allowlist (inclui `acceptedMimes` na resposta) |
| `storage_write_failed` | 500 | falha de I/O no disco (mkdtemp/mkdir/permissão) |
| `upload_disabled` | 503 | `UPLOAD_ENABLED=0` |

## 3. Validações (na ordem em que rodam)

1. **mime allowlist**: somente `image/png`, `image/jpeg`, `application/pdf`.
2. **tamanho por mime**: PNG/JPEG 5 MiB, PDF 10 MiB (`file.size` é checado antes de
   ler o conteúdo; o buffer é revalidado depois).
3. **magic bytes** (não confia no `Content-Type`):
   - PNG `89 50 4E 47`
   - JPEG `FF D8 FF`
   - PDF `25 50 44 46`
4. **nome de arquivo**: derivado de UUID v4 + extensão do mime (`.png`/`.jpg`/`.pdf`).
   O nome enviado pelo cliente é **ignorado** (sem path traversal, sem sobrescrever
   arquivo existente: gravação com flag `wx`).
5. **confiança**: `sha256` do conteúdo devolvido para o caller registrar/integrar.

## 4. Storage

- Diretório: `UPLOAD_DIR` (env) → senão `/data/uploads` se `/data` existir e for
  gravável (volume de produção) → senão `.local/uploads` (dev).
- Cria o diretório com `mkdir -p`; arquivo com modo `0600`.
- **Não há rota pública de download**: os arquivos ficam privados no volume; hoje
  não existe endpoint de leitura (quem precisar deve ser um próximo contrato, com
  autorização por dono/tenant).

## 5. Limitações conhecidas (honestas)

- **Sem antivírus** (ClamAV não integrado) — magic bytes não detectam payload malicioso
  embutido em arquivo válido. Não confie nesses uploads para conteúdo público.
- **Sem object storage** (S3/MinIO/R2) e sem CDN: arquivo mora no filesystem do
  container; em plataforma efêmera ele se perde no redeploy. Volume `/data` é o
  caminho suportado no Railway.
- **Sem quota por usuário/tenant** e sem GC de arquivos órfãos.
- Sem `Content-Disposition`/download e sem metadados no banco (decisão: "sem DB novo"
  nesta rodada) — o `id`/nome é a referência.
- Limite de memória: o arquivo é bufferizado inteiro (até 10 MiB) — aceitável no
  tamanho atual; para arquivos maiores, migrar para streaming.

## 6. Testes

`tests/upload-route.test.ts` (sem rede, diretório temporário): sucesso PNG/PDF,
nome do cliente ignorado (traversal), mime inválido, magic inválido, oversize,
multipart sem `file`, `UPLOAD_ENABLED=0`, e `GET` status/dir mascarado.

## 7. Referências

- Implementação: [src/app/api/upload/route.ts](../../src/app/api/upload/route.ts)
- E-mail transacional (usado no reset de senha): `src/lib/notifications/email.ts`
- Hardening de upload: `docs/05-security-compliance/SECURITY.md` (etapa 6.1)
