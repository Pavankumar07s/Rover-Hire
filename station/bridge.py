"""station_mcu over the Arduino Bridge (msgpack-RPC via arduino-router): one call, 13 integers."""
from dataclasses import dataclass

FIELDS = ("t_aht_cc", "rh_cpct", "t_bmp_cc", "p_pa", "light_raw", "motion_count", "motion_last_ms", "i2c_err",
          "ok_aht", "ok_bmp", "uptime_ms", "sample_ms", "ok_press")


class BridgeError(RuntimeError):
    pass


@dataclass(frozen=True)
class McuState:
    t_aht_cc: int
    rh_cpct: int
    t_bmp_cc: int
    p_pa: int
    light_raw: int
    motion_count: int
    motion_last_ms: int
    i2c_err: int
    ok_aht: int
    ok_bmp: int
    uptime_ms: int
    sample_ms: int
    ok_press: int

    @property
    def sample_age_ms(self) -> int:
        return self.uptime_ms - self.sample_ms if self.sample_ms else 1 << 31


def parse(csv: str) -> McuState:
    parts = str(csv).split(",")
    if len(parts) != len(FIELDS):
        raise BridgeError(f"station_state gave {len(parts)} fields, expected {len(FIELDS)}: is the firmware current?")
    return McuState(*map(int, parts))


class Mcu:
    def __init__(self):
        self._bridge = None

    def _connect(self):
        from arduino.router_bridge import Bridge

        bridge = Bridge()
        if not bridge.connect(timeout=10):
            raise BridgeError("cannot reach /var/run/arduino-router.sock (router down, or not in arduino-router)")
        self._bridge = bridge

    def call(self, name: str):
        if self._bridge is None:
            self._connect()
        try:
            return self._bridge.call(name, timeout=5)
        except Exception as e:
            self._bridge = None  # reconnect next time
            raise BridgeError(f"{name}: {e}") from e

    def state(self) -> McuState:
        return parse(self.call("station_state"))
