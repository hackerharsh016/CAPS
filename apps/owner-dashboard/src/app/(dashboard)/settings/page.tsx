'use client';

/**
 * Shop Operations & Operational Settings Page for CAPS Shop Owner Dashboard.
 * Protected by RouteGuard. Includes pricing/shop policies and push notification settings.
 */

import React from 'react';
import { RouteGuard } from '../../../features/auth/RouteGuard';
import { PricingManagementView } from '../../../features/pricing-management/components/PricingManagementView';
import { NotificationSettingsCard } from '../../../features/notifications/components/NotificationSettingsCard';
import { useOwnerNotifications } from '../../../features/notifications/hooks/use-owner-notifications';
import { useAuth } from '../../../features/auth/auth-context';

function SettingsContent() {
  const { profile } = useAuth();
  const {
    permission,
    isSupported,
    preferences,
    isLoading,
    enablePush,
    disablePush,
    updatePreferences
  } = useOwnerNotifications({ ownerUserId: profile?.id });

  return (
    <div className="space-y-8">
      {/* Push Notification Preferences */}
      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 pt-6">
        <NotificationSettingsCard
          permission={permission}
          isSupported={isSupported}
          preferences={preferences}
          isLoading={isLoading}
          onEnablePush={enablePush}
          onDisablePush={disablePush}
          onUpdatePreferences={updatePreferences}
        />
      </div>

      {/* Pricing & Shop Operational Settings */}
      <PricingManagementView showSettingsOnly={true} />
    </div>
  );
}

export default function SettingsPage() {
  return (
    <RouteGuard>
      <SettingsContent />
    </RouteGuard>
  );
}
