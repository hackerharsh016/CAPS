/**
 * Printer Management Service for CAPS Owner Dashboard.
 * Handles:
 * 1. Querying printers and assigned Windows agent devices for an owner shop
 * 2. Assigning / re-assigning discovered printers to active shop Windows devices
 * 3. Enforcing tenant isolation: cannot assign device belonging to another shop
 * 4. Driver capabilities difference detection and alerts (e.g. duplex dropped, color removed)
 * 5. Managing default printer routing and roles (bw, color, large_format)
 */

import { getSupabaseEnv, getSupabaseBrowserClient } from '../../lib/supabase';
import type {
  Printer,
  AgentDevice,
  UpdatePrinterAssignmentInput,
  DriverCapabilities,
  CapabilityDifference
} from './types';

export class PrinterManagementError extends Error {
  readonly code:
    | 'UNAUTHORIZED_CROSS_SHOP'
    | 'DEVICE_NOT_FOUND'
    | 'PRINTER_NOT_FOUND'
    | 'DEVICE_REVOKED'
    | 'NETWORK_ERROR'
    | 'VALIDATION_ERROR';

  constructor(
    code:
      | 'UNAUTHORIZED_CROSS_SHOP'
      | 'DEVICE_NOT_FOUND'
      | 'PRINTER_NOT_FOUND'
      | 'DEVICE_REVOKED'
      | 'NETWORK_ERROR'
      | 'VALIDATION_ERROR',
    message: string
  ) {
    super(message);
    this.name = 'PrinterManagementError';
    this.code = code;
  }
}

export interface PrinterServiceConfig {
  customFetch?: typeof fetch | undefined;
  supabaseUrl?: string | undefined;
  supabaseAnonKey?: string | undefined;
}

/**
 * Calculates differences between driver-reported capabilities and expected settings.
 */
export function detectCapabilityDifferences(
  previous: DriverCapabilities,
  current: DriverCapabilities
): CapabilityDifference {
  const changes: string[] = [];

  // Check color support
  const prevColor = previous.color_modes.includes('color');
  const currColor = current.color_modes.includes('color');
  if (prevColor && !currColor) {
    changes.push('Color printing capability dropped by printer driver');
  } else if (!prevColor && currColor) {
    changes.push('Color printing capability added');
  }

  // Check duplex support
  if (previous.duplex_supported && !current.duplex_supported) {
    changes.push('Hardware duplex unit offline or disabled in Windows driver');
  } else if (!previous.duplex_supported && current.duplex_supported) {
    changes.push('Hardware duplex unit detected and enabled');
  }

  // Check paper sizes
  const missingSizes = previous.paper_sizes.filter(size => !current.paper_sizes.includes(size));
  if (missingSizes.length > 0) {
    changes.push(`Paper sizes no longer reported: ${missingSizes.join(', ')}`);
  }

  return {
    hasDifferences: changes.length > 0,
    changes
  };
}

export class PrinterService {
  private readonly supabaseUrl: string;
  private readonly supabaseAnonKey: string;
  private readonly fetchFn: typeof fetch;

  constructor(config?: PrinterServiceConfig) {
    const env = getSupabaseEnv();
    this.supabaseUrl = (config?.supabaseUrl ?? env.supabaseUrl).replace(/\/$/, '');
    this.supabaseAnonKey = config?.supabaseAnonKey ?? env.supabaseAnonKey;
    this.fetchFn =
      config?.customFetch ??
      (typeof fetch !== 'undefined'
        ? fetch.bind(globalThis)
        : (undefined as unknown as typeof fetch));
  }

  /**
   * Fetches all registered physical printers for a shop.
   */
  async fetchShopPrinters(shopId: string, accessToken?: string): Promise<Printer[]> {
    if (!shopId) return [];

    const client = getSupabaseBrowserClient();
    const session = await client.getSession();
    const token = accessToken || session?.access_token;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      apikey: this.supabaseAnonKey
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    try {
      const endpoint = `${this.supabaseUrl}/rest/v1/printers?shop_id=eq.${shopId}&select=*,device:agent_devices(*)&order=name.asc`;
      const res = await this.fetchFn(endpoint, { method: 'GET', headers });
      if (!res.ok) {
        return [];
      }
      return (await res.json()) as Printer[];
    } catch {
      return [];
    }
  }

  /**
   * Fetches all Windows agent devices paired to this shop.
   */
  async fetchShopAgentDevices(shopId: string, accessToken?: string): Promise<AgentDevice[]> {
    if (!shopId) return [];

    const client = getSupabaseBrowserClient();
    const session = await client.getSession();
    const token = accessToken || session?.access_token;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      apikey: this.supabaseAnonKey
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    try {
      const endpoint = `${this.supabaseUrl}/rest/v1/agent_devices?shop_id=eq.${shopId}&order=device_name.asc`;
      const res = await this.fetchFn(endpoint, { method: 'GET', headers });
      if (!res.ok) {
        return [];
      }
      return (await res.json()) as AgentDevice[];
    } catch {
      return [];
    }
  }

