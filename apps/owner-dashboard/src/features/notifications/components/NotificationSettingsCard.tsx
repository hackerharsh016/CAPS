'use client';

/**
 * NotificationSettingsCard Component.
 * Allows shop owners to configure push notifications and alert preferences:
 * - Master Push Notifications Toggle (with browser permission status & trigger)
 * - Urgent Priority Alerts
 * - Hardware Error / Jam Alerts
 * - Daily Summary Reports
 * - Sound Alerts
 */

import React from 'react';
import type { PushPermissionStatus, OwnerNotificationPreferences } from '../types';

export interface NotificationSettingsCardProps {
  permission: PushPermissionStatus;
  isSupported: boolean;
  preferences: OwnerNotificationPreferences;
  isLoading: boolean;
  onEnablePush: () => Promise<boolean>;
  onDisablePush: () => Promise<boolean>;
  onUpdatePreferences: (prefs: Partial<OwnerNotificationPreferences>) => void;
}

export function NotificationSettingsCard({
  permission,
  isSupported,
  preferences,
  isLoading,
  onEnablePush,
  onDisablePush,
  onUpdatePreferences
}: NotificationSettingsCardProps) {
  const isGranted = permission === 'granted';
  const isDenied = permission === 'denied';

  const handleMasterToggle = async () => {
    if (preferences.pushEnabled && isGranted) {
      await onDisablePush();
    } else {
      await onEnablePush();
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-6">
      {/* Header */}
      <div className="border-b border-slate-100 pb-4">
        <h3 className="text-base font-bold text-slate-900">
          Owner Push Notifications & Alert Settings
        </h3>
        <p className="mt-1 text-xs text-slate-500">
          Configure real-time browser notifications for incoming orders and physical hardware
          errors.
        </p>
      </div>

      {/* Browser Permission Status Banner */}
      <div className="rounded-xl border border-slate-100 bg-slate-50 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <span className="text-lg">
              {!isSupported ? '⚠️' : isGranted ? '🟢' : isDenied ? '🔴' : '🟡'}
            </span>
            <div>
              <p className="text-xs font-bold text-slate-900">
                Browser Permission:{' '}
                <span className="capitalize">{!isSupported ? 'Unsupported' : permission}</span>
              </p>
              <p className="text-[11px] text-slate-500">
                {!isSupported
                  ? 'Your browser does not support the Web Push or Notification API.'
                  : isGranted
                    ? 'Push notifications are enabled and registered for this device.'
                    : isDenied
                      ? 'Notifications blocked by browser. Unblock in browser site settings.'
                      : 'Permission has not been requested yet.'}
              </p>
            </div>
          </div>

          {isSupported && !isGranted && (
            <button
              type="button"
              disabled={isLoading || isDenied}
              onClick={() => void onEnablePush()}
              className="rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
            >
              {isLoading ? 'Requesting...' : 'Request Permission'}
            </button>
          )}
        </div>
      </div>

      {/* Toggles */}
      <div className="space-y-4">
        {/* Master Push Toggle */}
        <div className="flex items-center justify-between py-2 border-b border-slate-100">
          <div>
            <h4 className="text-xs font-bold text-slate-900">Master Push Notifications</h4>
            <p className="text-xs text-slate-500">
              Receive background alerts on your laptop/desktop even when this tab is minimized.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={preferences.pushEnabled && isGranted}
            disabled={!isSupported || isLoading}
            onClick={() => void handleMasterToggle()}
            className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50 ${
              preferences.pushEnabled && isGranted ? 'bg-emerald-600' : 'bg-slate-200'
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                preferences.pushEnabled && isGranted ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        {/* Urgent Queue Alerts */}
        <div className="flex items-center justify-between py-2 border-b border-slate-100">
          <div>
            <h4 className="text-xs font-semibold text-slate-800">Urgent Priority Orders</h4>
            <p className="text-xs text-slate-500">
              Sound and banner alert immediately when an urgent-tier order is enqueued.
            </p>
          </div>
          <input
            type="checkbox"
            checked={preferences.urgentQueueAlerts}
            onChange={e => onUpdatePreferences({ urgentQueueAlerts: e.target.checked })}
            className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
          />
        </div>

        {/* Hardware Jam Alerts */}
        <div className="flex items-center justify-between py-2 border-b border-slate-100">
          <div>
            <h4 className="text-xs font-semibold text-slate-800">Printer Jams & Hardware Errors</h4>
            <p className="text-xs text-slate-500">
              Alert when printer reports paper jam, tray empty, or desktop agent disconnects.
            </p>
          </div>
          <input
            type="checkbox"
            checked={preferences.hardwareJamAlerts}
            onChange={e => onUpdatePreferences({ hardwareJamAlerts: e.target.checked })}
            className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
          />
        </div>

        {/* Daily Summary */}
        <div className="flex items-center justify-between py-2 border-b border-slate-100">
          <div>
            <h4 className="text-xs font-semibold text-slate-800">Daily Sales & Volume Summary</h4>
            <p className="text-xs text-slate-500">
              Receive a daily closing report with total sheets printed and gross revenue.
            </p>
          </div>
          <input
            type="checkbox"
            checked={preferences.dailySummaryReports}
            onChange={e => onUpdatePreferences({ dailySummaryReports: e.target.checked })}
            className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
          />
        </div>

        {/* Audio Alerts */}
        <div className="flex items-center justify-between py-2">
          <div>
            <h4 className="text-xs font-semibold text-slate-800">Sound Chimes</h4>
            <p className="text-xs text-slate-500">
              Play audible chime on new urgent incoming jobs and hardware error alerts.
            </p>
          </div>
          <input
            type="checkbox"
            checked={preferences.soundAlerts}
            onChange={e => onUpdatePreferences({ soundAlerts: e.target.checked })}
            className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
          />
        </div>
      </div>
    </div>
  );
}
