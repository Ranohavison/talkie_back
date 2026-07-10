import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';
import { registerWalkieTalkieHandlers } from './sockets/walkieTalkieHandler';

// 1. Initialisation de l'application et des serveurs
const app = express();
const httpServer = createServer(app);
export const prisma = new PrismaClient(); // Exporté pour être réutilisé dans les contrôleurs REST

// 2. Configuration Socket.io avec CORS
const io = new Server(httpServer, {
  cors: {
    origin: '*', // TODO: En production, restreindre aux domaines autorisés (ex: ['https://mon-app.com'])
    methods: ['GET', 'POST']
  }
});

// 3. Middlewares Express
app.use(cors());
app.use(express.json());

// Exemple de route REST (Santé de l'API)
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'API Walkie-Talkie opérationnelle' });
});

// 4. Middleware d'authentification Socket.io
// Ce middleware s'exécute lors du handshake initial
io.use((socket, next) => {
  const userId = socket.handshake.auth.userId;
  if (!userId) {
    return next(new Error('Authentification requise: userId manquant dans auth payload'));
  }
  // On pourrait également vérifier un token JWT ici
  next();
});

// 5. Gestionnaire de connexions Socket.io
io.on('connection', (socket) => {
  console.log(`⚡ Nouvelle connexion WebSocket: ${socket.id} (User: ${socket.handshake.auth.userId})`);

  // Délégation de la logique PTT au gestionnaire dédié
  registerWalkieTalkieHandlers(io, socket);
});

// 6. Démarrage du serveur
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`🚀 Serveur démarré sur http://localhost:${PORT}`);
  console.log(`📡 Socket.io prêt à accepter le streaming audio`);
});

// 7. Arrêt propre (Graceful Shutdown)
process.on('SIGINT', async () => {
  console.log('Arrêt du serveur...');
  await prisma.$disconnect();
  io.close();
  httpServer.close(() => process.exit(0));
});
