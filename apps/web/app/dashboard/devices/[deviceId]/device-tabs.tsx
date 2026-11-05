"use client";

import { useState } from "react";

export type DeviceTab = "device" | "services" | "transactions";

const TABS: { id: DeviceTab; label: string }[] = [
  { id: "device", label: "Device" },
  { id: "services", label: "Services" },
  { id: "transactions", label: "Transactions" },
];

export function DeviceTabs({
  device,
  services,
  transactions,
  counts,
}: {
  device: React.ReactNode;
  services: React.ReactNode;
  transactions: React.ReactNode;
  counts: { services: number; transactions: number };
}) {
  const [active, setActive] = useState<DeviceTab>("device");

  const badge: Record<DeviceTab, number | null> = {
    device: null,
    services: counts.services,
    transactions: counts.transactions,
  };

  return (
    <div>
      {/* Tab bar */}
      <div
        role="tablist"
        aria-label="Device sections"
        className="flex items-stretch gap-1 border-b border-[var(--border)]"
      >
        {TABS.map((t) => {
          const isActive = active === t.id;
          return (
            <button
              key={t.id}
              role="tab"
              type="button"
              aria-selected={isActive}
              onClick={() => setActive(t.id)}
              className={`relative -mb-px flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors focus-visible:outline-none ${
                isActive
                  ? "border-[var(--base-blue)] text-[var(--base-blue)]"
                  : "border-transparent text-[var(--muted)] hover:text-[var(--foreground)]"
              }`}
            >
              <span>{t.label}</span>
              {badge[t.id] !== null && (
                <span
                  className={`inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${
                    isActive
                      ? "bg-[var(--base-blue-soft)] text-[var(--base-blue)]"
                      : "bg-[var(--surface-2)] text-[var(--muted)]"
                  }`}
                >
                  {badge[t.id]}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Panels */}
      <div className="pt-8">
        <div role="tabpanel" hidden={active !== "device"}>
          {active === "device" && device}
        </div>
        <div role="tabpanel" hidden={active !== "services"}>
          {active === "services" && services}
        </div>
        <div role="tabpanel" hidden={active !== "transactions"}>
          {active === "transactions" && transactions}
        </div>
      </div>
    </div>
  );
}
