"""Station HTTP API on :8710 (plan §12.5). Every call needs X-Station-Token; the laptop shop is the only client."""
import hmac
import os

from aiohttp import web

from . import config
from .sampler import Sampler


def board_temp_mc() -> int | None:
    try:
        with open("/sys/class/thermal/thermal_zone0/temp") as f:
            return int(f.read().strip())
    except OSError:
        return None


def make_app(sampler: Sampler, token: str) -> web.Application:
    @web.middleware
    async def auth(request, handler):
        if not hmac.compare_digest(request.headers.get("X-Station-Token", ""), token):
            raise web.HTTPUnauthorized(text="bad or missing X-Station-Token")
        return await handler(request)

    async def reading(_request):
        problem = sampler.fresh_problem()
        if problem:
            raise web.HTTPServiceUnavailable(text=problem)
        return web.json_response(sampler.reading())

    async def motion(_request):
        problem = sampler.fresh_problem()
        if problem:
            raise web.HTTPServiceUnavailable(text=problem)
        return web.json_response(sampler.motion())

    async def history(request):
        try:
            minutes = int(request.query.get("minutes", ""))
        except ValueError:
            minutes = 0
        if not 1 <= minutes <= 60:
            raise web.HTTPBadRequest(text="minutes must be 1-60")
        samples = sampler.history_since(minutes)
        return web.json_response({"v": 1, "station": config.STATION_ID, "minutes": minutes,
                                  "every_s": config.HISTORY_EVERY_S, "samples": samples})

    async def health(_request):
        s = sampler.state
        return web.json_response({
            "ok": sampler.fresh_problem() is None, "problem": sampler.fresh_problem(),
            "signer": sampler.signer.address, "station": config.STATION_ID,
            "sensors": None if s is None else {"aht20": bool(s.ok_aht), "bmp280": bool(s.ok_bmp), "pressure": bool(s.ok_press)},
            "i2c_err": None if s is None else s.i2c_err, "mcu_uptime_ms": None if s is None else s.uptime_ms,
            "history_samples": len(sampler.history), "board_temp_mc": board_temp_mc(), "pid": os.getpid(),
        })

    app = web.Application(middlewares=[auth])
    app.add_routes([web.get("/reading", reading), web.get("/motion", motion), web.get("/history", history),
                    web.get("/health", health)])
    return app