  /**
   * Updates printer assignment to a Windows agent device and configures role / default status.
   * Invariant: Cannot assign a device belonging to another shop!
   */
  async updatePrinterAssignment(
    input: UpdatePrinterAssignmentInput,
    accessToken?: string
  ): Promise<Printer> {
    const { printer_id, shopId, device_id, role, is_default } = {
      ...input,
      shopId: input.shop_id
    };

    if (!printer_id || !shopId) {
      throw new PrinterManagementError('VALIDATION_ERROR', 'Printer ID and Shop ID are required.');
    }

    const client = getSupabaseBrowserClient();
    const session = await client.getSession();
    const effectiveToken = accessToken || session?.access_token;
    const effectiveUserId = session?.user?.id;

    if (!effectiveToken || !effectiveUserId) {
      throw new PrinterManagementError(
        'UNAUTHORIZED_CROSS_SHOP',
        'User session is invalid or unauthenticated.'
      );
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      apikey: this.supabaseAnonKey,
      Authorization: `Bearer ${effectiveToken}`
    };

    // 1. Verify shop ownership
    const shopUrl = `${this.supabaseUrl}/rest/v1/shops?id=eq.${shopId}&select=id,owner_id`;
    try {
      const shopRes = await this.fetchFn(shopUrl, { method: 'GET', headers });
      if (!shopRes.ok) {
        throw new PrinterManagementError(
          'UNAUTHORIZED_CROSS_SHOP',
          'Failed to verify shop ownership.'
        );
      }
      const shops = (await shopRes.json()) as Array<{ id: string; owner_id: string }>;
      const shop = shops[0];
      if (!shop || shop.owner_id !== effectiveUserId) {
        throw new PrinterManagementError(
          'UNAUTHORIZED_CROSS_SHOP',
          'Unauthorized: Current user does not own this shop.'
        );
      }
    } catch (err) {
      if (err instanceof PrinterManagementError) throw err;
      throw new PrinterManagementError(
        'UNAUTHORIZED_CROSS_SHOP',
        'Unauthorized: Current user does not own this shop.'
      );
    }

    // 2. If assigning to a device, verify device belongs to THIS shop and is not revoked
    if (device_id) {
      const deviceUrl = `${this.supabaseUrl}/rest/v1/agent_devices?id=eq.${device_id}&select=id,shop_id,device_name,is_revoked`;
      const devRes = await this.fetchFn(deviceUrl, { method: 'GET', headers });
      if (!devRes.ok) {
        throw new PrinterManagementError('DEVICE_NOT_FOUND', `Device ${device_id} not found.`);
      }
      const devices = (await devRes.json()) as Array<{
        id: string;
        shop_id: string;
        device_name: string;
        is_revoked: boolean;
      }>;
      const device = devices[0];

      if (!device) {
        throw new PrinterManagementError('DEVICE_NOT_FOUND', `Device ${device_id} not found.`);
      }

      // Security check: cannot assign device of another shop!
      if (device.shop_id !== shopId) {
        throw new PrinterManagementError(
          'UNAUTHORIZED_CROSS_SHOP',
          `Unauthorized: Cannot assign device ${device.device_name} belonging to another shop (${device.shop_id})!`
        );
      }

      if (device.is_revoked) {
        throw new PrinterManagementError(
          'DEVICE_REVOKED',
          `Cannot assign printer to revoked agent device ${device.device_name}.`
        );
      }
    }

    // 3. Verify printer exists and belongs to this shop
    const printerUrl = `${this.supabaseUrl}/rest/v1/printers?id=eq.${printer_id}&select=id,shop_id,name,role,capabilities,status`;
    const printRes = await this.fetchFn(printerUrl, { method: 'GET', headers });
    if (!printRes.ok) {
      throw new PrinterManagementError('PRINTER_NOT_FOUND', `Printer ${printer_id} not found.`);
    }
    const printers = (await printRes.json()) as Array<{
      id: string;
      shop_id: string;
      name: string;
    }>;
    const targetPrinter = printers[0];

    if (!targetPrinter || targetPrinter.shop_id !== shopId) {
      throw new PrinterManagementError(
        'UNAUTHORIZED_CROSS_SHOP',
        `Printer ${printer_id} does not belong to this shop.`
      );
    }

    // 4. If setting as default, clear default on other printers in the same shop
    if (is_default) {
      const clearDefaultUrl = `${this.supabaseUrl}/rest/v1/printers?shop_id=eq.${shopId}&id=neq.${printer_id}`;
      await this.fetchFn(clearDefaultUrl, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ is_default: false })
      });
    }

    // 5. Update printer assignment
    const patchPayload: Record<string, unknown> = {
      device_id: device_id ?? null,
      updated_at: new Date().toISOString()
    };
    if (role !== undefined) patchPayload['role'] = role;
    if (is_default !== undefined) patchPayload['is_default'] = is_default;

    const updateUrl = `${this.supabaseUrl}/rest/v1/printers?id=eq.${printer_id}&shop_id=eq.${shopId}`;
    const updateRes = await this.fetchFn(updateUrl, {
      method: 'PATCH',
      headers: {
        ...headers,
        Prefer: 'return=representation'
      },
      body: JSON.stringify(patchPayload)
    });

    if (!updateRes.ok) {
      throw new PrinterManagementError(
        'NETWORK_ERROR',
        `Failed to update printer assignment: HTTP ${updateRes.status}`
      );
    }

    const updated = (await updateRes.json()) as Printer[];
    const result = updated[0];
    if (!result) {
      throw new PrinterManagementError(
        'NETWORK_ERROR',
        'Failed to retrieve updated printer representation.'
      );
    }

    return result;
  }
}

export const defaultPrinterService = new PrinterService();
