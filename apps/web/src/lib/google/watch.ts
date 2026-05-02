import { randomUUID } from "node:crypto";
import { getDriveClient } from "./client";

/**
 * Registra um "watch" do Drive em um arquivo. O Drive vai POSTar notificações
 * para `webhookUrl` toda vez que o arquivo mudar. O `channelId` é opaco e
 * usado pra encerrar o watch depois.
 *
 * Pré-requisitos:
 *  - O domínio do `webhookUrl` precisa estar verificado em
 *    https://console.cloud.google.com/apis/credentials/domainverification
 *  - URL precisa ser HTTPS válida e pública (Vercel funciona).
 *
 * Custo: cada watch dura no máximo 1 semana; precisa renovar via cron.
 */
export interface WatchOptions {
  fileId: string;
  webhookUrl: string;
  /** Token compartilhado — voltará no header X-Goog-Channel-Token de cada POST. */
  token: string;
  /** TTL em segundos (default 604800 = 7 dias, máximo do Drive). */
  ttlSeconds?: number;
}

export interface WatchResult {
  channelId: string;
  resourceId: string;
  expiration: number; // ms epoch
}

export async function watchFile(opts: WatchOptions): Promise<WatchResult> {
  const drive = getDriveClient();
  const channelId = randomUUID();
  const ttl = opts.ttlSeconds ?? 7 * 24 * 60 * 60;

  const res = await drive.files.watch({
    fileId: opts.fileId,
    requestBody: {
      id: channelId,
      type: "web_hook",
      address: opts.webhookUrl,
      token: opts.token,
      expiration: String(Date.now() + ttl * 1000),
    },
    supportsAllDrives: true,
  });

  return {
    channelId,
    resourceId: res.data.resourceId!,
    expiration: Number(res.data.expiration!),
  };
}

export async function unwatchChannel(channelId: string, resourceId: string): Promise<void> {
  const drive = getDriveClient();
  await drive.channels.stop({
    requestBody: { id: channelId, resourceId },
  });
}
