import { Server, Socket } from 'socket.io';
import redisClient from '../config/redis';
import { prisma } from '../server';

// Clés de préfixe pour bien organiser notre store Redis
const SESSION_PREFIX = 'session:user:';
const CHANNEL_LOCK_PREFIX = 'channel:lock:';

export function registerWalkieTalkieHandlers(io: Server, socket: Socket) {
  const userId = socket.handshake.auth.userId as string;

  // Récupérer le pseudo envoyé à la connexion
  const initialUsername = socket.handshake.auth.username || `Operator_${Math.floor(1000 + Math.random() * 9000)}`;
  socket.data.username = initialUsername;

  // ==========================================
  // 1. REJOINDRE UNE FRÉQUENCE / UN CANAL
  // ==========================================
  socket.on('join_channel', async (channelId: string) => {
    try {
      // Joindre la "room" Socket.io (permet le broadcast de groupe)
      socket.join(channelId);

      // Stocker l'état dans Redis (Hash pour accès rapide)
      const sessionKey = `${SESSION_PREFIX}${userId}`;
      await redisClient.hset(sessionKey, {
        userId,
        username: socket.data.username,
        socketId: socket.id,
        activeChannelId: channelId,
        isTalking: 'false',
        lastSeenAt: Date.now().toString()
      });

      console.log(`📡 User ${userId} (${socket.data.username}) a rejoint le canal ${channelId}`);
      
      // Récupérer la liste des utilisateurs déjà présents dans ce canal
      const sockets = await io.in(channelId).fetchSockets();
      const existingUserIds = sockets
        .map((s) => s.handshake.auth.userId)
        .filter((id) => id && id !== userId);

      // Envoyer la liste de présence uniquement à l'utilisateur qui vient de rejoindre
      socket.emit('channel_users', { users: existingUserIds });

      // Notifier le salon de cette nouvelle présence avec le pseudo
      socket.to(channelId).emit('user_joined', { userId });
    } catch (error) {
      console.error('Erreur join_channel:', error);
    }
  });

  // Mettre à jour le pseudo à la volée
  socket.on('update_username', async (newUsername: string) => {
    try {
      const trimmed = newUsername.trim();
      if (trimmed) {
        socket.data.username = trimmed;
        const sessionKey = `${SESSION_PREFIX}${userId}`;
        await redisClient.hset(sessionKey, 'username', trimmed);
        console.log(`👤 User ${userId} a mis à jour son pseudo : ${trimmed}`);
      }
    } catch (error) {
      console.error('Erreur update_username:', error);
    }
  });

  // ==========================================
  // 2. DEMANDER LA PAROLE (Bouton PTT pressé)
  // ==========================================
  socket.on('start_talking', async (channelId: string) => {
    try {
      const lockKey = `${CHANNEL_LOCK_PREFIX}${channelId}`;
      const sessionKey = `${SESSION_PREFIX}${userId}`;

      // Tenter de poser un verrou exclusif sur le canal (commande SETNX : Set if Not eXists)
      // "EX 10" ajoute une expiration auto de 10s pour éviter qu'un canal ne soit bloqué à vie en cas de crash
      const lockAcquired = await redisClient.set(lockKey, userId, 'EX', 10, 'NX');

      if (!lockAcquired) {
        // Le canal est déjà verrouillé par quelqu'un d'autre
        socket.emit('channel_busy', { message: 'Fréquence occupée.' });
        return;
      }

      // Mise à jour de l'état local du user
      await redisClient.hset(sessionKey, 'isTalking', 'true');

      // Broadcaster l'info à tout le salon (y compris l'émetteur pour ui-feedback) avec le pseudo
      io.to(channelId).emit('user_started_talking', { 
        userId, 
        username: socket.data.username || userId 
      });
      
      console.log(`🎤 User ${userId} (${socket.data.username}) a pris la parole sur ${channelId}`);
    } catch (error) {
      console.error('Erreur start_talking:', error);
    }
  });

  // ==========================================
  // 3. FLUX AUDIO (Streaming binaire)
  // ==========================================
  // Note de conception : Les chunks audio doivent être rediffusés instantanément et
  // de manière purement synchrone pour préserver un ordre strict et éviter tout
  // décalage ou effet de saccade métallique causé par les appels asynchrones à Redis.
  socket.on('audio_stream', (data: { channelId: string; chunk: Buffer | ArrayBuffer }) => {
    // Rediffusion instantanée et synchrone (sauf émetteur) pour garantir l'ordre et le temps réel
    socket.to(data.channelId).emit('audio_receive', {
      userId,
      chunk: data.chunk
    });

    // Renouvellement asynchrone en arrière-plan sans bloquer le flux d'émission principal
    const now = Date.now();
    const lastRenewal = socket.data.lastLockRenewal || 0;
    if (now - lastRenewal > 4000) {
      socket.data.lastLockRenewal = now;
      const lockKey = `${CHANNEL_LOCK_PREFIX}${data.channelId}`;
      redisClient.get(lockKey)
        .then((currentSpeaker) => {
          if (currentSpeaker === userId) {
            return redisClient.expire(lockKey, 10);
          }
        })
        .catch((error) => {
          console.error('Erreur renouvellement verrou audio_stream:', error);
        });
    }
  });

  // ==========================================
  // 4. RELÂCHER LA PAROLE (Bouton PTT relâché)
  // ==========================================
  socket.on('stop_talking', async (channelId: string) => {
    try {
      const lockKey = `${CHANNEL_LOCK_PREFIX}${channelId}`;
      const sessionKey = `${SESSION_PREFIX}${userId}`;

      // Vérifier si c'est bien l'utilisateur actuel qui détenait le verrou
      const currentSpeaker = await redisClient.get(lockKey);
      
      if (currentSpeaker === userId) {
        // Libérer le verrou
        await redisClient.del(lockKey);
        await redisClient.hset(sessionKey, 'isTalking', 'false');

        // Prévenir la room que le canal est libre
        io.to(channelId).emit('user_stopped_talking', { userId });
        
        console.log(`🔇 User ${userId} a libéré la fréquence ${channelId}`);
      }
    } catch (error) {
      console.error('Erreur stop_talking:', error);
    }
  });

  // ==========================================
  // 5. DÉCONNEXION BRUTALE / PERTE DE RÉSEAU
  // ==========================================
  socket.on('disconnect', async () => {
    try {
      const sessionKey = `${SESSION_PREFIX}${userId}`;
      const session = await redisClient.hgetall(sessionKey);
      
      if (session && session.activeChannelId) {
        const channelId = session.activeChannelId;
        const lockKey = `${CHANNEL_LOCK_PREFIX}${channelId}`;
        
        // Sécurité : S'il parlait au moment de la déconnexion, on libère le canal pour les autres
        const currentSpeaker = await redisClient.get(lockKey);
        if (currentSpeaker === userId) {
          await redisClient.del(lockKey);
          io.to(channelId).emit('user_stopped_talking', { userId });
          console.log(`⚠️ User ${userId} déconnecté pendant la transmission. Verrou libéré.`);
        }
        
        io.to(channelId).emit('user_left', { userId });
      }

      // Nettoyer sa session en cache
      await redisClient.del(sessionKey);
      console.log(`❌ User ${userId} s'est déconnecté`);
    } catch (error) {
      console.error('Erreur disconnect:', error);
    }
  });
}
