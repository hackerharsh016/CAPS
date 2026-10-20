import type { UserProfile, CreateUserProfileDto, UpdateUserProfileDto } from './users.types.js';

export interface IUsersRepository {
  findById(id: string): Promise<UserProfile | null>;
  findByEmail(email: string): Promise<UserProfile | null>;
  create(dto: CreateUserProfileDto): Promise<UserProfile>;
  update(id: string, dto: UpdateUserProfileDto): Promise<UserProfile | null>;
  delete(id: string): Promise<boolean>;
}

export class MockUsersRepository implements IUsersRepository {
  private users: Map<string, UserProfile> = new Map();

  async findById(id: string): Promise<UserProfile | null> {
    const user = this.users.get(id);
    return user ? { ...user } : null;
  }

  async findByEmail(email: string): Promise<UserProfile | null> {
    for (const user of this.users.values()) {
      if (user.email === email) {
        return { ...user };
      }
    }
    return null;
  }

  async create(dto: CreateUserProfileDto): Promise<UserProfile> {
    const now = new Date().toISOString();
    const profile: UserProfile = {
      id: dto.id,
      role: dto.role ?? 'customer',
      name: dto.name,
      phone: dto.phone,
      created_at: now,
      updated_at: now,
      ...(dto.email !== undefined ? { email: dto.email } : {})
    };
    this.users.set(dto.id, profile);
    return { ...profile };
  }

  async update(id: string, dto: UpdateUserProfileDto): Promise<UserProfile | null> {
    const existing = this.users.get(id);
    if (!existing) return null;

    const updated: UserProfile = {
      ...existing,
      name: dto.name ?? existing.name,
      phone: dto.phone ?? existing.phone,
      email: dto.email !== undefined ? dto.email : existing.email,
      updated_at: new Date().toISOString()
    };
    this.users.set(id, updated);
    return { ...updated };
  }

  async delete(id: string): Promise<boolean> {
    return this.users.delete(id);
  }
}
