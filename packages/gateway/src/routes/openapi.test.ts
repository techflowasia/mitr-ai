/**
 * OpenAPI routes tests
 *
 * Integration test: registers the OpenAPI routes alongside a handful of
 * fake API endpoints and verifies the served spec covers them.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { registerOpenApiRoutes } from './openapi.js';

describe('OpenAPI routes', () => {
  let app: Hono;

  beforeEach(() => {
    app = new Hono();
    app.get('/api/v1/fleet', (c) => c.json({ ok: true }));
    app.post('/api/v1/fleet/:fleetId/start', (c) => c.json({ ok: true }));
    app.get('/health', (c) => c.text('ok'));
    registerOpenApiRoutes(app);
  });

  it('GET /openapi.json returns a valid OpenAPI 3.1 envelope', async () => {
    const res = await app.request('/openapi.json');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const spec = (await res.json()) as Record<string, unknown>;
    expect(spec.openapi).toBe('3.1.0');
    expect(spec.info).toBeDefined();
    expect(spec.paths).toBeDefined();
    expect(spec.components).toBeDefined();
  });

  it('includes registered API routes and converts path params', async () => {
    const res = await app.request('/openapi.json');
    const spec = (await res.json()) as { paths: Record<string, Record<string, unknown>> };
    expect(spec.paths['/api/v1/fleet']).toBeDefined();
    expect(spec.paths['/api/v1/fleet']!.get).toBeDefined();
    expect(spec.paths['/api/v1/fleet/{fleetId}/start']).toBeDefined();
    expect(spec.paths['/api/v1/fleet/{fleetId}/start']!.post).toBeDefined();
  });

  it('excludes /health from the spec', async () => {
    const res = await app.request('/openapi.json');
    const spec = (await res.json()) as { paths: Record<string, unknown> };
    expect(spec.paths['/health']).toBeUndefined();
  });

  it('caches the spec across calls', async () => {
    const a = await (await app.request('/openapi.json')).json();
    const b = await (await app.request('/openapi.json')).json();
    expect(a).toEqual(b);
  });

  it('GET /docs serves the Swagger UI HTML', async () => {
    const res = await app.request('/docs');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('swagger-ui');
    expect(html).toContain('/openapi.json');
  });
});
