import Redis from 'ioredis';

// Initialisation du client Redis
// En production, l'URL doit provenir des variables d'environnement (process.env.REDIS_URL)
const redisClient = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379');

redisClient.on('connect', () => {
  console.log('🟢 Connecté au cache Redis avec succès');
});

redisClient.on('error', (err) => {
  console.error('🔴 Erreur de connexion Redis:', err);
});

export default redisClient;
