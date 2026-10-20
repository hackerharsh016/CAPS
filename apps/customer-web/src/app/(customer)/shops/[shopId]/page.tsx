'use client';

import React from 'react';
import { useParams } from 'next/navigation';
import { ShopDetailsView } from '../../../../features/shop-discovery/components/ShopDetailsView';

export default function ShopDetailsPage() {
  const params = useParams<{ shopId: string }>();
  const shopId = params?.shopId || '';

  return <ShopDetailsView shopId={shopId} />;
}
