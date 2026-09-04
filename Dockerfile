# ==========================================
# ÉTAPE 1 : BUILD (Compilation)
# ==========================================
# On utilise la version 20 pour s'aligner parfaitement avec le runner
FROM node:20-slim AS builder

WORKDIR /app

# Installation d'OpenSSL et des certificats requis par Prisma
RUN apt-get update -y && apt-get install -y openssl ca-certificates

# 1. Copie des fichiers de configuration et du schéma Prisma
COPY package*.json ./
COPY tsconfig.json ./
COPY prisma ./prisma/

# Ajustement pour forcer npm et Node à ignorer l'IPv6 défaillant pendant le build
ENV NODE_OPTIONS="--dns-result-order=ipv4first"

# 2. Installation des dépendances (npm install pour éviter le blocage si package-lock manque)
RUN npm install

# 3. Génération du client Prisma
RUN npx prisma generate

# 4. Copie du reste du code source et compilation
COPY . .
RUN npm run build

# ==========================================
# ÉTAPE 2 : RUNNER (Production)
# ==========================================
FROM node:20-slim AS runner

WORKDIR /app

# Installation d'OpenSSL également requis pour l'exécution en prod
RUN apt-get update -y && apt-get install -y openssl ca-certificates

# Passage en mode production
ENV NODE_ENV=production

# 1. Copie des fichiers requis pour l'exécution
COPY package*.json ./
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.* ./

# 2. Copie de toutes les dépendances installées en build
COPY --from=builder /app/node_modules ./node_modules

# 4. Alignement avec le port configuré sur Render (10000)
EXPOSE 10000

# 5. Démarrage (Exécute les migrations puis lance node)
CMD ["npm", "run", "start:prod"]