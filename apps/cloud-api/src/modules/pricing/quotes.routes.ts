import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { QuotesService } from './quotes.service.js';
import type {
  PaperSize,
  ColorMode,
  SideMode,
  Orientation,
  BindingType,
  PriorityTier
} from './pricing.types.js';

export interface QuotesPluginOptions {
  quotesService: QuotesService;
}

const printSettingsInputSchema = z.object({
  paper_size: z.enum(['A4', 'A3', 'Legal']).optional(),
  paperSize: z.enum(['A4', 'A3', 'Legal']).optional(),
  color_mode: z.enum(['bw', 'color']).optional(),
  colorMode: z.enum(['bw', 'color']).optional(),
  sides: z.enum(['single', 'double']).optional(),
  orientation: z.enum(['portrait', 'landscape']).default('portrait').optional(),
  copies: z.number().int().min(1).max(100).default(1).optional(),
  page_range: z.string().default('all').optional(),
  pageRange: z.string().default('all').optional(),
  binding: z.enum(['none', 'spiral', 'staple', 'lamination']).default('none').optional()
});

const createQuoteRequestSchema = z
  .object({
    shop_id: z.string().min(1, 'shop_id is required').optional(),
    shopId: z.string().min(1, 'shopId is required').optional(),
    settings: printSettingsInputSchema,
    priority_tier: z.enum(['urgent', 'flexible']).optional(),
    priorityTier: z.enum(['urgent', 'flexible']).optional(),
    document_page_count: z
      .number()
      .int()
      .min(1, 'document_page_count must be at least 1')
      .optional(),
    documentPageCount: z.number().int().min(1, 'documentPageCount must be at least 1').optional(),
    document_id: z.string().optional(),
    documentId: z.string().optional()
    // Any extra fields supplied by client (like client_price, total_paise, etc.) are stripped
  })
  .passthrough(); // Allow passthrough so we can test that tampered fields sent by client are cleanly ignored

export const quotesRoutes: FastifyPluginAsync<QuotesPluginOptions> = async (fastify, options) => {
  const { quotesService } = options;

  // Optional authentication handler: attaches user if authorization header is provided
  const maybeAuthenticate = async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.headers.authorization) {
      await fastify.authenticate(request, reply);
    }
  };

  // 1. POST /api/v1/quotes (Create authoritative server-priced estimate)
  fastify.post(
    '/',
    { preHandler: [maybeAuthenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = createQuoteRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_PAYLOAD',
            message: 'Invalid quote request payload.',
            request_id: request.requestId || 'unknown-request',
            details: parsed.error.errors
          }
        });
      }

      const shopId = parsed.data.shop_id || parsed.data.shopId;
      if (!shopId) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_PAYLOAD',
            message: 'shop_id or shopId is required.',
            request_id: request.requestId || 'unknown-request'
          }
        });
      }

      const rawSettings = parsed.data.settings;
      const paperSize = (rawSettings.paper_size || rawSettings.paperSize || 'A4') as PaperSize;
      const colorMode = (rawSettings.color_mode || rawSettings.colorMode || 'bw') as ColorMode;
      const sides = (rawSettings.sides || 'single') as SideMode;
      const orientation = (rawSettings.orientation || 'portrait') as Orientation;
      const copies = rawSettings.copies ?? 1;
      const pageRange = rawSettings.page_range || rawSettings.pageRange || 'all';
      const binding = (rawSettings.binding || 'none') as BindingType;

      const priorityTier = (parsed.data.priority_tier ||
        parsed.data.priorityTier ||
        'flexible') as PriorityTier;
      const docPageCount = parsed.data.document_page_count ?? parsed.data.documentPageCount;

      if (!docPageCount) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_PAYLOAD',
            message: 'document_page_count or documentPageCount is required.',
            request_id: request.requestId || 'unknown-request'
          }
        });
      }

      const documentId = parsed.data.document_id || parsed.data.documentId;

      const quote = await quotesService.createQuote(request.user, {
        shop_id: shopId,
        settings: {
          paper_size: paperSize,
          color_mode: colorMode,
          sides,
          orientation,
          copies,
          page_range: pageRange,
          binding
        },
        priority_tier: priorityTier,
        document_page_count: docPageCount,
        ...(documentId !== undefined ? { document_id: documentId } : {})
      });

      return reply.status(201).send({
        data: quote
      });
    }
  );

  // 2. GET /api/v1/quotes/:id (Fetch existing valid quote)
  fastify.get(
    '/:id',
    { preHandler: [maybeAuthenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const quote = await quotesService.getQuoteById(id, request.user);

      return reply.status(200).send({
        data: quote
      });
    }
  );
};
