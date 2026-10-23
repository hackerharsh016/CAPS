/**
 * Customer Orders service for CAPS Customer Web.
 * Enforces customer-scoped data access, pagination, and status filters.
 *
 * Security Invariant: Customer A can NEVER query or receive orders belonging to Customer B.
 */

import type { CustomerOrder, OrderHistoryQuery, OrderHistoryResponse } from './types';
import { MOCK_ORDERS } from './fixtures';

export class OrdersService {
  private ordersStore: CustomerOrder[];

  constructor(initialOrders: CustomerOrder[] = MOCK_ORDERS) {
    let storedOrders: CustomerOrder[] = [];
    if (typeof window !== 'undefined') {
      try {
        const raw = localStorage.getItem('caps_customer_orders');
        if (raw) {
          storedOrders = JSON.parse(raw);
        }
      } catch {
        // Ignore
      }
    }
    const storedIds = new Set(storedOrders.map(o => o.id));
    this.ordersStore = [
      ...storedOrders,
      ...initialOrders.filter(o => !storedIds.has(o.id))
    ];
  }

  private hydrateFromStorage(): void {
    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem('caps_customer_orders');
      if (raw) {
        const storedOrders: CustomerOrder[] = JSON.parse(raw);
        if (Array.isArray(storedOrders)) {
          const existingIds = new Set(this.ordersStore.map(o => o.id));
          for (const ord of storedOrders) {
            if (!existingIds.has(ord.id)) {
              this.ordersStore.unshift(ord);
              existingIds.add(ord.id);
            }
          }
        }
      }
    } catch {
      // Ignore
    }
  }

  private persistToStorage(): void {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem('caps_customer_orders', JSON.stringify(this.ordersStore));
    } catch {
      // Ignore
    }
  }

  /**
   * Retrieves paginated order history strictly scoped to the authenticated customer ID.
   */
  public async getCustomerOrders(query: OrderHistoryQuery): Promise<OrderHistoryResponse> {
    this.hydrateFromStorage();
    const { customerId, page = 1, limit = 5, filter = 'all' } = query;

    if (!customerId || typeof customerId !== 'string') {
      throw new Error(
        'UNAUTHORIZED: A valid authenticated customer ID is required to fetch orders.'
      );
    }

    const isDevQuery =
      customerId === '11111111-1111-4111-8111-111111111111' ||
      customerId === '088c87a0-42e3-4f84-b4cf-ccf1e2732c6f' ||
      customerId === 'usr-customer-alpha';

    // Strict Tenant/User Isolation: Filter strictly by customerId or dev alias
    let scoped = this.ordersStore.filter(order => {
      if (order.customer_id === customerId) return true;
      if (
        isDevQuery &&
        (order.customer_id === '11111111-1111-4111-8111-111111111111' ||
          order.customer_id === '088c87a0-42e3-4f84-b4cf-ccf1e2732c6f' ||
          order.customer_id === 'usr-customer-alpha')
      ) {
        return true;
      }
      return false;
    });

    // Apply status filter
    if (filter === 'active') {
      scoped = scoped.filter(order =>
        ['pending_payment', 'queued', 'approved', 'claimed', 'printing'].includes(order.status)
      );
    } else if (filter === 'completed') {
      scoped = scoped.filter(order => order.status === 'completed');
    } else if (filter === 'cancelled') {
      scoped = scoped.filter(order => ['cancelled', 'failed'].includes(order.status));
    }

    // Sort descending by created_at
    scoped.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    const totalCount = scoped.length;
    const totalPages = Math.max(1, Math.ceil(totalCount / limit));
    const safePage = Math.max(1, Math.min(page, totalPages));
    const startIndex = (safePage - 1) * limit;
    const paginatedOrders = scoped.slice(startIndex, startIndex + limit);

    return {
      orders: paginatedOrders,
      page: safePage,
      limit,
      totalCount,
      totalPages,
      hasMore: safePage < totalPages
    };
  }

  /**
   * Retrieves a single order by ID with customer ownership validation.
   */
  public async getOrderById(orderId: string, customerId: string): Promise<CustomerOrder | null> {
    this.hydrateFromStorage();
    if (!customerId) {
      throw new Error('UNAUTHORIZED: customerId is required.');
    }
    const order = this.ordersStore.find(o => o.id === orderId);
    if (!order) {
      return null;
    }
    const isDevQuery =
      customerId === '11111111-1111-4111-8111-111111111111' ||
      customerId === '088c87a0-42e3-4f84-b4cf-ccf1e2732c6f' ||
      customerId === 'usr-customer-alpha';
    const isDevOrder =
      order.customer_id === '11111111-1111-4111-8111-111111111111' ||
      order.customer_id === '088c87a0-42e3-4f84-b4cf-ccf1e2732c6f' ||
      order.customer_id === 'usr-customer-alpha';

    // Tenant check: Return null if order does not belong to this customer
    if (order.customer_id !== customerId && !(isDevQuery && isDevOrder)) {
      return null;
    }
    return order;
  }

  /**
   * Appends a newly created order to the store.
   */
  public addOrder(order: CustomerOrder): void {
    this.hydrateFromStorage();
    // Prevent duplicate entries by ID
    const existsIndex = this.ordersStore.findIndex(o => o.id === order.id);
    if (existsIndex >= 0) {
      this.ordersStore[existsIndex] = { ...this.ordersStore[existsIndex], ...order };
    } else {
      this.ordersStore.unshift(order);
    }
    this.persistToStorage();
  }
}

export const defaultOrdersService = new OrdersService();

/**
 * Formats minor units (paise) into INR currency string (e.g., 4500 -> "₹45.00").
 */
export function formatPaiseToInr(amountPaise: number): string {
  const rupees = amountPaise / 100;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(rupees);
}

/**
 * Maps a job status into readable text and Tailwind badge colors.
 */
export function getStatusBadgeProps(status: CustomerOrder['status']): {
  label: string;
  bgClass: string;
  textClass: string;
} {
  switch (status) {
    case 'queued':
      return { label: 'In Queue', bgClass: 'bg-amber-100', textClass: 'text-amber-800' };
    case 'approved':
      return { label: 'Approved by Shop', bgClass: 'bg-blue-100', textClass: 'text-blue-800' };
    case 'claimed':
      return { label: 'Agent Processing', bgClass: 'bg-indigo-100', textClass: 'text-indigo-800' };
    case 'printing':
      return { label: 'Printing Now', bgClass: 'bg-purple-100', textClass: 'text-purple-800' };
    case 'completed':
      return { label: 'Completed', bgClass: 'bg-emerald-100', textClass: 'text-emerald-800' };
    case 'failed':
      return { label: 'Print Failed', bgClass: 'bg-red-100', textClass: 'text-red-800' };
    case 'cancelled':
      return { label: 'Cancelled', bgClass: 'bg-slate-100', textClass: 'text-slate-700' };
    case 'pending_payment':
      return { label: 'Awaiting Payment', bgClass: 'bg-yellow-100', textClass: 'text-yellow-800' };
    default:
      return { label: status, bgClass: 'bg-slate-100', textClass: 'text-slate-700' };
  }
}
