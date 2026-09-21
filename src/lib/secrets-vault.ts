export type SecretsMigrationHint = {
  connections: Array<{ connectionId: string; username: string }>;
  sshProfileIds: string[];
  aiBaseUrl?: string;
};

export type SecretsVaultStatus = {
  aiApiKeyConfigured: boolean;
  migratedLegacyEntries: number;
};

type MigrationSource = {
  connections: Array<{ id: string; username: string }>;
  sshProfiles: Array<{ id: string }>;
  aiBaseUrl?: string;
};

export function buildSecretsMigrationHint(source: MigrationSource): SecretsMigrationHint {
  return {
    connections: source.connections.map((connection) => ({
      connectionId: connection.id,
      username: connection.username,
    })),
    sshProfileIds: source.sshProfiles.map((profile) => profile.id),
    ...(source.aiBaseUrl ? { aiBaseUrl: source.aiBaseUrl } : {}),
  };
}
