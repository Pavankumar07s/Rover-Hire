import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const landingRoot = resolve(here, "..");
const repoRoot = resolve(landingRoot, "../..");
const outDir = join(landingRoot, "public/generated");

function loadEnvFile(path) {
  try {
    const text = readFileSync(path, "utf8");
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env) || process.env[key] === "") {
        process.env[key] = value;
      }
    }
  } catch {
    /* optional */
  }
}

loadEnvFile(join(landingRoot, ".env.local"));
loadEnvFile(join(landingRoot, ".env"));
loadEnvFile(join(repoRoot, ".env"));

const apiKey = process.env.OPEN_ROUTER_API_KEY;
if (!apiKey) {
  console.error("Missing OPEN_ROUTER_API_KEY in env.");
  process.exit(1);
}

const MODEL =
  process.env.OPEN_ROUTER_IMAGE_MODEL || "black-forest-labs/flux.2-pro";

const IMAGES = [
  {
    file: "esp32-node.jpg",
    aspect: "16:9",
    prompt:
      "Cinematic macro photograph of a bare ESP32 development board on a black carbon-fiber workbench, copper traces catching a single warm tungsten key light, tiny blue Wi-Fi LED, header pins, ceramic antenna, shallow depth of field, luxury industrial product photography, photorealistic, no text, no logos, no watermarks.",
  },
  {
    file: "robot-car.jpg",
    aspect: "16:9",
    prompt:
      "Cinematic photograph of a small two-motor robot car chassis in a dark electronics lab, L298N motor driver, ESP32 mounted on top, wheels slightly blurred as if just starting to roll, amber status LEDs, black anodized metal, photorealistic, no people, no text, no logos, no watermarks.",
  },
  {
    file: "uav.jpg",
    aspect: "4:3",
    prompt:
      "Cinematic low-light photograph of a compact inspection drone hovering indoors over a dark industrial floor, carbon-fiber arms, faint rotor motion blur, single cyan status LED, volumetric dust in a shaft of light, photorealistic, no people, no text, no logos, no watermarks.",
  },
  {
    file: "telemetry-grid.jpg",
    aspect: "3:4",
    prompt:
      "Cinematic nighttime aerial photograph of a dense field of weather and soil sensor nodes glowing faint amber across agricultural land, each node a small black enclosure, distant city lights on the horizon, moody charcoal color grade, photorealistic, no text, no logos, no watermarks.",
  },
];

async function generate(image) {
  const res = await fetch("https://openrouter.ai/api/v1/images", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      prompt: image.prompt,
      aspect_ratio: image.aspect,
      output_format: "jpeg",
      n: 1,
    }),
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err =
      payload?.error?.message ||
      payload?.error ||
      JSON.stringify(payload).slice(0, 400);
    throw new Error(`${res.status}: ${err}`);
  }

  const item = payload?.data?.[0];
  const b64 = item?.b64_json;
  if (!b64 || typeof b64 !== "string") {
    throw new Error("No image bytes in response");
  }

  const buf = Buffer.from(b64, "base64");
  writeFileSync(join(outDir, image.file), buf);
  console.log(`wrote ${image.file} (${buf.length} bytes)`);
}

mkdirSync(outDir, { recursive: true });
console.log(`Generating ${IMAGES.length} images with ${MODEL}`);

for (const image of IMAGES) {
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await generate(image);
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
      console.error(`retry ${attempt}/3 for ${image.file}: ${err.message}`);
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  if (lastErr) {
    console.error(`failed ${image.file}`);
    process.exit(1);
  }
}
