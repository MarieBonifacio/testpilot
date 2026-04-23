#!/bin/bash

# TestPilot Development Server Launcher
# Usage: ./dev.sh

set -e

# Couleurs
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

BACKEND_PID=""
FRONTEND_PID=""

# Trap SIGINT
trap cleanup SIGINT

cleanup() {
    echo -e "\n${YELLOW}Arrêt des serveurs...${NC}"
    
    if [ ! -z "$BACKEND_PID" ]; then
        kill $BACKEND_PID 2>/dev/null || true
    fi
    
    if [ ! -z "$FRONTEND_PID" ]; then
        kill $FRONTEND_PID 2>/dev/null || true
    fi
    
    exit 0
}

print_header() {
    echo -e "${GREEN}"
    echo "╔════════════════════════════════════════════════════════╗"
    echo "║                  TestPilot v2.0                        ║"
    echo "║           Démarrage Backend + Frontend                 ║"
    echo "╚════════════════════════════════════════════════════════╝"
    echo -e "${NC}\n"
}

check_requirement() {
    if ! command -v $1 &> /dev/null; then
        echo -e "${RED}❌ $2 non trouvé${NC}"
        exit 1
    fi
    echo -e "${GREEN}✓ $2 trouvé${NC}"
}

print_header

# Vérifier les prérequis
echo "[0/4] Vérification des prérequis..."
check_requirement "node" "Node.js"
check_requirement "npm" "npm"
echo ""

# Initialiser DB
echo "[1/4] Initialisation de la base de données..."
node init_db.js
echo -e "${GREEN}✓ Base de données prête${NC}\n"

# Démarrer Backend
echo "[2/4] Démarrage du serveur Backend (port 3000)..."
node proxy.js &
BACKEND_PID=$!
echo -e "${GREEN}✓ Backend lancé (PID: $BACKEND_PID)${NC}\n"
sleep 2

# Démarrer Frontend
echo "[3/4] Démarrage du serveur Frontend (port 5173)..."
cd src-react
npm run dev &
FRONTEND_PID=$!
cd ..
echo -e "${GREEN}✓ Frontend lancé (PID: $FRONTEND_PID)${NC}\n"

# Afficher le statut
echo -e "[4/4] Serveurs actifs\n"
echo -e "${CYAN}╔════════════════════════════════════════════════════════╗"
echo "║                ✈  Services Actifs                      ║"
echo "├════════════════════════════════════════════════════════┤"
echo "║  Backend  → http://localhost:3000                      ║"
echo "║  Frontend → http://localhost:5173                      ║"
echo "║  API      → http://localhost:3000/api                 ║"
echo "║  DB       → testpilot.db                              ║"
echo "╚════════════════════════════════════════════════════════╝${NC}\n"

echo -e "${YELLOW}Appuyez sur Ctrl+C pour arrêter les serveurs${NC}\n"

# Attendre que les processus se terminent
wait
