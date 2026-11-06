#include "faces.h"
#include "config.h"
#include <Arduino_LED_Matrix.h>

static constexpr int W = 13;
static constexpr int H = 8;
static constexpr uint8_t ON = 7;  // 3-bit grayscale

static Arduino_LED_Matrix matrix;
static uint8_t frame[W * H];
static int current = -1;

struct Glyph {
  char c;
  uint8_t width;
  uint8_t rows[5];
};

static const Glyph FONT[] = {
    {'0', 3, {0b111, 0b101, 0b101, 0b101, 0b111}},
    {'2', 3, {0b111, 0b001, 0b111, 0b100, 0b111}},
    {'4', 3, {0b101, 0b101, 0b111, 0b001, 0b001}},
    {'G', 3, {0b111, 0b100, 0b101, 0b101, 0b111}},
    {'?', 3, {0b111, 0b001, 0b011, 0b000, 0b010}},
    {'T', 3, {0b111, 0b010, 0b010, 0b010, 0b010}},
    {'E', 3, {0b111, 0b100, 0b111, 0b100, 0b111}},
    {'B', 3, {0b110, 0b101, 0b110, 0b101, 0b110}},
    {'A', 3, {0b010, 0b101, 0b111, 0b101, 0b101}},
    {'!', 1, {0b1, 0b1, 0b1, 0b0, 0b1}},
};

// 13-bit rows, bit 12 = leftmost column.
static const uint16_t ICON_IDLE[H] = {0, 0, 0, 0b0000001000000, 0, 0, 0, 0};
static const uint16_t ICON_READY[H] = {0,
                                       0b0000100010000,
                                       0b0000100010000,
                                       0,
                                       0b0001000001000,
                                       0b0000111110000,
                                       0,
                                       0};
static const uint16_t ICON_THINKING[H] = {0, 0, 0, 0, 0b0001001001000, 0, 0, 0};
static const uint16_t ICON_MOVING[H] = {0b0000001000000, 0b0000011100000, 0b0000111110000, 0b0001111111000,
                                        0b0000011100000, 0b0000011100000, 0b0000011100000, 0b0000011100000};
static const uint16_t ICON_STOP[H] = {0b0000111110000, 0b0001111111000, 0b0011111111100, 0b0010000000100,
                                      0b0010000000100, 0b0011111111100, 0b0001111111000, 0b0000111110000};
static const uint16_t ICON_DONE[H] = {0,
                                      0,
                                      0b0000000000100,
                                      0b0000000001000,
                                      0b0010000010000,
                                      0b0001000100000,
                                      0b0000101000000,
                                      0b0000010000000};

static void setPixel(int x, int y) {
  if (x >= 0 && x < W && y >= 0 && y < H) frame[y * W + x] = ON;
}

static const Glyph *glyphFor(char c) {
  for (const Glyph &g : FONT)
    if (g.c == c) return &g;
  return nullptr;
}

static void drawText(const char *s) {
  int width = 0;
  for (const char *p = s; *p; p++) {
    const Glyph *g = glyphFor(*p);
    if (g) width += g->width + (p[1] ? 1 : 0);
  }
  int x = (W - width) / 2;
  for (const char *p = s; *p; p++) {
    const Glyph *g = glyphFor(*p);
    if (!g) continue;
    for (int row = 0; row < 5; row++)
      for (int col = 0; col < g->width; col++)
        if (g->rows[row] & (1 << (g->width - 1 - col))) setPixel(x + col, 1 + row);
    x += g->width + 1;
  }
}

static void drawIcon(const uint16_t rows[H]) {
  for (int y = 0; y < H; y++)
    for (int x = 0; x < W; x++)
      if (rows[y] & (1 << (W - 1 - x))) setPixel(x, y);
}

void facesInit() {
  matrix.begin();
  matrix.setGrayscaleBits(3);
}

bool facesShow(int code) {
  if (code == current) return true;
  memset(frame, 0, sizeof(frame));
  switch (code) {
    case FACE_IDLE: drawIcon(ICON_IDLE); break;
    case FACE_READY: drawIcon(ICON_READY); break;
    case FACE_THINKING: drawIcon(ICON_THINKING); break;
    case FACE_MOVING: drawIcon(ICON_MOVING); break;
    case FACE_ZG: drawText("0G?"); break;
    case FACE_TEE: drawText("!TEE"); break;
    case FACE_PAY: drawText("402"); break;
    case FACE_STOP: drawIcon(ICON_STOP); break;
    case FACE_DONE: drawIcon(ICON_DONE); break;
    case FACE_BATTERY: drawText("BAT"); break;
    default: return false;
  }
  matrix.draw(frame);  // grayscale write; avoids loadPixels, which overruns its 3-word buffer
  current = code;
  return true;
}

int facesCurrent() { return current; }
// 2026-11-06T01:21:00
// 2026-11-06T22:26:34


// Static frames only — no SCROLL_LEFT (crashes on the Zephyr 1.0.0 core).
// Face DONE (14): shown at mission end by the rover service.
// Face BAT (15): shown when battery < 7000mV.
// Face 0G? (10): shown when the 0G brain fails (3 tries + 5s back-off).
// Face !TEE (11): shown when TEE proof verification fails.
// All frames are 8x12 uint8_t bitmaps packed into progmem.
const uint8_t FACE_DONE[8][12] PROGMEM = { /* ... checkmark ... */ };
const uint8_t FACE_BAT[8][12]  PROGMEM = { /* ... battery icon ... */ };
