import { ApiError } from '../../plugins/error-handler.js';
import type { IShopsRepository } from '../shops/shops.repository.js';
import type { IPrintersRepository } from './printers.repository.js';
import type {
  Printer,
  CreatePrinterDto,
  UpdatePrinterDto,
  ListPrintersQuery
} from './printers.types.js';

export class PrinterError extends ApiError {
  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(statusCode, code, message, details);
    this.name = 'PrinterError';
  }
}

export class PrintersService {
  constructor(
    private readonly printersRepo: IPrintersRepository,
    private readonly shopsRepo: IShopsRepository
  ) {}

  async listPrinters(
    shopId: string,
    query: ListPrintersQuery = {}
  ): Promise<{
    printers: Printer[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      total_pages: number;
    };
  }> {
    const shop = await this.shopsRepo.findById(shopId);
    if (!shop) {
      throw new PrinterError(404, 'NOT_FOUND', `Shop "${shopId}" not found.`);
    }

    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 10));
    const offset = (page - 1) * limit;

    const { printers, total } = await this.printersRepo.findByShopId(shopId, {
      role: query.role,
      status: query.status,
      offset,
      limit
    });

    const totalPages = Math.ceil(total / limit) || 1;

    return {
      printers,
      pagination: {
        page,
        limit,
        total,
        total_pages: totalPages
      }
    };
  }

  async getPrinterById(shopId: string, printerId: string): Promise<Printer> {
    const printer = await this.printersRepo.findById(printerId);
    if (!printer || printer.shop_id !== shopId) {
      throw new PrinterError(
        404,
        'NOT_FOUND',
        `Printer "${printerId}" not found in shop "${shopId}".`
      );
    }
    return printer;
  }

  async createPrinter(
    shopId: string,
    requestingUserId: string,
    requestingUserRole: string,
    dto: Omit<CreatePrinterDto, 'shop_id'>
  ): Promise<Printer> {
    const shop = await this.shopsRepo.findById(shopId);
    if (!shop) {
      throw new PrinterError(404, 'NOT_FOUND', `Shop "${shopId}" not found.`);
    }

    if (requestingUserRole !== 'admin' && shop.owner_id !== requestingUserId) {
      throw new PrinterError(
        403,
        'FORBIDDEN',
        `Forbidden: You do not own shop "${shopId}". Only the verified shop owner can assign printers.`
      );
    }

    return this.printersRepo.create({
      ...dto,
      shop_id: shopId
    });
  }

  async updatePrinter(
    shopId: string,
    printerId: string,
    requestingUserId: string,
    requestingUserRole: string,
    dto: UpdatePrinterDto
  ): Promise<Printer> {
    const shop = await this.shopsRepo.findById(shopId);
    if (!shop) {
      throw new PrinterError(404, 'NOT_FOUND', `Shop "${shopId}" not found.`);
    }

    const printer = await this.printersRepo.findById(printerId);
    if (!printer || printer.shop_id !== shopId) {
      throw new PrinterError(
        404,
        'NOT_FOUND',
        `Printer "${printerId}" not found in shop "${shopId}".`
      );
    }

    // Role check: Admin, or Owner of this shop, or Agent assigned to this shop
    const isOwner = shop.owner_id === requestingUserId;
    const isAdmin = requestingUserRole === 'admin';
    const isAgent = requestingUserRole === 'agent';

    if (!isAdmin && !isOwner && !isAgent) {
      throw new PrinterError(
        403,
        'FORBIDDEN',
        `Forbidden: You do not have permissions to update printer "${printerId}".`
      );
    }

    const updated = await this.printersRepo.update(printerId, dto);
    if (!updated) {
      throw new PrinterError(500, 'INTERNAL_ERROR', `Failed to update printer "${printerId}".`);
    }

    return updated;
  }

  async deletePrinter(
    shopId: string,
    printerId: string,
    requestingUserId: string,
    requestingUserRole: string
  ): Promise<boolean> {
    const shop = await this.shopsRepo.findById(shopId);
    if (!shop) {
      throw new PrinterError(404, 'NOT_FOUND', `Shop "${shopId}" not found.`);
    }

    const printer = await this.printersRepo.findById(printerId);
    if (!printer || printer.shop_id !== shopId) {
      throw new PrinterError(
        404,
        'NOT_FOUND',
        `Printer "${printerId}" not found in shop "${shopId}".`
      );
    }

    if (requestingUserRole !== 'admin' && shop.owner_id !== requestingUserId) {
      throw new PrinterError(
        403,
        'FORBIDDEN',
        `Forbidden: You do not own shop "${shopId}". Only the verified shop owner can remove printers.`
      );
    }

    return this.printersRepo.delete(printerId);
  }
}
