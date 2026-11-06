"""Station-A service: the sampler thread plus the HTTP API.  venv/bin/python -m station.main"""
import threading

from aiohttp import web

from . import config
from .api import make_app
from .bridge import Mcu
from .sampler import Sampler
from .sign import Signer


def main() -> None:
    sec = config.secrets()
    sampler = Sampler(Mcu(), Signer(sec.private_key))
    stop = threading.Event()
    threading.Thread(target=sampler.run, args=(stop,), daemon=True, name="sampler").start()
    print(f"station {config.STATION_ID} on :{config.PORT}, signer {sampler.signer.address}", flush=True)
    try:
        web.run_app(make_app(sampler, sec.lan_token), host="0.0.0.0", port=config.PORT, print=None)
    finally:
        stop.set()


if __name__ == "__main__":
    main()
