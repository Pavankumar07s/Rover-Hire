import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@0xBs/db";
import { getSessionUserId } from "@/lib/auth";
import { ServicesManager, type ServiceItem } from "./services-manager";
import { DeleteDevice } from "./delete-device";
import { EditDevice } from "./edit-device";
import { DeviceTabs } from "./device-tabs";
import { DeviceOverview } from "./device-overview";
import {
  TransactionsPanel,
  type TransactionItem,
} from "./transactions-panel";

type Props = { params: Promise<{ deviceId: string }> };

export default async function DevicePage({ params }: Props) {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");

  const { deviceId } = await params;

  const device = await prisma.device.findFirst({
    where: { id: deviceId, userId },
    select: {
      id: true,
      connectorId: true,
      title: true,
      description: true,
      apiKeyPreview: true,
      createdAt: true,
      services: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          title: true,
          description: true,
          parameters: true,
          recipientWallet: true,
          walletChain: true,
          serviceType: true,
          passwordProtected: true,
          globallyDiscoverable: true,
          accessUsername: true,
          createdAt: true,
        },
      },
      payments: {
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          id: true,
          transaction: true,
          amount: true,
          network: true,
          payer: true,
          createdAt: true,
        },
      },
    },
  });

  if (!device) notFound();

  const services: ServiceItem[] = device.services.map((s) => ({
    id: s.id,
    title: s.title,
    description: s.description,
    parameters: (s.parameters as ServiceItem["parameters"]) ?? null,
    recipientWallet: s.recipientWallet,
    walletChain: s.walletChain,
    serviceType: s.serviceType,
    passwordProtected: s.passwordProtected,
    globallyDiscoverable: s.globallyDiscoverable,
    accessUsername: s.accessUsername,
    createdAt: s.createdAt.toISOString(),
  }));

  const transactions: TransactionItem[] = device.payments.map((p) => ({
    id: p.id,
    hash: p.transaction,
    amount: (Number(p.amount) / 1_000_000).toString(),
    token: "USDC",
    status: "confirmed",
    from: p.payer,
    createdAt: p.createdAt.toISOString(),
  }));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[var(--muted)] transition-colors hover:text-[var(--foreground)]"
        >
          <span aria-hidden>←</span> Back to devices
        </Link>
        <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold tracking-tight text-[var(--foreground)]">
              {device.title ?? "Untitled device"}
            </h1>
            <p className="mt-1 max-w-xl text-sm text-[var(--muted)]">
              {device.description ?? "No description"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <EditDevice
              deviceId={device.id}
              initial={{
                title: device.title ?? "",
                description: device.description ?? "",
              }}
            />
            <DeleteDevice deviceId={device.id} />
          </div>
        </div>
      </div>

      {/* Tabbed sections */}
      <DeviceTabs
        counts={{
          services: services.length,
          transactions: transactions.length,
        }}
        device={
          <DeviceOverview
            device={{
              id: device.id,
              connectorId: device.connectorId,
              apiKeyPreview: device.apiKeyPreview,
              createdAt: device.createdAt.toISOString(),
            }}
          />
        }
        services={
          <ServicesManager deviceId={device.id} services={services} />
        }
        transactions={<TransactionsPanel transactions={transactions} />}
      />
    </div>
  );
}
