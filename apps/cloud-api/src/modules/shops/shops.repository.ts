import type { Shop, CreateShopDto, UpdateShopDto } from './shops.types.js';

export interface IShopsRepository {
  findById(id: string): Promise<Shop | null>;
  findByOwnerId(ownerId: string): Promise<Shop[]>;
  findAllOpen(): Promise<Shop[]>;
  create(dto: CreateShopDto): Promise<Shop>;
  update(id: string, dto: UpdateShopDto): Promise<Shop | null>;
  delete(id: string): Promise<boolean>;
}

export class MockShopsRepository implements IShopsRepository {
  private shops: Map<string, Shop> = new Map();

  async findById(id: string): Promise<Shop | null> {
    const shop = this.shops.get(id);
    return shop ? { ...shop } : null;
  }

  async findByOwnerId(ownerId: string): Promise<Shop[]> {
    return Array.from(this.shops.values())
      .filter(s => s.owner_id === ownerId)
      .map(s => ({ ...s }));
  }

  async findAllOpen(): Promise<Shop[]> {
    return Array.from(this.shops.values())
      .filter(s => s.status === 'open')
      .map(s => ({ ...s }));
  }

  async create(dto: CreateShopDto): Promise<Shop> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const shop: Shop = {
      id,
      owner_id: dto.owner_id,
      name: dto.name,
      address: dto.address,
      geo_lat: dto.geo_lat,
      geo_lng: dto.geo_lng,
      status: 'open',
      pricing_config: dto.pricing_config,
      urgent_surcharge_config: dto.urgent_surcharge_config,
      auto_print_enabled: dto.auto_print_enabled ?? false,
      created_at: now,
      updated_at: now
    };
    this.shops.set(id, shop);
    return { ...shop };
  }

  async update(id: string, dto: UpdateShopDto): Promise<Shop | null> {
    const existing = this.shops.get(id);
    if (!existing) return null;

    const updated: Shop = {
      ...existing,
      name: dto.name !== undefined ? dto.name : existing.name,
      address: dto.address !== undefined ? dto.address : existing.address,
      geo_lat: dto.geo_lat !== undefined ? dto.geo_lat : existing.geo_lat,
      geo_lng: dto.geo_lng !== undefined ? dto.geo_lng : existing.geo_lng,
      status: dto.status !== undefined ? dto.status : existing.status,
      pricing_config: dto.pricing_config !== undefined ? dto.pricing_config : existing.pricing_config,
      urgent_surcharge_config:
        dto.urgent_surcharge_config !== undefined
          ? dto.urgent_surcharge_config
          : existing.urgent_surcharge_config,
      auto_print_enabled:
        dto.auto_print_enabled !== undefined ? dto.auto_print_enabled : existing.auto_print_enabled,
      updated_at: new Date().toISOString()
    };
    this.shops.set(id, updated);
    return { ...updated };
  }

  async delete(id: string): Promise<boolean> {
    return this.shops.delete(id);
  }
}
