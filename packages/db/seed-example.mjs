// One-off seed: creates the CHANGE_ME user (if missing), an example device, and
// a few FREE services with argument schemas. Prints the public deviceId +
// serviceIds so they can be used with skills.md.
//
// Run from packages/db:  node seed-example.mjs
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "./dist/index.js";

const sha256 = (v) => createHash("sha256").update(v, "utf8").digest("hex");
const genApiKey = () => `bs_${randomBytes(20).toString("hex")}`;
const previewApiKey = (k) => `${k.slice(0, 9)}…${k.slice(-4)}`;

const EMAIL = "CHANGE_ME";
const PASS = "CHANGE_ME";

async function main() {
  // 1) User — upsert by unique email.
  const user = await prisma.user.upsert({
    where: { email: EMAIL },
    update: {},
    create: {
      email: EMAIL,
      name: "AB5",
      passwordHash: sha256(PASS),
    },
    select: { id: true, email: true },
  });
  console.log("user:", user.id, user.email);

  // 2) Device — mint an API key (shown once).
  const rawKey = genApiKey();
  const device = await prisma.device.create({
    data: {
      title: "Example Sensor Hub",
      description:
        "A demo device exposing free sensor + status services for agents.",
      apiKeyHash: sha256(rawKey),
      apiKeyPreview: previewApiKey(rawKey),
      userId: user.id,
    },
    select: { id: true, connectorId: true, title: true },
  });
  console.log("device:", device.id, `(connectorId: ${device.connectorId})`);

  // 3) FREE services. All serviceType FREE, not password protected, globally
  //    discoverable, with declared argument schemas.
  const serviceDefs = [
    {
      title: "Read Temperature",
      description: "Returns the current temperature reading for a room.",
      parameters: [
        { name: "room", type: "string", required: true, description: "Room identifier, e.g. \"100\"" },
        { name: "floor", type: "string", required: true, description: "Floor identifier, e.g. \"5\"" },
      ],
    },
    {
      title: "Read Humidity",
      description: "Returns the current relative humidity for a room.",
      parameters: [
        { name: "room", type: "string", required: true, description: "Room identifier" },
        { name: "floor", type: "string", required: false, description: "Optional floor identifier" },
      ],
    },
    {
      title: "Device Status",
      description: "Returns the device's online status and uptime. No inputs.",
      parameters: [],
    },
  ];

  const services = [];
  for (const s of serviceDefs) {
    const created = await prisma.service.create({
      data: {
        title: s.title,
        description: s.description,
        parameters: s.parameters,
        serviceType: "FREE",
        walletChain: "BASE",
        passwordProtected: false,
        globallyDiscoverable: true,
        deviceId: device.id,
        userId: user.id,
      },
      select: { id: true, title: true },
    });
    services.push(created);
    console.log("service:", created.id, `— ${created.title}`);
  }

  console.log("\n──────────────────────────────────────────────");
  console.log("SUMMARY (use these with skills.md)");
  console.log("──────────────────────────────────────────────");
  console.log("login email    :", EMAIL);
  console.log("login password :", PASS);
  console.log("PUBLIC deviceId:", device.id);
  console.log("device API key (raw, shown once):", rawKey);
  console.log("connectorId (PRIVATE — for firmware only):", device.connectorId);
  console.log("services:");
  for (const s of services) console.log("  -", s.id, `(${s.title})`);
  console.log("\nDiscover:  GET  /public/device/" + device.id);
  console.log(
    "Call:      POST /quote/device/" + device.id + "/service/" + services[0].id,
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
