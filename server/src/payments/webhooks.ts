import { createHash } from 'node:crypto';
import { adapterForProvider } from './adapters.js';
import { resolvePaymentSecret } from './secrets.js';
import { applyProviderUpdate, existingProviderEvent, markProviderEventFailed, markProviderEventProcessed, providerConfigForTransaction, providerEventToRecord, providerTransaction } from './service.js';
import { addProviderEvent, decrementAdapterPending, listPaymentAdapters, listProviderEvents, recordAdapterTransaction } from './store.js';
import type { PaymentTransaction, ProviderEvent } from './types.js';

function hashBody(rawBody: string): string {
  return createHash('sha256').update(rawBody).digest('hex');
}

export interface WebhookResult {
  accepted: boolean;
  duplicate: boolean;
  eventId: string;
  transaction: PaymentTransaction | null;
  message: string;
}

export async function processProviderWebhook(provider: string, rawBody: string, signature: string | undefined): Promise<WebhookResult> {
  const adapterConfig = listPaymentAdapters().find((adapter) => adapter.provider === provider);
  if (!adapterConfig) throw new Error('Provider is not registered');
  const adapter = adapterForProvider(provider);
  const parsed = adapter.parseWebhook(rawBody);
  const duplicate = existingProviderEvent(provider, parsed.providerEventId);
  if (duplicate) {
    if (!adapter.verifyWebhook(rawBody, signature, { config: adapterConfig, secret: resolvePaymentSecret(adapterConfig) })) throw new Error('Invalid provider webhook signature');
    const duplicateRecord: ProviderEvent = { ...duplicate, id: `PEVT-${hashBody(rawBody).slice(0, 18)}`, status: 'DUPLICATE_IGNORED', receivedAt: Date.now(), processedAt: Date.now() };
    addProviderEvent(duplicateRecord);
    return { accepted: true, duplicate: true, eventId: duplicate.providerEventId, transaction: null, message: 'Duplicate provider event ignored' };
  }
  const transaction = providerTransaction(parsed.providerReference);
  if (transaction.provider !== provider || transaction.currency !== parsed.currency) throw new Error('Provider event does not match transaction provider or currency');
  const assignedConfig = providerConfigForTransaction(transaction);
  if (assignedConfig.provider !== provider) throw new Error('Provider event does not match assigned adapter');
  if (!adapter.verifyWebhook(rawBody, signature, { config: assignedConfig, secret: resolvePaymentSecret(assignedConfig) })) throw new Error('Invalid provider webhook signature');
  const event = providerEventToRecord(provider, parsed, rawBody, transaction.id);
  addProviderEvent(event);
  try {
    const wasPending = transaction.status === 'PENDING' || transaction.status === 'PROCESSING';
    const wasTerminal = ['COMPLETED', 'FAILED', 'EXPIRED', 'CANCELLED', 'REVERSED'].includes(transaction.status);
    const updated = applyProviderUpdate(transaction, parsed);
    markProviderEventProcessed(event, updated.id);
    const becameTerminal = !wasTerminal && ['COMPLETED', 'FAILED', 'EXPIRED', 'CANCELLED', 'REVERSED'].includes(updated.status);
    if (wasPending && becameTerminal) {
      decrementAdapterPending(updated.adapterId);
      if (updated.status === 'COMPLETED') recordAdapterTransaction(updated.adapterId, 'success');
      else if (updated.status !== 'REVERSED') recordAdapterTransaction(updated.adapterId, 'failure');
    }
    return { accepted: true, duplicate: false, eventId: parsed.providerEventId, transaction: updated, message: 'Provider event processed' };
  } catch (error) {
    markProviderEventFailed(event, error instanceof Error ? error.message : 'Provider event processing failed');
    throw error;
  }
}

export function listWebhookEvents(): ProviderEvent[] {
  return listProviderEvents().slice().reverse();
}
