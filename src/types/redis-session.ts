/**
 * Interface représentant l'état d'une session utilisateur active dans Redis.
 * Utile pour gérer le statut en temps réel (Push-to-Talk) et la présence.
 * 
 * Modèle de clé Redis recommandé: `session:user:${userId}` (ou `session:socket:${socketId}`)
 * Modèle de stockage recommandé: Hash (HSET) pour permettre la mise à jour partielle
 * (ex: mise à jour uniquement de isTalking sans toucher au reste).
 */
export interface ActiveSession {
  /** L'identifiant unique de l'utilisateur (UUID) issu de PostgreSQL */
  userId: string;
  
  /** L'identifiant de la socket active (Socket.io / ws) */
  socketId: string;
  
  /** L'UUID du salon (Channel) actuellement écouté/actif, ou null si l'utilisateur navigue ailleurs */
  activeChannelId: string | null;
  
  /** Booléen indiquant si l'utilisateur est actuellement en train de parler (Push-to-Talk pressé) */
  isTalking: boolean;
  
  /** 
   * Timestamp de la dernière activité pour nettoyer les sessions orphelines 
   * (au cas où la déconnexion WebSocket n'est pas détectée correctement suite à une coupure réseau)
   */
  lastSeenAt: number; 
}
