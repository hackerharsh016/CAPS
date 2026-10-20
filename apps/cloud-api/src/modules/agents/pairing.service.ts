/**
 * Agent Pairing & Credential Lifecycle Service.
 * Implements:
 * - Ephemeral single-use pairing codes with short TTL (10 minutes).
 * - Per-device secret generation with SHA-256 hashing.
 * - Windows DPAPI credential storage integration guidance.
 * - Device revocation and immediate lease reconciliation.
 * - Strict secret isolation (NO service-role or master keys distributed).
 */

import crypto from 'node:crypto';
import { AuthError, NotFoundError } from '../../plugins/error-handler.js';
import type { IAgentsRepository } from './agents.repository.js';
import type { IShopsRepository } from '../shops/shops.repository.js';
import type {
  PairAgentDeviceDto,
  PairAgentDeviceResponseDto,
  PairingCodeResponseDto,
  HeartbeatDto,
  HeartbeatResponseDto,
  AgentDevice
} from './agents.types.js';
import { ClaimError, AgentClaimService } from './agent-claim.service.js';

export class PairingService {
  constructor(
    private readonly agentsRepo: IAgentsRepository,
    private readonly shopsRepo: IShopsRepository,
    private readonly claimService?: AgentClaimService
  ) {}

  /**
   * Generates a single-use pairing code for a shop with 10-minute TTL.
   * Authorized strictly for shop owners and admins.
   */
  async generatePairingCode(
    user: { id: string; role: string },
    shopId: string,
    ttlSeconds: number = 600
  ): Promise<PairingCodeResponseDto> {
    const shop = await this.shopsRepo.findById(shopId);
    if (!shop) {
      throw new NotFoundError(`Shop '${shopId}' not found.`);
    }

    if (user.role !== 'admin' && shop.owner_id !== user.id) {
      throw new AuthError(403, 'FORBIDDEN', `Forbidden: You do not own shop '${shopId}'.`);
    }

    const clampedTtl = Math.min(1800, Math.max(60, ttlSeconds));
    const pairing = await this.agentsRepo.createPairingCode(shopId, user.id, clampedTtl);

    return {
      pairing_code: pairing.code,
      shop_id: shopId,
      expires_at: pairing.expires_at
    };
  }

  /**
   * Enrolls a Windows Print Agent device using an ephemeral pairing code.
   * Generates per-device secret and Windows DPAPI storage guidance.
   * Strictly never returns Supabase service-role keys.
   */
  async pairDevice(dto: PairAgentDeviceDto): Promise<PairAgentDeviceResponseDto> {
    const pairing = await this.agentsRepo.findPairingCode(dto.pairing_code);
    if (!pairing) {
      throw new NotFoundError('Invalid or nonexistent pairing code.');
    }

    if (pairing.is_used) {
      throw new ClaimError(
        409,
        'PAIRING_CODE_ALREADY_USED',
        'Pairing code has already been consumed. Please generate a fresh code.'
      );
    }

    if (new Date(pairing.expires_at).getTime() < Date.now()) {
      throw new ClaimError(
        410,
        'PAIRING_CODE_EXPIRED',
        'Pairing code has expired. Please request a new code from the shop owner.'
      );
    }

    // Generate random 256-bit device secret (caps_agent_sec_...)
    const rawSecretBytes = crypto.randomBytes(32).toString('hex');
    const deviceSecret = `caps_agent_sec_${rawSecretBytes}`;
    const authTokenHash = crypto.createHash('sha256').update(deviceSecret).digest('hex');

    // Register or re-activate device
    const device = await this.agentsRepo.registerDevice({
      shop_id: pairing.shop_id,
      device_fingerprint: dto.device_fingerprint,
      device_name: dto.device_name,
      agent_version: dto.agent_version,
      auth_token_hash: authTokenHash,
      paired_by: pairing.created_by
    });

    // Mark pairing code consumed
    await this.agentsRepo.consumePairingCode(pairing.code, device.id);

    return {
      success: true,
      device_id: device.id,
      shop_id: device.shop_id,
      device_name: device.device_name,
      device_secret: deviceSecret, // Only returned ONCE upon pairing
      storage_guidance: {
        recommended_provider: 'windows_dpapi',
        target_credential_name: `CAPS_AGENT_AUTH_${device.id}`
      },
      paired_at: new Date().toISOString()
    };
  }

  /**
   * Records agent heartbeat and returns server status.
   * Immediately rejects revoked devices with 403 REVOKED_DEVICE.
   */
  async recordHeartbeat(dto: HeartbeatDto): Promise<HeartbeatResponseDto> {
    const device = await this.agentsRepo.findDeviceById(dto.device_id);
    if (!device) {
      throw new NotFoundError(`Agent device '${dto.device_id}' not found.`);
    }

    if (device.is_revoked) {
      throw new ClaimError(
        403,
        'REVOKED_DEVICE',
        `Agent device '${dto.device_id}' has been revoked (${device.revoked_reason || 'Unauthorized'}).`
      );
    }

    await this.agentsRepo.recordHeartbeat(dto);

    return {
      acknowledged: true,
      server_time: new Date().toISOString(),
      is_revoked: false
    };
  }

  /**
   * Revokes an agent device immediately.
   * Recovers any abandoned leases back to queue.
   */
  async revokeDevice(
    user: { id: string; role: string },
    shopId: string,
    deviceId: string,
    reason?: string
  ): Promise<AgentDevice> {
    const shop = await this.shopsRepo.findById(shopId);
    if (!shop) {
      throw new NotFoundError(`Shop '${shopId}' not found.`);
    }

    if (user.role !== 'admin' && shop.owner_id !== user.id) {
      throw new AuthError(403, 'FORBIDDEN', `Forbidden: You do not own shop '${shopId}'.`);
    }

    const device = await this.agentsRepo.findDeviceById(deviceId);
    if (!device || device.shop_id !== shopId) {
      throw new NotFoundError(`Agent device '${deviceId}' not found in shop '${shopId}'.`);
    }

    const revoked = await this.agentsRepo.revokeDevice(deviceId, reason || 'Revoked by shop owner');

    if (!revoked) {
      throw new ClaimError(500, 'REVOCATION_FAILED', 'Failed to revoke device.');
    }

    // Immediately reconcile leases held by this shop
    if (this.claimService) {
      await this.claimService.reconcileExpiredLeases(shopId);
    }

    return revoked;
  }

  /**
   * Lists devices for a shop.
   */
  async listDevices(user: { id: string; role: string }, shopId: string): Promise<AgentDevice[]> {
    const shop = await this.shopsRepo.findById(shopId);
    if (!shop) {
      throw new NotFoundError(`Shop '${shopId}' not found.`);
    }

    if (user.role !== 'admin' && shop.owner_id !== user.id) {
      throw new AuthError(403, 'FORBIDDEN', `Forbidden: You do not own shop '${shopId}'.`);
    }

    return this.agentsRepo.listDevicesByShop(shopId);
  }

  /**
   * Retrieves a device by its ID.
   */
  async getDevice(deviceId: string): Promise<AgentDevice | null> {
    return this.agentsRepo.findDeviceById(deviceId);
  }
}
