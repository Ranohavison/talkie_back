import { UserStatus, ChannelRole } from '@prisma/client';
import { prisma } from '../src/lib/prisma';

async function main() {
  console.log('🌱 Début de l\'initialisation de la base de données...');

  // --- 1. Création des utilisateurs ---
  const user1 = await prisma.user.upsert({
    where: { email: 'alpha@walkie.local' },
    update: {},
    create: {
      username: 'AlphaOne',
      email: 'alpha@walkie.local',
      // Dans une application réelle, utiliser bcrypt (ex: bcrypt.hashSync('password', 10))
      passwordHash: '$2b$10$randomhash1234567890dummy',
      status: UserStatus.ONLINE,
    },
  });

  const user2 = await prisma.user.upsert({
    where: { email: 'bravo@walkie.local' },
    update: {},
    create: {
      username: 'BravoTwo',
      email: 'bravo@walkie.local',
      passwordHash: '$2b$10$randomhash0987654321dummy',
      status: UserStatus.OFFLINE,
    },
  });

  console.log(`✅ Utilisateurs créés : ${user1.username}, ${user2.username}`);

  // --- 2. Création d'un canal avec ses membres ---
  const testChannel = await prisma.channel.upsert({
    where: { code: '#4042' },
    update: {},
    create: {
      name: 'Fréquence de Secours',
      code: '#4042',
      isPrivate: false,
      createdById: user1.id, // AlphaOne est le créateur du canal
      members: {
        create: [
          {
            userId: user1.id,
            role: ChannelRole.ADMIN,
          },
          {
            userId: user2.id,
            role: ChannelRole.MEMBER,
          },
        ],
      },
    },
  });

  console.log(`✅ Canal créé : ${testChannel.name} (${testChannel.code}) avec 2 membres.`);

  // --- 3. Ajout d'un historique de transmission (Optionnel) ---
  const transmission = await prisma.transmissionLog.create({
    data: {
      channelId: testChannel.id,
      senderId: user1.id,
      durationSeconds: 5,
    }
  });

  console.log(`✅ Log de transmission créé (Durée: ${transmission.durationSeconds}s)`);
  console.log('🏁 Initialisation (Seed) terminée avec succès !');
}

main()
  .catch((e) => {
    console.error('❌ Erreur lors du seed :', e);
    process.exit(1);
  })
  .finally(async () => {
    // Déconnexion propre du client Prisma
    await prisma.$disconnect();
  });
