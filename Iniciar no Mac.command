#!/bin/zsh
# Dois cliques para subir o sistema no Mac. Para encerrar: Ctrl+C nesta janela.
cd "$(dirname "$0")" || exit 1

# Fora de um terminal normal, o Node instalado pelo nvm ou Homebrew não está no PATH.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js não encontrado. Instale pelo site nodejs.org e tente de novo."
  read -k 1 "?Aperte qualquer tecla para fechar."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Dependências não instaladas. Rode 'npm install' nesta pasta e tente de novo."
  read -k 1 "?Aperte qualquer tecla para fechar."
  exit 1
fi

node scripts/supervisor.js
