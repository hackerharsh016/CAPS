'use client';

/**
 * Customer Order History Page.
 * Renders the OrderHistoryList component with live pagination and filtering.
 */

import React from 'react';
import { OrderHistoryList } from '../../../features/orders/components/OrderHistoryList';

export default function CustomerOrdersPage() {
  return <OrderHistoryList />;
}
