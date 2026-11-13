import type { ServerResponse } from 'node:http';

import type { LiveUpdate } from './contracts.js';

export class LiveUpdateBroker {
  private readonly subscribers = new Set<ServerResponse>();

  public subscribe(response: ServerResponse): () => void {
    response.writeHead(200, {
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Content-Type': 'text/event-stream; charset=utf-8',
      'X-Accel-Buffering': 'no',
    });
    response.write('retry: 3000\n\n');
    this.subscribers.add(response);

    const unsubscribe = () => this.subscribers.delete(response);
    response.once('close', unsubscribe);

    return unsubscribe;
  }

  public publish(update: LiveUpdate): void {
    const frame = `event: ${update.event}\ndata: ${JSON.stringify(update)}\n\n`;

    for (const response of this.subscribers) {
      if (response.destroyed) {
        this.subscribers.delete(response);
        continue;
      }

      response.write(frame);
    }
  }

  public get subscriberCount(): number {
    return this.subscribers.size;
  }
}
