import os
from github import Github, Auth

def main():
    token = os.getenv("GITHUB_TOKEN")

    if not token:
        print("ERRO: Variável de ambiente GITHUB_TOKEN não encontrada!")
        print("Execute: $env:GITHUB_TOKEN = 'seu_token'")
        return

    try:
        # Usa a nova forma de autenticação (remove o DeprecationWarning)
        auth = Auth.Token(token)
        g = Github(auth=auth)
        
        repo_name = "ENDARTStudios/Auto-Trader"
        print(f"Tentando acessar: {repo_name}...")
        repo = g.get_repo(repo_name)
        print(f"✅ Conectado ao repositório: {repo.full_name}")
        print(f"📌 Branch padrão: {repo.default_branch}")

        # Vamos listar o conteúdo da raiz para ver onde está o arquivo
        print("\n📂 Listando arquivos na raiz da branch 'main':")
        try:
            contents = repo.get_contents("", ref="main")
            for item in contents:
                if item.type == "file":
                    print(f"  📄 {item.path}")
                else:
                    print(f"  📁 {item.path}/")
        except Exception as e:
            print(f"Erro ao listar raiz: {e}")
            # Tenta listar na branch master se main falhar
            print("\n📂 Tentando listar na branch 'master':")
            try:
                contents = repo.get_contents("", ref="master")
                for item in contents:
                     if item.type == "file":
                        print(f"  📄 {item.path}")
                     else:
                        print(f"  📁 {item.path}/")
            except Exception as e2:
                print(f"Erro também em master: {e2}")
                return

        # Tenta encontrar o main.py especificamente
        target_path = "src/main.py"
        print(f"\n🔍 Procurando por '{target_path}'...")
        
        try:
            file_content = repo.get_contents(target_path, ref="main")
            print(f"✅ Arquivo encontrado em: {target_path}")
            
            # --- LÓGICA DE ATUALIZAÇÃO ---
            decoded_content = file_content.decoded_content.decode()
            novo_conteudo = "# Atualização automática segura\n" + decoded_content
            
            repo.update_file(
                path=target_path,
                message="feat: atualização via script seguro",
                content=novo_conteudo,
                sha=file_content.sha,
                branch="main"
            )
            print(f"✅ Sucesso! Arquivo {target_path} atualizado.")
            
        except Exception as e:
            print(f"❌ Erro 404: O arquivo '{target_path}' não foi encontrado na branch 'main'.")
            print("Verifique a lista acima se o caminho está correto (ex: talvez esteja apenas 'main.py' na raiz).")
            print(f"Detalhe do erro: {e}")

    except Exception as e:
        print(f"❌ Erro crítico: {e}")

if __name__ == "__main__":
    main()