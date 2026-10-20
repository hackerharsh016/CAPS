import { ApiError } from '../../plugins/error-handler.js';
import type { IShopsRepository } from './shops.repository.js';
import type { Shop, CreateShopDto, UpdateShopDto, ListShopsQuery } from './shops.types.js';

export class ShopError extends ApiError {
  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(statusCode, code, message, details);
    this.name = 'ShopError';
  }
}

export class ShopsService {
  constructor(private readonly shopsRepo: IShopsRepository) {}

  async listShops(query: ListShopsQuery = {}): Promise<{
    shops: Shop[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      total_pages: number;
    };
  }> {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 10));
    const offset = (page - 1) * limit;

    const { shops, total } = await this.shopsRepo.findAll({
      status: query.status,
      search: query.search,
      offset,
      limit
    });

    const totalPages = Math.ceil(total / limit) || 1;

    return {
      shops,
      pagination: {
        page,
        limit,
        total,
        total_pages: totalPages
      }
    };
  }

  async getShopById(id: string): Promise<Shop> {
    const shop = await this.shopsRepo.findById(id);
    if (!shop) {
      throw new ShopError(404, 'NOT_FOUND', `Shop "${id}" not found.`);
    }
    return shop;
  }

  async createShop(ownerId: string, dto: Omit<CreateShopDto, 'owner_id'>): Promise<Shop> {
    return this.shopsRepo.create({
      ...dto,
      owner_id: ownerId
    });
  }

  async updateShop(
    shopId: string,
    requestingUserId: string,
    requestingUserRole: string,
    dto: UpdateShopDto
  ): Promise<Shop> {
    const existing = await this.shopsRepo.findById(shopId);
    if (!existing) {
      throw new ShopError(404, 'NOT_FOUND', `Shop "${shopId}" not found.`);
    }

    // Explicit owner authorization enforcement
    if (requestingUserRole !== 'admin' && existing.owner_id !== requestingUserId) {
      throw new ShopError(
        403,
        'FORBIDDEN',
        `Forbidden: You do not own shop "${shopId}". Only the verified shop owner can update this profile.`
      );
    }

    const updated = await this.shopsRepo.update(shopId, dto);
    if (!updated) {
      throw new ShopError(500, 'INTERNAL_ERROR', `Failed to update shop "${shopId}".`);
    }

    return updated;
  }
}
