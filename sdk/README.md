# OxBS ESP32 SDK

Wrap a function you already have. Agents pay, then your ESP32 runs that function.

**Connect Wi-Fi in your sketch.** This library does not call `WiFi.begin()`.

## Install

Do **not** zip a cloned folder in Finder and use **Add .ZIP Library**. macOS adds `__MACOSX` and `._` files on top of `.git`, and Arduino fails with `permission denied` while extracting.

**Use git (recommended)**

```bash
mkdir -p ~/Documents/Arduino/libraries
cd ~/Documents/Arduino/libraries
git clone https://github.com/abhinav-genx/0xBs-sdk.git
```

Restart Arduino IDE. **Sketch → Include Library** should list **OxBS**.

**Or Add .ZIP Library** — download [OxBS.zip](https://github.com/abhinav-genx/0xBs-sdk/raw/main/OxBS.zip) (clean Arduino archive, no `.git`). Then **Sketch → Include Library → Add .ZIP Library…** and pick `OxBS.zip`.

Do not use GitHub **Code → Download ZIP** or Finder **Compress** on a clone; those archives include `.git` / `__MACOSX` and Arduino will fail to extract.

Then install **PubSubClient** and **ArduinoJson** (v7) from Library Manager, and select an ESP32 board.

From [app.0xbs.org](https://app.0xbs.org) copy **connector id**, **api key** (shown once), and each **service id**. Do not put the public device id in firmware.

## Example

1. Join Wi-Fi yourself.  
2. `wrap` — run your function when someone pays.  
3. `setPrice` — `"$0.01"` every time, **or** a function of the arguments.  
4. `begin` — then `loop`.

```cpp
#include <WiFi.h>
#include <OxBS.h>

OxBS oxbs;

void blink() {
  digitalWrite(2, HIGH);
  oxbs.wait(200);
  digitalWrite(2, LOW);
}

// Dynamic price: $0.01 for each "times" the caller asks for
String priceFromTimes(JsonVariantConst args) {
  int times = args["times"] | 1;
  return OxBS::usd(times * 0.01);
}

void setup() {
  pinMode(2, OUTPUT);

  // You connect Wi-Fi. The SDK will not.
  WiFi.begin("WIFI_SSID", "WIFI_PASSWORD");
  while (WiFi.status() != WL_CONNECTED) delay(500);

  // Same price on every call
  oxbs.wrap("STATIC_SERVICE_ID", [](JsonVariantConst args) {
    blink();
  });
  oxbs.setPrice("STATIC_SERVICE_ID", "$0.01");

  // Price changes with the arguments
  oxbs.wrap("DYNAMIC_SERVICE_ID", [](JsonVariantConst args) {
    int times = args["times"] | 1;
    for (int i = 0; i < times; i++) blink();
  });
  oxbs.setPrice("DYNAMIC_SERVICE_ID", priceFromTimes);

  oxbs.begin("CONNECTOR_ID", "API_KEY");
}

void loop() {
  oxbs.loop();
}
```

Paste your real ids in place of `WIFI_SSID`, `CONNECTOR_ID`, `API_KEY`, and the two service ids.

Inside `wrap`, use `oxbs.wait(ms)` instead of `delay()` if the work takes more than a moment.

If `begin` fails, print `oxbs.statusMessage()`. Full sketches: **File → Examples → OxBS**.

Docs: [docs.0xbs.org](https://docs.0xbs.org)
