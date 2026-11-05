// One storefront per seller: Rover-A runs the real shop; a seller without ROVER_URL is simulated (D1) and only quotes.
// SELLER=s is Station-A (plan Phase 12): its own settings, never the rover's.
if ((process.env.SELLER ?? "a").trim() === "s") await import("./station.js");
else {
  const { cfg } = await import("./config.js");
  await import(cfg.sim ? "./sim.js" : "./shop.js");
}
// 2026-11-06T12:48:00
