# ==========================================
# ÉTAPE 1 : BUILD (Compilation)
# ==========================================
FROM node:20-alpine AS builder

WORKDIR /app

# 1. Copie des fichiers de configuration et du schéma Prisma
COPY package*.json ./
COPY tsconfig.json ./
COPY prisma ./prisma/

# 2. Installation de TOUTES les dépendances (nécessaires pour build)
RUN npm ci

# 3. Génération du client Prisma (Binaires pour l'environnement de build)
RUN npx prisma generate

# 4. Copie du reste du code source et compilation
COPY . .
RUN npm run build

# ==========================================
# ÉTAPE 2 : RUNNER (Production)
# ==========================================
FROM node:20-alpine AS runner

WORKDIR /app

# Passage en mode production
ENV NODE_ENV=production

# 1. Copie des fichiers requis pour l'exécution
COPY package*.json ./
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma

# 2. Copie du client Prisma DÉJÀ généré (évite de réinstaller Prisma en prod)
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client

# 3. Installation des dépendances de production uniquement
RUN npm ci --omit=dev

# 4. Alignement avec le port configuré sur Render (10000)
EXPOSE 10000

# 5. Démarrage (Exécute les migrations puis lance node)
CMD ["npm", "run", "start:prod"]