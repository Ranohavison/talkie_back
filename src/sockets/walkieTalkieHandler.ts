import { Server, Socket } from 'socket.io';
import redisClient from '../config/redis';
import { prisma } from '../server';

// Clés de préfixe pour bien organiser notre store Redis
const SESSION_PREFIX = 'session:user:';
const CHANNEL_LOCK_PREFIX = 'channel:lock:';

export function registerWalkieTalkieHandlers(io: Server, socket: Socket) {
  const userId = socket.handshake.auth.userId as string;

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
        socketId: socket.id,
        activeChannelId: channelId,
        isTalking: 'false', // Les booléens sont stockés en String dans les hashs redis (sans parser JSON)
        lastSeenAt: Date.now().toString()
      });

      console.log(`📡 User ${userId} a rejoint le canal ${channelId}`);
      
      // Notifier le salon de cette nouvelle présence
      socket.to(channelId).emit('user_joined', { userId });
    } catch (error) {
      console.error('Erreur join_channel:', error);
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

      // Broadcaster l'info à tout le salon (y compris l'émetteur pour ui-feedback)
      io.to(channelId).emit('user_started_talking', { userId });
      
      console.log(`🎤 User ${userId} a pris la parole sur ${channelId}`);
    } catch (error) {
      console.error('Erreur start_talking:', error);
    }
  });

  // ==========================================
  // 3. FLUX AUDIO (Streaming binaire)
  // ==========================================
  // Note de conception : Les chunks audio sont transférés tels quels.
  // Interroger Redis à chaque chunk (plusieurs fois par sec) surchargerait inutilement le serveur.
  // La permission a déjà été validée dans start_talking, et les clients UI bloquent les envois des autres.
  socket.on('audio_stream', (data: { channelId: string; chunk: Buffer | ArrayBuffer }) => {
    // Rediffusion instantanée à tous les membres de la room (sauf l'émetteur)
    // Le transport en binaire natif via Socket.io est très performant.
    socket.to(data.channelId).emit('audio_receive', {
      userId,
      chunk: data.chunk
    });
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
