"use client";

import { Card } from "@/components/ui";
import { CopyButton } from "@/components/copy-button";
import { ApiKeyPanel } from "./api-key-panel";

export type DeviceOverviewData = {
  id: string;
  connectorId: string;
  apiKeyPreview: string;
  createdAt: string;
};

function MetaRow({
  label,
  value,
  copy,
  mono = false,
}: {
  label: string;
  value: string;
  copy?: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-3.5">
      <span className="text-[13px] font-medium text-[var(--muted)]">{label}</span>
      <div className="flex min-w-0 items-center gap-2">
        <span
          className={`truncate text-sm text-[var(--foreground)] ${
            mono ? "font-mono" : ""
          }`}
        >
          {value}
        </span>
        {copy && <CopyButton value={copy} label="Copy" className="py-1" />}
      </div>
    </div>
  );
}

export function DeviceOverview({ device }: { device: DeviceOverviewData }) {
  return (
    <div className="space-y-8">
      {/* Device details */}
      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-[var(--foreground)]">
            Device details
          </h3>
          <p className="mt-1 text-[13px] text-[var(--muted)]">
            Identifiers and metadata for this device.
          </p>
        </div>
        <Card className="divide-y divide-[var(--border)]">
          <MetaRow label="Device ID" value={device.id} copy={device.id} mono />
          <MetaRow
            label="Created"
            value={new Date(device.createdAt).toLocaleString(undefined, {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          />
        </Card>
        <p className="px-1 text-[12px] text-[var(--muted)]">
          The <span className="font-medium">Device ID</span> is public — share it
          with agents so they can discover and call this device.
        </p>
      </section>

      {/* Connector ID — PRIVATE */}
      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-[var(--foreground)]">
            Connector ID
          </h3>
          <p className="mt-1 text-[13px] text-[var(--muted)]">
            The private identity your device (ESP32 / IoT) uses to connect over
            MQTT. Flash it into your firmware.
          </p>
        </div>
        <Card className="divide-y divide-[var(--border)]">
          <MetaRow
            label="Connector ID"
            value={device.connectorId}
            copy={device.connectorId}
            mono
          />
        </Card>
        <p className="px-1 text-[12px] font-medium text-amber-500">
          ⚠️ Keep this secret. Never share your Connector ID with agents or paste
          it anywhere public — it is the private transport identity for your
          device.
        </p>
      </section>

      {/* API key */}
      <section className="space-y-4">
        <ApiKeyPanel
          deviceId={device.id}
          apiKeyPreview={device.apiKeyPreview}
        />
      </section>
    </div>
  );
}
