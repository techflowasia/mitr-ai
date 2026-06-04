import { describe, it, expect, vi, afterEach } from 'vitest';
import { MatrixChannelAPI } from './matrix-api.js';

// Representative coverage for the channel-plugin connect() idempotency guard.
// The same one-line guard is applied to the Discord and Slack plugins, whose
// real connect() paths require mocking their SDK clients (discord.js / @slack).
// Matrix's connect() is fetch-based, so the guard is cleanly testable here.

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MatrixChannelAPI connect() idempotency', () => {
  it('skips a redundant connect when already connected (no second sync loop)', async () => {
    const api = new MatrixChannelAPI(
      { homeserver_url: 'https://hs.example', access_token: 'tok', user_id: '@bot:hs' },
      'channel.matrix'
    );

    // Simulate an already-established connection.
    (api as unknown as { status: string }).status = 'connected';

    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await api.connect();

    // The guard must short-circuit before the /whoami credential check — so no
    // network call is made and no second startSync() loop is spawned. Without
    // the guard, connect() would call matrixFetch('GET', '/whoami').
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('also skips when a connect is already in flight (connecting)', async () => {
    const api = new MatrixChannelAPI(
      { homeserver_url: 'https://hs.example', access_token: 'tok', user_id: '@bot:hs' },
      'channel.matrix'
    );
    (api as unknown as { status: string }).status = 'connecting';

    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await api.connect();

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
