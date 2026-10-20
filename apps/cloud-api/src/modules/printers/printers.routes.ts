import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { PrintersService } from './printers.service.js';
import type { PrinterRole, PrinterStatus } from './printers.types.js';

export interface PrintersPluginOptions {
  printersService: PrintersService;
}

const printerCapabilitiesSchema = z.object({
  paper_sizes: z.array(z.string()).min(1, 'At least one paper size required'),
  color_modes: z.array(z.string()).min(1, 'At least one color mode required'),
  duplex_supported: z.boolean(),
  max_copies: z.number().int().min(1).max(999)
});

const createPrinterSchema = z.object({
  name: z.string().min(1, 'Printer name cannot be empty').max(100),
  role: z.enum(['bw', 'color', 'large_format']).default('bw'),
  status: z.enum(['online', 'offline', 'busy', 'error']).optional(),
  is_default: z.boolean().optional(),
  capabilities: printerCapabilitiesSchema.optional(),
  device_id: z.string().uuid().optional()
});

const updatePrinterSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  role: z.enum(['bw', 'color', 'large_format']).optional(),
  status: z.enum(['online', 'offline', 'busy', 'error']).optional(),
  is_default: z.boolean().optional(),
  capabilities: printerCapabilitiesSchema.optional(),
  device_id: z.string().uuid().optional()
});

const listPrintersQuerySchema = z.object({
  role: z.enum(['bw', 'color', 'large_format']).optional(),
  status: z.enum(['online', 'offline', 'busy', 'error']).optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional()
});

export const printersRoutes: FastifyPluginAsync<PrintersPluginOptions> = async (
  fastify,
  options
) => {
  const { printersService } = options;

  // 1. GET /api/v1/shops/:shop_id/printers (Public / customer / owner printer discovery)
  fastify.get('/:shop_id/printers', async (request: FastifyRequest, reply: FastifyReply) => {
    const { shop_id } = request.params as { shop_id: string };
    const parsed = listPrintersQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_PAYLOAD',
          message: 'Invalid printer query parameters.',
          request_id: request.requestId || 'unknown-request',
          details: parsed.error.errors
        }
      });
    }

    const result = await printersService.listPrinters(shop_id, {
      role: parsed.data.role as PrinterRole | undefined,
      status: parsed.data.status as PrinterStatus | undefined,
      page: parsed.data.page,
      limit: parsed.data.limit
    });

    return reply.status(200).send({
      data: result.printers,
      pagination: result.pagination
    });
  });

  // 2. GET /api/v1/shops/:shop_id/printers/:printer_id (Printer detail and capabilities lookup)
  fastify.get(
    '/:shop_id/printers/:printer_id',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { shop_id, printer_id } = request.params as {
        shop_id: string;
        printer_id: string;
      };
      const printer = await printersService.getPrinterById(shop_id, printer_id);
      return reply.status(200).send({
        data: printer
      });
    }
  );

  // 3. POST /api/v1/shops/:shop_id/printers (Printer registration / assignment - Owner only)
  fastify.post(
    '/:shop_id/printers',
    { preHandler: [fastify.authenticate, fastify.authorize(['shop_owner', 'admin'])] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { shop_id } = request.params as { shop_id: string };
      const parsed = createPrinterSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_PAYLOAD',
            message: 'Invalid printer registration payload.',
            request_id: request.requestId || 'unknown-request',
            details: parsed.error.errors
          }
        });
      }

      const printer = await printersService.createPrinter(
        shop_id,
        request.user!.id,
        request.user!.role,
        parsed.data
      );

      return reply.status(201).send({
        data: printer
      });
    }
  );

  // 4. PATCH /api/v1/shops/:shop_id/printers/:printer_id (Printer update / capabilities / status)
  fastify.patch(
    '/:shop_id/printers/:printer_id',
    {
      preHandler: [fastify.authenticate, fastify.authorize(['shop_owner', 'admin', 'agent'])]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { shop_id, printer_id } = request.params as {
        shop_id: string;
        printer_id: string;
      };
      const parsed = updatePrinterSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_PAYLOAD',
            message: 'Invalid printer update payload.',
            request_id: request.requestId || 'unknown-request',
            details: parsed.error.errors
          }
        });
      }

      const updated = await printersService.updatePrinter(
        shop_id,
        printer_id,
        request.user!.id,
        request.user!.role,
        parsed.data
      );

      return reply.status(200).send({
        data: updated
      });
    }
  );

  // 5. DELETE /api/v1/shops/:shop_id/printers/:printer_id (Printer removal - Owner only)
  fastify.delete(
    '/:shop_id/printers/:printer_id',
    { preHandler: [fastify.authenticate, fastify.authorize(['shop_owner', 'admin'])] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { shop_id, printer_id } = request.params as {
        shop_id: string;
        printer_id: string;
      };
      await printersService.deletePrinter(
        shop_id,
        printer_id,
        request.user!.id,
        request.user!.role
      );

      return reply.status(200).send({
        data: {
          deleted: true,
          printer_id
        }
      });
    }
  );
};
