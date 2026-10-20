import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { ShopsService } from './shops.service.js';
import type { ShopStatus } from './shops.types.js';

export interface ShopsPluginOptions {
  shopsService: ShopsService;
}

const paperPriceTableSchema = z.object({
  bw_single_paise: z.number().int().nonnegative(),
  bw_double_paise: z.number().int().nonnegative(),
  color_single_paise: z.number().int().nonnegative(),
  color_double_paise: z.number().int().nonnegative()
});

const pricingConfigSchema = z.object({
  A4: paperPriceTableSchema,
  A3: paperPriceTableSchema,
  Legal: paperPriceTableSchema,
  binding_prices_paise: z.object({
    none: z.literal(0).default(0),
    spiral: z.number().int().nonnegative(),
    staple: z.number().int().nonnegative(),
    lamination: z.number().int().nonnegative()
  }),
  gst_percentage: z.number().min(0).max(100)
});

const urgentSurchargeConfigSchema = z.object({
  type: z.enum(['flat', 'percentage']),
  amount: z.number().nonnegative(),
  max_urgent_jobs_per_hour: z.number().int().positive().optional()
});

const createShopSchema = z.object({
  name: z.string().min(2, 'Shop name must be at least 2 characters').max(100),
  address: z.string().min(5, 'Address must be at least 5 characters'),
  geo_lat: z.number().min(-90).max(90),
  geo_lng: z.number().min(-180).max(180),
  pricing_config: pricingConfigSchema,
  urgent_surcharge_config: urgentSurchargeConfigSchema,
  auto_print_enabled: z.boolean().optional(),
  allow_pay_at_counter: z.boolean().optional()
});

const updateShopSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  address: z.string().min(5).optional(),
  geo_lat: z.number().min(-90).max(90).optional(),
  geo_lng: z.number().min(-180).max(180).optional(),
  status: z.enum(['open', 'closed']).optional(),
  pricing_config: pricingConfigSchema.optional(),
  urgent_surcharge_config: urgentSurchargeConfigSchema.optional(),
  auto_print_enabled: z.boolean().optional(),
  allow_pay_at_counter: z.boolean().optional()
});

const listShopsQuerySchema = z.object({
  status: z.enum(['open', 'closed']).optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
  search: z.string().optional()
});

export const shopsRoutes: FastifyPluginAsync<ShopsPluginOptions> = async (fastify, options) => {
  const { shopsService } = options;

  // 1. GET /api/v1/shops (Public discovery with pagination & search)
  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = listShopsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_PAYLOAD',
          message: 'Invalid query parameters for shop discovery.',
          request_id: request.requestId || 'unknown-request',
          details: parsed.error.errors
        }
      });
    }

    const result = await shopsService.listShops({
      status: parsed.data.status as ShopStatus | undefined,
      page: parsed.data.page,
      limit: parsed.data.limit,
      search: parsed.data.search
    });

    return reply.status(200).send({
      data: result.shops,
      pagination: result.pagination
    });
  });

  // 2. GET /api/v1/shops/:id (Public shop profile & pricing discovery)
  fastify.get('/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const shop = await shopsService.getShopById(id);
    return reply.status(200).send({
      data: shop
    });
  });

  // 3. POST /api/v1/shops (Shop onboarding - Owner only)
  fastify.post(
    '/',
    { preHandler: [fastify.authenticate, fastify.authorize(['shop_owner', 'admin'])] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = createShopSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_PAYLOAD',
            message: 'Invalid shop creation payload.',
            request_id: request.requestId || 'unknown-request',
            details: parsed.error.errors
          }
        });
      }

      const ownerId = request.user!.id;
      const shop = await shopsService.createShop(ownerId, parsed.data);
      return reply.status(201).send({
        data: shop
      });
    }
  );

  // 4. PATCH /api/v1/shops/:id (Shop update - Owner only with explicit tenant check)
  fastify.patch(
    '/:id',
    { preHandler: [fastify.authenticate, fastify.authorize(['shop_owner', 'admin'])] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const parsed = updateShopSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_PAYLOAD',
            message: 'Invalid shop update payload.',
            request_id: request.requestId || 'unknown-request',
            details: parsed.error.errors
          }
        });
      }

      const updated = await shopsService.updateShop(
        id,
        request.user!.id,
        request.user!.role,
        parsed.data
      );

      return reply.status(200).send({
        data: updated
      });
    }
  );
};
