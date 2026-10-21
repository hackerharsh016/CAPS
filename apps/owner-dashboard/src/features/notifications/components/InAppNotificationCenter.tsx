'use client';

/**
 * InAppNotificationCenter Component.
 * Notification bell dropdown showing:
 * - Unread counter badge
 * - List of recent queue and printer alerts
 * - In-app fallback notifications when push is disabled or denied
 * - Mark as read / Clear all actions
 */

import React, { useState, useRef, useEffect } from 'react';
import type { InAppNotification } from '../types';

export interface InAppNotificationCenterProps {
  notifications: InAppNotification[];
  unreadCount: number;
  onMarkAsRead: (id: string) => void;
  onMarkAllAsRead: () => void;
  onClearAll: () => void;
}

export function InAppNotificationCenter({
  notifications,
  unreadCount,
  onMarkAsRead,
  onMarkAllAsRead,
  onClearAll
}: InAppNotificationCenterProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative inline-block text-left" ref={dropdownRef}>
      {/* Bell Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-haspopup="true"
        aria-label={`Notifications, ${unreadCount} unread`}
        className="relative rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"
      >
        <span className="text-lg" aria-hidden="true">
          🔔
        </span>
        {unreadCount > 0 && (
          <span
            className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white shadow-sm animate-pulse"
            aria-hidden="true"
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div
          className="absolute right-0 z-50 mt-2 w-80 sm:w-96 rounded-2xl border border-slate-200 bg-white shadow-2xl focus:outline-none overflow-hidden"
          role="menu"
          aria-orientation="vertical"
          aria-labelledby="notification-menu-heading"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/75 px-4 py-3">
            <div className="flex items-center space-x-2">
              <h3
                id="notification-menu-heading"
                className="text-xs font-bold text-slate-900 uppercase tracking-wider"
              >
                Notifications
              </h3>
              {unreadCount > 0 && (
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                  {unreadCount} new
                </span>
              )}
            </div>

            <div className="flex items-center space-x-2 text-[11px]">
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={onMarkAllAsRead}
                  className="font-medium text-emerald-600 hover:text-emerald-800"
                >
                  Mark all read
                </button>
              )}
              {notifications.length > 0 && (
                <button
                  type="button"
                  onClick={onClearAll}
                  className="font-medium text-slate-400 hover:text-slate-600"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* List Content */}
          <div className="max-h-80 overflow-y-auto divide-y divide-slate-100">
            {notifications.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-400">
                <span className="text-2xl block mb-1">📭</span>
                No notifications right now
              </div>
            ) : (
              notifications.map(n => (
                <div
                  key={n.id}
                  onClick={() => onMarkAsRead(n.id)}
                  className={`p-3.5 transition-colors cursor-pointer hover:bg-slate-50 text-xs ${
                    !n.read ? 'bg-emerald-50/30' : 'bg-white'
                  }`}
                  role="menuitem"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start space-x-2.5">
                      <span className="text-base leading-none">
                        {n.type === 'urgent_job_arrived'
                          ? '⚡'
                          : n.type === 'printer_jam_detected'
                            ? '⚠️'
                            : n.type === 'paper_out'
                              ? '📄'
                              : '🔔'}
                      </span>
                      <div>
                        <p
                          className={`font-semibold ${!n.read ? 'text-slate-900' : 'text-slate-700'}`}
                        >
                          {n.title}
                        </p>
                        <p className="mt-0.5 text-slate-500 leading-relaxed font-normal">
                          {n.body}
                        </p>
                        <span className="mt-1 block text-[10px] text-slate-400">
                          {new Date(n.timestamp).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </span>
                      </div>
                    </div>

                    {!n.read && (
                      <span className="h-2 w-2 rounded-full bg-emerald-600 shrink-0 mt-1" />
                    )}
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
