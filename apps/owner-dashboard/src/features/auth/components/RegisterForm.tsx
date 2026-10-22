'use client';

/**
 * Accessible Owner Self-Registration Form Component for CAPS Shop Owner Dashboard.
 * Collects owner account credentials and shop outlet configuration conforming strictly
 * to the database schema in `20261019000001_create_users_and_shops.sql`:
 * - `public.profiles`: name, phone, email, role ('shop_owner')
 * - `public.shops`: name, address, geo_lat, geo_lng, status, pricing_config,
 *   urgent_surcharge_config, auto_print_enabled, allow_pay_at_counter
 */

import React, { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '../auth-context';
import { isAuthPath } from '../route-guard-utils';
import { ShopService } from '../../shop-management/shop-service';
import type { CreateShopInput, PricingConfig, UrgentSurchargeConfig } from '../../shop-management/types';

export interface RegisterFormProps {
  redirectUrl?: string | undefined;
  onSuccess?: () => void;
}

interface FormFieldErrors {
  name?: string | undefined;
  email?: string | undefined;
  phone?: string | undefined;
  password?: string | undefined;
  confirmPassword?: string | undefined;
  shopName?: string | undefined;
  shopAddress?: string | undefined;
  geoLat?: string | undefined;
  geoLng?: string | undefined;
  a4BwSingle?: string | undefined;
  a4BwDouble?: string | undefined;
  a4ColorSingle?: string | undefined;
  spiralPrice?: string | undefined;
  urgentAmount?: string | undefined;
  terms?: string | undefined;
}

export function RegisterForm({ redirectUrl = '/', onSuccess }: RegisterFormProps) {
  const { signUp, isLoading: authLoading } = useAuth();
  const [shopService] = useState(() => new ShopService());

  // 1. Owner Account Fields (public.profiles & auth.users)
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // 2. Shop Information Fields (public.shops)
  const [shopName, setShopName] = useState('');
  const [shopAddress, setShopAddress] = useState('');
  const [geoLat, setGeoLat] = useState('12.9716'); // Default campus location (Bangalore)
  const [geoLng, setGeoLng] = useState('77.5946');
  const [isLocating, setIsLocating] = useState(false);

  // 3. Baseline Pricing & Operational Configuration (public.shops.pricing_config & urgent_surcharge_config)
  const [a4BwSingle, setA4BwSingle] = useState('1.50'); // INR
  const [a4BwDouble, setA4BwDouble] = useState('2.50'); // INR
  const [a4ColorSingle, setA4ColorSingle] = useState('10.00'); // INR
  const [spiralPrice, setSpiralPrice] = useState('35.00'); // INR
  const [urgentAmount, setUrgentAmount] = useState('20.00'); // INR
  const [allowPayAtCounter, setAllowPayAtCounter] = useState(true);
  const [autoPrintEnabled, setAutoPrintEnabled] = useState(false);

  // 4. Terms agreement & Status
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FormFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [registrationSuccess, setRegistrationSuccess] = useState(false);

  // Detect current location via browser Geolocation API
  const handleDetectLocation = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setFieldErrors(prev => ({
        ...prev,
        geoLat: 'Geolocation is not supported by your browser.'
      }));
      return;
    }

    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      pos => {
        setGeoLat(pos.coords.latitude.toFixed(6));
        setGeoLng(pos.coords.longitude.toFixed(6));
        setIsLocating(false);
        setFieldErrors(prev => {
          const updated = { ...prev };
          delete updated.geoLat;
          delete updated.geoLng;
          return updated;
        });
      },
      err => {
        setIsLocating(false);
        setFieldErrors(prev => ({
          ...prev,
          geoLat: `Unable to detect coordinates: ${err.message}`
        }));
      },
      { timeout: 10000, enableHighAccuracy: true }
    );
  };

  // Comprehensive Schema Validation
  const validate = (): boolean => {
    const errors: FormFieldErrors = {};

    // 1. Owner validation (public.profiles)
    if (!name.trim()) {
      errors.name = 'Full name is required.';
    } else if (name.trim().length < 2) {
      errors.name = 'Full name must be at least 2 characters.';
    }

    if (!email.trim()) {
      errors.email = 'Email address is required.';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      errors.email = 'Please enter a valid email address.';
    }

    const cleanPhone = phone.trim().replace(/[\s-]/g, '');
    if (!cleanPhone) {
      errors.phone = 'Mobile phone number is required.';
    } else if (cleanPhone.length < 5) {
      errors.phone = 'Phone number must be at least 5 digits.';
    }

    if (!password) {
      errors.password = 'Password is required.';
    } else if (password.length < 6) {
      errors.password = 'Password must be at least 6 characters.';
    }

    if (!confirmPassword) {
      errors.confirmPassword = 'Confirmation password is required.';
    } else if (password !== confirmPassword) {
      errors.confirmPassword = 'Passwords do not match.';
    }

    // 2. Shop profile validation (public.shops constraints)
    const trimmedShopName = shopName.trim();
    if (!trimmedShopName) {
      errors.shopName = 'Shop name is required.';
    } else if (trimmedShopName.length < 2) {
      errors.shopName = 'Shop name must be at least 2 characters.';
    } else if (trimmedShopName.length > 100) {
      errors.shopName = 'Shop name cannot exceed 100 characters.';
    }

    const trimmedAddress = shopAddress.trim();
    if (!trimmedAddress) {
      errors.shopAddress = 'Physical address is required.';
    } else if (trimmedAddress.length < 5) {
      errors.shopAddress = 'Address must be at least 5 characters.';
    }

    const latNum = parseFloat(geoLat);
    if (isNaN(latNum) || latNum < -90.0 || latNum > 90.0) {
      errors.geoLat = 'Latitude must be a valid number between -90 and 90.';
    }

    const lngNum = parseFloat(geoLng);
    if (isNaN(lngNum) || lngNum < -180.0 || lngNum > 180.0) {
      errors.geoLng = 'Longitude must be a valid number between -180 and 180.';
    }

    // 3. Pricing validation
    const bwSingle = parseFloat(a4BwSingle);
    const bwDouble = parseFloat(a4BwDouble);
    const colSingle = parseFloat(a4ColorSingle);
    const spiral = parseFloat(spiralPrice);
    const urgent = parseFloat(urgentAmount);

    if (isNaN(bwSingle) || bwSingle < 0) {
      errors.a4BwSingle = 'Valid B&W rate required.';
    }
    if (isNaN(bwDouble) || bwDouble < 0) {
      errors.a4BwDouble = 'Valid duplex rate required.';
    } else if (bwDouble < bwSingle) {
      errors.a4BwDouble = 'Double-sided rate cannot be less than single-sided.';
    }
    if (isNaN(colSingle) || colSingle < 0) {
      errors.a4ColorSingle = 'Valid color rate required.';
    }
    if (isNaN(spiral) || spiral < 0) {
      errors.spiralPrice = 'Valid spiral binding fee required.';
    }
    if (isNaN(urgent) || urgent < 0) {
      errors.urgentAmount = 'Valid urgent surcharge required.';
    }

    // 4. Terms
    if (!agreeTerms) {
      errors.terms = 'You must agree to the Merchant Terms of Service.';
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!validate()) {
      return;
    }

    setIsSubmitting(true);

    try {
      // 1. Sign up shop owner account via Supabase Auth
      const authResult = await signUp({
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim(),
        password,
        role: 'shop_owner'
      });

      const ownerId = authResult.user.id || authResult.profile.id;
      const accessToken = authResult.session?.access_token;

      // 2. Assemble pricing_config matching Database JSONB Schema
      const bwSinglePaise = Math.round(parseFloat(a4BwSingle) * 100);
      const bwDoublePaise = Math.round(parseFloat(a4BwDouble) * 100);
      const colorSinglePaise = Math.round(parseFloat(a4ColorSingle) * 100);
      const spiralPaise = Math.round(parseFloat(spiralPrice) * 100);
      const urgentPaise = Math.round(parseFloat(urgentAmount) * 100);

      const pricingConfig: PricingConfig = {
        A4: {
          bw_single_paise: bwSinglePaise,
          bw_double_paise: bwDoublePaise,
          color_single_paise: colorSinglePaise,
          color_double_paise: Math.round(colorSinglePaise * 1.8)
        },
        A3: {
          bw_single_paise: Math.round(bwSinglePaise * 2),
          bw_double_paise: Math.round(bwDoublePaise * 2),
          color_single_paise: Math.round(colorSinglePaise * 2),
          color_double_paise: Math.round(colorSinglePaise * 3.5)
        },
        Legal: {
          bw_single_paise: Math.round(bwSinglePaise * 1.25),
          bw_double_paise: Math.round(bwDoublePaise * 1.25),
          color_single_paise: Math.round(colorSinglePaise * 1.2),
          color_double_paise: Math.round(colorSinglePaise * 2)
        },
        binding_prices_paise: {
          none: 0,
          spiral: spiralPaise,
          staple: 500,
          lamination: 2000
        },
        gst_percentage: 18
      };

      const urgentConfig: UrgentSurchargeConfig = {
        type: 'flat',
        amount: urgentPaise,
        max_urgent_jobs_per_hour: 5
      };

      const shopInput: CreateShopInput = {
        name: shopName.trim(),
        address: shopAddress.trim(),
        geo_lat: parseFloat(geoLat),
        geo_lng: parseFloat(geoLng),
        status: 'open',
        pricing_config: pricingConfig,
        urgent_surcharge_config: urgentConfig,
        auto_print_enabled: autoPrintEnabled,
        allow_pay_at_counter: allowPayAtCounter
      };

      // 3. Create shop record in public.shops
      await shopService.createShop(shopInput, ownerId, accessToken);

      setRegistrationSuccess(true);

      if (onSuccess) {
        onSuccess();
      } else if (typeof window !== 'undefined') {
        const dest =
          redirectUrl && redirectUrl.startsWith('/') && !isAuthPath(redirectUrl)
            ? redirectUrl
            : '/';
        setTimeout(() => {
          window.location.href = dest;
        }, 1200);
      }
    } catch (err: unknown) {
      const errorObj = err as { code?: string; message?: string };
      setFormError(errorObj.message || 'Registration failed. Please check your details and try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const fillDemoOwnerDetails = () => {
    setName('Rajesh Sharma');
    setEmail(`owner-${Date.now().toString().slice(-4)}@campusprint.com`);
    setPhone('+91 98765 43210');
    setPassword('OwnerPass123!');
    setConfirmPassword('OwnerPass123!');
    setShopName('Campus Central Xerox & Quick Print');
    setShopAddress('Shop 12, Ground Floor, Academic Block B, North Campus');
    setGeoLat('12.9716');
    setGeoLng('77.5946');
    setA4BwSingle('1.50');
    setA4BwDouble('2.50');
    setA4ColorSingle('10.00');
    setSpiralPrice('35.00');
    setUrgentAmount('20.00');
    setAllowPayAtCounter(true);
    setAutoPrintEnabled(false);
    setAgreeTerms(true);
    setFieldErrors({});
    setFormError(null);
  };

  if (registrationSuccess) {
    return (
      <div className="w-full max-w-xl rounded-2xl border border-emerald-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-100 text-3xl text-emerald-700">
          ✓
        </div>
        <h2 className="mt-4 text-2xl font-bold text-slate-900">Registration Complete!</h2>
        <p className="mt-2 text-sm text-slate-600">
          Your shop <strong>{shopName}</strong> has been registered successfully. Setting up your live
          queue dashboard...
        </p>
        <div className="mt-6 flex justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" />
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 sm:p-10 shadow-sm">
      <div className="mb-8 text-center">
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
          Register Your Print Shop
        </h1>
        <p className="mt-1.5 text-xs sm:text-sm text-slate-500">
          Join the CAPS print network. Set up your shop profile, geolocation, and base rates.
        </p>
      </div>

      {formError && (
        <div
          role="alert"
          aria-live="assertive"
          className="mb-6 rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs font-medium text-rose-800"
        >
          <div className="flex items-center space-x-2">
            <span className="text-sm font-bold">⚠️</span>
            <span>{formError}</span>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate className="space-y-8">
        {/* ========================================================================= */}
        {/* SECTION 1: Owner Profile & Auth (public.profiles & auth.users)           */}
        {/* ========================================================================= */}
        <div className="space-y-4">
          <div className="border-b border-slate-100 pb-2">
            <h2 className="text-sm font-bold uppercase tracking-wider text-emerald-700">
              1. Owner Account Details
            </h2>
            <p className="text-xs text-slate-500">
              Identity profile associated with your shop owner credentials (public.profiles)
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* Full Name */}
            <div>
              <label htmlFor="owner-name" className="block text-xs font-semibold text-slate-700 mb-1">
                Full Name <span className="text-rose-500">*</span>
              </label>
              <input
                id="owner-name"
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. Ramesh Gupta"
                aria-invalid={!!fieldErrors.name}
                aria-describedby={fieldErrors.name ? 'owner-name-error' : undefined}
                className={`w-full rounded-lg border px-3.5 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 ${
                  fieldErrors.name
                    ? 'border-rose-400 focus:ring-rose-200'
                    : 'border-slate-300 focus:border-emerald-500 focus:ring-emerald-200'
                }`}
              />
              {fieldErrors.name && (
                <p id="owner-name-error" role="alert" className="mt-1 text-xs text-rose-600">
                  {fieldErrors.name}
                </p>
              )}
            </div>

            {/* Mobile Phone */}
            <div>
              <label htmlFor="owner-phone" className="block text-xs font-semibold text-slate-700 mb-1">
                Mobile Number <span className="text-rose-500">*</span>
              </label>
              <input
                id="owner-phone"
                type="tel"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder="+91 98765 43210"
                aria-invalid={!!fieldErrors.phone}
                aria-describedby={fieldErrors.phone ? 'owner-phone-error' : undefined}
                className={`w-full rounded-lg border px-3.5 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 ${
                  fieldErrors.phone
                    ? 'border-rose-400 focus:ring-rose-200'
                    : 'border-slate-300 focus:border-emerald-500 focus:ring-emerald-200'
                }`}
              />
              {fieldErrors.phone && (
                <p id="owner-phone-error" role="alert" className="mt-1 text-xs text-rose-600">
                  {fieldErrors.phone}
                </p>
              )}
            </div>
          </div>

          {/* Email Address */}
          <div>
            <label htmlFor="owner-email" className="block text-xs font-semibold text-slate-700 mb-1">
              Email Address <span className="text-rose-500">*</span>
            </label>
            <input
              id="owner-email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="owner@yourprintshop.com"
              aria-invalid={!!fieldErrors.email}
              aria-describedby={fieldErrors.email ? 'owner-email-error' : undefined}
              className={`w-full rounded-lg border px-3.5 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 ${
                fieldErrors.email
                  ? 'border-rose-400 focus:ring-rose-200'
                  : 'border-slate-300 focus:border-emerald-500 focus:ring-emerald-200'
              }`}
            />
            {fieldErrors.email && (
              <p id="owner-email-error" role="alert" className="mt-1 text-xs text-rose-600">
                {fieldErrors.email}
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* Password */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label htmlFor="owner-pass" className="text-xs font-semibold text-slate-700">
                  Password <span className="text-rose-500">*</span>
                </label>
                <button
                  type="button"
                  onClick={() => setShowPassword(p => !p)}
                  className="text-xs text-slate-500 hover:text-emerald-600"
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
              <input
                id="owner-pass"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="At least 6 characters"
                aria-invalid={!!fieldErrors.password}
                aria-describedby={fieldErrors.password ? 'owner-pass-error' : undefined}
                className={`w-full rounded-lg border px-3.5 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 ${
                  fieldErrors.password
                    ? 'border-rose-400 focus:ring-rose-200'
                    : 'border-slate-300 focus:border-emerald-500 focus:ring-emerald-200'
                }`}
              />
              {fieldErrors.password && (
                <p id="owner-pass-error" role="alert" className="mt-1 text-xs text-rose-600">
                  {fieldErrors.password}
                </p>
              )}
            </div>

            {/* Confirm Password */}
            <div>
              <label htmlFor="owner-confirm-pass" className="block text-xs font-semibold text-slate-700 mb-1">
                Confirm Password <span className="text-rose-500">*</span>
              </label>
              <input
                id="owner-confirm-pass"
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                placeholder="Repeat password"
                aria-invalid={!!fieldErrors.confirmPassword}
                aria-describedby={fieldErrors.confirmPassword ? 'owner-confirm-error' : undefined}
                className={`w-full rounded-lg border px-3.5 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 ${
                  fieldErrors.confirmPassword
                    ? 'border-rose-400 focus:ring-rose-200'
                    : 'border-slate-300 focus:border-emerald-500 focus:ring-emerald-200'
                }`}
              />
              {fieldErrors.confirmPassword && (
                <p id="owner-confirm-error" role="alert" className="mt-1 text-xs text-rose-600">
                  {fieldErrors.confirmPassword}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* SECTION 2: Shop Outlet & Geolocation (public.shops)                      */}
        {/* ========================================================================= */}
        <div className="space-y-4">
          <div className="border-b border-slate-100 pb-2">
            <h2 className="text-sm font-bold uppercase tracking-wider text-emerald-700">
              2. Print Shop Location & Identity
            </h2>
            <p className="text-xs text-slate-500">
              Physical store location used for student shop discovery (public.shops)
            </p>
          </div>

          {/* Shop Name */}
          <div>
            <label htmlFor="shop-name" className="block text-xs font-semibold text-slate-700 mb-1">
              Shop Name <span className="text-rose-500">*</span>
            </label>
            <input
              id="shop-name"
              type="text"
              value={shopName}
              onChange={e => setShopName(e.target.value)}
              placeholder="e.g. Metro Quick Prints & Stationery"
              aria-invalid={!!fieldErrors.shopName}
              aria-describedby={fieldErrors.shopName ? 'shop-name-error' : undefined}
              className={`w-full rounded-lg border px-3.5 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 ${
                fieldErrors.shopName
                  ? 'border-rose-400 focus:ring-rose-200'
                  : 'border-slate-300 focus:border-emerald-500 focus:ring-emerald-200'
              }`}
            />
            {fieldErrors.shopName && (
              <p id="shop-name-error" role="alert" className="mt-1 text-xs text-rose-600">
                {fieldErrors.shopName}
              </p>
            )}
          </div>

          {/* Physical Address */}
          <div>
            <label htmlFor="shop-address" className="block text-xs font-semibold text-slate-700 mb-1">
              Store Physical Address <span className="text-rose-500">*</span>
            </label>
            <textarea
              id="shop-address"
              rows={2}
              value={shopAddress}
              onChange={e => setShopAddress(e.target.value)}
              placeholder="Shop number, building name, campus landmark or street"
              aria-invalid={!!fieldErrors.shopAddress}
              aria-describedby={fieldErrors.shopAddress ? 'shop-address-error' : undefined}
              className={`w-full rounded-lg border px-3.5 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 ${
                fieldErrors.shopAddress
                  ? 'border-rose-400 focus:ring-rose-200'
                  : 'border-slate-300 focus:border-emerald-500 focus:ring-emerald-200'
              }`}
            />
            {fieldErrors.shopAddress && (
              <p id="shop-address-error" role="alert" className="mt-1 text-xs text-rose-600">
                {fieldErrors.shopAddress}
              </p>
            )}
          </div>

          {/* Geolocation Coordinates */}
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
              <label className="text-xs font-semibold text-slate-700">
                GPS Coordinates (Latitude, Longitude) <span className="text-rose-500">*</span>
              </label>
              <button
                type="button"
                onClick={handleDetectLocation}
                disabled={isLocating}
                className="inline-flex items-center text-xs font-semibold text-emerald-600 hover:text-emerald-700 underline hover:no-underline disabled:opacity-50"
              >
                {isLocating ? 'Detecting GPS...' : '📍 Detect My Current Location'}
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <input
                  id="geo-lat"
                  type="number"
                  step="0.000001"
                  value={geoLat}
                  onChange={e => setGeoLat(e.target.value)}
                  placeholder="Latitude (-90 to 90)"
                  aria-label="Latitude"
                  aria-invalid={!!fieldErrors.geoLat}
                  className={`w-full rounded-lg border px-3.5 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 ${
                    fieldErrors.geoLat
                      ? 'border-rose-400 focus:ring-rose-200'
                      : 'border-slate-300 focus:border-emerald-500 focus:ring-emerald-200'
                  }`}
                />
                {fieldErrors.geoLat && (
                  <p role="alert" className="mt-1 text-xs text-rose-600">
                    {fieldErrors.geoLat}
                  </p>
                )}
              </div>

              <div>
                <input
                  id="geo-lng"
                  type="number"
                  step="0.000001"
                  value={geoLng}
                  onChange={e => setGeoLng(e.target.value)}
                  placeholder="Longitude (-180 to 180)"
                  aria-label="Longitude"
                  aria-invalid={!!fieldErrors.geoLng}
                  className={`w-full rounded-lg border px-3.5 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 ${
                    fieldErrors.geoLng
                      ? 'border-rose-400 focus:ring-rose-200'
                      : 'border-slate-300 focus:border-emerald-500 focus:ring-emerald-200'
                  }`}
                />
                {fieldErrors.geoLng && (
                  <p role="alert" className="mt-1 text-xs text-rose-600">
                    {fieldErrors.geoLng}
                  </p>
                )}
              </div>
            </div>
            <p className="mt-1 text-[11px] text-slate-400">
              Students nearby sort shops by walking distance using these coordinates.
            </p>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* SECTION 3: Initial Base Rates & Policies (pricing_config)                 */}
        {/* ========================================================================= */}
        <div className="space-y-4">
          <div className="border-b border-slate-100 pb-2">
            <h2 className="text-sm font-bold uppercase tracking-wider text-emerald-700">
              3. Baseline Pricing & Operations
            </h2>
            <p className="text-xs text-slate-500">
              Initial per-page rates and payment options (can be fine-tuned later in Pricing Settings)
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {/* A4 B&W Single */}
            <div>
              <label htmlFor="rate-a4-bw-single" className="block text-xs font-semibold text-slate-700 mb-1">
                A4 B&W (₹/page)
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-xs text-slate-400 font-semibold">
                  ₹
                </span>
                <input
                  id="rate-a4-bw-single"
                  type="number"
                  step="0.25"
                  min="0"
                  value={a4BwSingle}
                  onChange={e => setA4BwSingle(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 pl-7 pr-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                />
              </div>
            </div>

            {/* A4 B&W Duplex */}
            <div>
              <label htmlFor="rate-a4-bw-double" className="block text-xs font-semibold text-slate-700 mb-1">
                A4 Duplex (₹/sheet)
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-xs text-slate-400 font-semibold">
                  ₹
                </span>
                <input
                  id="rate-a4-bw-double"
                  type="number"
                  step="0.25"
                  min="0"
                  value={a4BwDouble}
                  onChange={e => setA4BwDouble(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 pl-7 pr-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                />
              </div>
            </div>

            {/* A4 Color Single */}
            <div>
              <label htmlFor="rate-a4-color-single" className="block text-xs font-semibold text-slate-700 mb-1">
                A4 Color (₹/page)
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-xs text-slate-400 font-semibold">
                  ₹
                </span>
                <input
                  id="rate-a4-color-single"
                  type="number"
                  step="0.50"
                  min="0"
                  value={a4ColorSingle}
                  onChange={e => setA4ColorSingle(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 pl-7 pr-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                />
              </div>
            </div>

            {/* Spiral Binding */}
            <div>
              <label htmlFor="rate-spiral" className="block text-xs font-semibold text-slate-700 mb-1">
                Spiral Binding (₹)
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-xs text-slate-400 font-semibold">
                  ₹
                </span>
                <input
                  id="rate-spiral"
                  type="number"
                  step="1"
                  min="0"
                  value={spiralPrice}
                  onChange={e => setSpiralPrice(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 pl-7 pr-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                />
              </div>
            </div>

            {/* Urgent Surcharge */}
            <div className="col-span-2 sm:col-span-1">
              <label htmlFor="rate-urgent" className="block text-xs font-semibold text-slate-700 mb-1">
                Urgent Surcharge (₹)
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-xs text-slate-400 font-semibold">
                  ₹
                </span>
                <input
                  id="rate-urgent"
                  type="number"
                  step="1"
                  min="0"
                  value={urgentAmount}
                  onChange={e => setUrgentAmount(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 pl-7 pr-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                />
              </div>
            </div>
          </div>

          {/* Policy Toggles */}
          <div className="space-y-3 pt-2">
            <label className="flex items-start space-x-3 cursor-pointer">
              <input
                type="checkbox"
                checked={allowPayAtCounter}
                onChange={e => setAllowPayAtCounter(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
              />
              <span className="text-xs text-slate-700">
                <strong>Allow Pay-at-Counter:</strong> Enable cash or physical UPI payment when
                customers pick up their documents (with owner approval guard).
              </span>
            </label>

            <label className="flex items-start space-x-3 cursor-pointer">
              <input
                type="checkbox"
                checked={autoPrintEnabled}
                onChange={e => setAutoPrintEnabled(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
              />
              <span className="text-xs text-slate-700">
                <strong>Enable Auto-Print Spooling:</strong> Automatically release print jobs to
                connected print agents immediately upon successful online payment confirmation.
              </span>
            </label>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* SECTION 4: Terms & Submission                                            */}
        {/* ========================================================================= */}
        <div className="border-t border-slate-100 pt-5 space-y-4">
          <label className="flex items-start space-x-3 cursor-pointer">
            <input
              type="checkbox"
              checked={agreeTerms}
              onChange={e => setAgreeTerms(e.target.checked)}
              aria-invalid={!!fieldErrors.terms}
              aria-describedby={fieldErrors.terms ? 'terms-error' : undefined}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
            />
            <span className="text-xs text-slate-600">
              I agree to the <strong>CAPS Merchant Terms of Service</strong>, automated 24-hour privacy
              cleanup policies, and platform fulfillment standards.
            </span>
          </label>
          {fieldErrors.terms && (
            <p id="terms-error" role="alert" className="text-xs text-rose-600">
              {fieldErrors.terms}
            </p>
          )}

          <button
            type="submit"
            disabled={isSubmitting || authLoading}
            className="flex w-full items-center justify-center rounded-xl bg-emerald-600 px-5 py-3 text-sm font-bold text-white shadow-sm hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
          >
            {isSubmitting ? (
              <div className="flex items-center space-x-2">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                <span>Registering shop & configuring pricing...</span>
              </div>
            ) : (
              'Complete Registration & Open Dashboard →'
            )}
          </button>

          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2 text-xs text-slate-500">
            <button
              type="button"
              onClick={fillDemoOwnerDetails}
              className="text-slate-500 hover:text-emerald-700 underline hover:no-underline"
            >
              Fill Demo Shop Owner Details
            </button>
            <div className="flex items-center space-x-1">
              <span>Already registered?</span>
              <Link href="/login" className="font-semibold text-emerald-600 hover:underline">
                Sign In to Dashboard
              </Link>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
