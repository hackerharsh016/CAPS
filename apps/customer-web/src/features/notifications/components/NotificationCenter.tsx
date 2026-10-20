'use client';

/**
 * Accessible In-App Notification Center for CAPS Customer Web.
 * Conforms to CAPS SRS Section 4.5.
 * Displays recent order status notifications, pickup readiness alerts,
 * and push permission toggle controls.
 */

import React, { useState } from 'react';
import { usePushNotifications } from '../use-push-notifications';
import type { NotificationType } from '../types';

export function NotificationCenter() {
  const [isOpen, setIsOpen] = useState(false);
  const {
    permission,
    isSubscribed,
    isLoading,
    notifications,
    unreadCount,
    requestPermissionAndSubscribe,
    unsubscribe,
    markAsRead,
    clearAll
  } = usePushNotifications();

  const getNotificationIcon = (type: NotificationType) => {
    switch (type) {
      case 'order_confirmed':
        return '📑';
      case 'agent_printing':
        return '🖨️';
      case 'order_ready_for_pickup':
        return '🎉';
      case 'print_failed':
        return '⚠️';
      case 'system':
      default:
        return '🔔';
    }
  };

  return (
    <div className="relative inline-block text-left">
      {/* Bell Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-label={`Notifications, ${unreadCount} unread`}
        className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-colors shadow-sm"
      >
        <span className="text-lg">🔔</span>
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-[10px] font-bold text-white ring-2 ring-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown Panel */}
      {isOpen && (
        <div
          role="dialog"
          aria-label="Notification center panel"
          className="absolute right-0 mt-2 w-80 sm:w-96 rounded-2xl border border-slate-200 bg-white p-4 shadow-xl z-50 space-y-4"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="text-sm font-bold text-slate-900">Notifications</h3>
            {notifications.length > 0 && (
              <button
                type="button"
                onClick={clearAll}
                className="text-xs font-semibold text-slate-500 hover:text-red-600 transition-colors"
              >
                Clear all
              </button>
            )}
          </div>

          {/* Push Permission Toggle Row */}
          <div className="flex items-center justify-between rounded-xl bg-slate-50 p-3 border border-slate-100 text-xs">
            <div>
              <p className="font-bold text-slate-900">Browser Push Alerts</p>
              <p className="text-[11px] text-slate-500">
                {isSubscribed
                  ? 'Subscribed to live device alerts'
                  : permission === 'denied'
                  ? 'Permission blocked by browser'
                  : 'Receive background pickup alerts'}
              </p>
            </div>

            <button
              type="button"
              disabled={isLoading || permission === 'denied'}
              onClick={isSubscribed ? unsubscribe : requestPermissionAndSubscribe}
              className={`rounded-lg px-3 py-1.5 font-bold transition-colors ${
                isSubscribed
                  ? 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                  : 'bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40'
              }`}
            >
              {isLoading ? '...' : isSubscribed ? 'Turn Off' : 'Turn On'}
            </button>
          </div>

          {/* Notifications List */}
          <div className="max-h-72 overflow-y-auto space-y-2 divide-y divide-slate-100">
            {notifications.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500">
                <span className="text-2xl block mb-2">📭</span>
                No notifications yet. You will see live order updates here.
              </div>
            ) : (
              notifications.map((n) => (
                <div
                  key={n.id}
                  onClick={() => markAsRead(n.id)}
                  className={`pt-2.5 first:pt-0 cursor-pointer rounded-lg p-2 transition-colors ${
                    n.read ? 'opacity-70 hover:bg-slate-50' : 'bg-blue-50/50 hover:bg-blue-50'
                  }`}
                >
                  <div className="flex items-start space-x-2.5">
                    <span className="text-lg">{getNotificationIcon(n.type)}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-bold text-slate-900 truncate">{n.title}</p>
                        {!n.read && (
                          <span className="h-2 w-2 rounded-full bg-blue-600 ml-2 shrink-0" />
                        )}
                      </div>
                      <p className="text-xs text-slate-600 mt-0.5 line-clamp-2">{n.body}</p>
                      <span className="text-[10px] text-slate-400 mt-1 block">
                        {new Date(n.timestamp).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
