// Ce fichier est utilisé pour les outils CLI de Prisma (migrate, db push, etc.)
// La configuration du client applicatif se fait dans src/lib/prisma.ts

// DATABASE_URL est accessible via le fichier .env et charges automatiquement par Prisma CLI
export const config = {
  database: process.env.DATABASE_URL || 'postgresql://localhost/walkietalkie',
};
