import { Type, type FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { problems } from '../lib/problem.ts';
import {
  apiKeySecurity,
  DatasetFileParams,
  DatasetListResponse,
  DatasetManifestResponse,
  DatasetParams,
  guardedResponses,
  ProblemResponse,
} from '../schemas/index.ts';

// A version's files never change; "latest" moves, so its answers are revalidated.
const IMMUTABLE = 'private, max-age=31536000, immutable';
const REVALIDATE = 'private, no-cache';

function contentType(file: string): string {
  if (file.endsWith('.geojson')) return 'application/geo+json';
  if (file.endsWith('.json')) return 'application/json';
  return 'text/plain; charset=utf-8';
}

/** RFC 9110 weak comparison: a list of tags, W/ prefixes, or "*". */
function matchesEtag(header: string | undefined, etag: string): boolean {
  if (header === undefined) return false;
  return header.split(',').some((raw) => {
    const tag = raw.trim();
    return tag === '*' || tag.replace(/^W\//, '') === etag;
  });
}

const datasetRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    '/api/v1/datasets',
    {
      preHandler: [app.authenticateApiKey],
      schema: {
        tags: ['datasets'],
        summary: 'Reference datasets and their retained versions',
        security: apiKeySecurity,
        response: { 200: DatasetListResponse, ...guardedResponses },
      },
    },
    async () => ({ datasets: await app.services.datasets.list() }),
  );

  app.get(
    '/api/v1/datasets/:name/:version/manifest',
    {
      preHandler: [app.authenticateApiKey],
      schema: {
        tags: ['datasets'],
        summary: 'Manifest of one dataset version: sources, licence, files and digests',
        security: apiKeySecurity,
        params: DatasetParams,
        response: { 200: DatasetManifestResponse, 404: ProblemResponse, ...guardedResponses },
      },
    },
    async (request, reply) => {
      const { name, version } = request.params;
      const manifest = await app.services.datasets.manifest(name, version);
      if (manifest === null) throw problems.notFound('Dataset version');

      reply.header('cache-control', version === 'latest' ? REVALIDATE : IMMUTABLE);
      return manifest;
    },
  );

  app.get(
    '/api/v1/datasets/:name/:version/files/:file',
    {
      preHandler: [app.authenticateApiKey],
      schema: {
        tags: ['datasets'],
        summary: 'One file of a dataset version, as listed in its manifest',
        description: 'The ETag is the sha256 the manifest gives for the file.',
        security: apiKeySecurity,
        params: DatasetFileParams,
        response: {
          200: Type.Unknown({ description: 'The file, streamed.' }),
          304: Type.Null({ description: 'The client already holds this file.' }),
          404: ProblemResponse,
          ...guardedResponses,
        },
      },
    },
    async (request, reply) => {
      const { name, version, file } = request.params;
      const found = await app.services.datasets.file(name, version, file);
      if (found === null) throw problems.notFound('Dataset file');

      const etag = `"${found.sha256}"`;
      const cacheControl = found.immutable ? IMMUTABLE : REVALIDATE;
      if (matchesEtag(request.headers['if-none-match'], etag)) {
        return reply
          .code(304)
          .header('etag', etag)
          .header('cache-control', cacheControl)
          .send(null);
      }

      const opened = await found.open();
      if (opened === null) throw problems.notFound('Dataset file');

      return reply
        .header('etag', etag)
        .header('cache-control', cacheControl)
        .type(contentType(file))
        .header('content-length', opened.size)
        .send(opened.stream);
    },
  );
};

export default datasetRoutes;
