#include <Adafruit_NeoPixel.h>
#include <PubSubClient.h>
#include <WiFi.h>
#include <math.h>

#define LED_PIN 2
#define NUM_LEDS 60
#define GRID_WIDTH 5
#define GRID_HEIGHT 5
Adafruit_NeoPixel strip(NUM_LEDS, LED_PIN, NEO_GRB + NEO_KHZ800);

const char *ssid = "RedRover";
const char *mqtt_server = "test.mosquitto.org";

WiFiClient espClient;
PubSubClient client(espClient);

// 6 Upright gradients (Apple-inspired finishes) - darker and more visible
// Gradient 0: Sage - soft green to mint
uint32_t UPRIGHT_0_A = strip.Color(80, 160, 100);
uint32_t UPRIGHT_0_B = strip.Color(140, 220, 160);

// Gradient 1: Sky - light blue to cyan
uint32_t UPRIGHT_1_A = strip.Color(60, 160, 200);
uint32_t UPRIGHT_1_B = strip.Color(40, 200, 240);

// Gradient 2: Lavender - soft purple to lilac
uint32_t UPRIGHT_2_A = strip.Color(160, 140, 200);
uint32_t UPRIGHT_2_B = strip.Color(200, 160, 220);

// Gradient 3: Pearl - soft white to light gray-blue
uint32_t UPRIGHT_3_A = strip.Color(180, 200, 220);
uint32_t UPRIGHT_3_B = strip.Color(160, 190, 210);

// Gradient 4: Mint - fresh mint to seafoam
uint32_t UPRIGHT_4_A = strip.Color(100, 200, 160);
uint32_t UPRIGHT_4_B = strip.Color(140, 240, 190);

// Gradient 5: Dawn - soft peach to cream
uint32_t UPRIGHT_5_A = strip.Color(240, 180, 140);
uint32_t UPRIGHT_5_B = strip.Color(250, 210, 180);

// 6 Slouch gradients (Apple-inspired warm finishes) - darker and more visible
// Gradient 0: Ember - warm orange to red
uint32_t SLOUCH_0_A = strip.Color(255, 100, 40);
uint32_t SLOUCH_0_B = strip.Color(255, 50, 70);

// Gradient 1: Sunset - coral to pink
uint32_t SLOUCH_1_A = strip.Color(255, 120, 80);
uint32_t SLOUCH_1_B = strip.Color(255, 70, 120);

// Gradient 2: Amber - golden to orange
uint32_t SLOUCH_2_A = strip.Color(255, 150, 30);
uint32_t SLOUCH_2_B = strip.Color(255, 110, 50);

// Gradient 3: Rose - rose to pink
uint32_t SLOUCH_3_A = strip.Color(255, 90, 110);
uint32_t SLOUCH_3_B = strip.Color(255, 120, 150);

// Gradient 4: Coral - coral to peach
uint32_t SLOUCH_4_A = strip.Color(255, 100, 70);
uint32_t SLOUCH_4_B = strip.Color(255, 150, 120);

// Gradient 5: Flame - red-orange to yellow-orange
uint32_t SLOUCH_5_A = strip.Color(255, 70, 50);
uint32_t SLOUCH_5_B = strip.Color(255, 130, 70);

// Current selected gradients (defaults)
uint8_t currentUprightGradient = 5; // Default to Dawn
uint8_t currentSlouchGradient = 0;

// Track current posture state
bool isCurrentlyUpright = true;

// Current active gradient endpoints for posture mode
uint32_t fromA, fromB;
uint32_t toA, toB;

float transitionProgress = 1.0;

// Brightness control (0-255, default full brightness)
uint8_t currentBrightness = 255;

// Lantern modes
enum LanternMode { MODE_POSTURE, MODE_MOBILITY, MODE_PARTY };

LanternMode currentMode = MODE_POSTURE;
unsigned long modeStartMillis = 0;

// Mobility fade state
float mobilityFade = 0.0; // 0.0 = fully off, 1.0 = fully on
const float FADE_SPEED =
    0.003; // Speed of fade in/out (adjust for faster/slower)

void setup_wifi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid);
  Serial.print("Connecting");
  while (WiFi.status() != WL_CONNECTED) {
    delay(400);
    Serial.print(".");
  }
  Serial.println("\nWiFi connected!");
}

void startTransition(uint32_t newA, uint32_t newB) {
  fromA = toA;
  fromB = toB;
  toA = newA;
  toB = newB;
  transitionProgress = 0.0;
}

void setGradientInstant(uint32_t newA, uint32_t newB) {
  // Instant change - no transition
  fromA = newA;
  fromB = newB;
  toA = newA;
  toB = newB;
  transitionProgress = 1.0;
}

uint32_t lerpColor(uint32_t c1, uint32_t c2, float t) {
  uint8_t r1 = (c1 >> 16) & 255, g1 = (c1 >> 8) & 255, b1 = c1 & 255;
  uint8_t r2 = (c2 >> 16) & 255, g2 = (c2 >> 8) & 255, b2 = c2 & 255;

  uint8_t r = r1 + (r2 - r1) * t;
  uint8_t g = g1 + (g2 - g1) * t;
  uint8_t b = b1 + (b2 - b1) * t;

  return strip.Color(r, g, b);
}

uint32_t applyBrightness(uint32_t color, uint8_t brightness) {
  float brightFactor = (float)brightness / 255.0;

  uint8_t r = (uint8_t)(((color >> 16) & 255) * brightFactor);
  uint8_t g = (uint8_t)(((color >> 8) & 255) * brightFactor);
  uint8_t b = (uint8_t)((color & 255) * brightFactor);

  return strip.Color(r, g, b);
}

// Map LED index to x position in snaking 5x5 grid
int getXPosition(int ledIndex) {
  int row = ledIndex / GRID_WIDTH;
  int colInRow = ledIndex % GRID_WIDTH;

  if (row % 2 == 0) {
    return colInRow;
  } else {
    return (GRID_WIDTH - 1) - colInRow;
  }
}

void renderGradient() {
  uint32_t cStart, cEnd;

  if (transitionProgress >= 1.0) {
    cStart = toA;
    cEnd = toB;
  } else {
    cStart = lerpColor(fromA, toA, transitionProgress);
    cEnd = lerpColor(fromB, toB, transitionProgress);
  }

  for (int i = 0; i < NUM_LEDS; i++) {
    int xPos = getXPosition(i);
    float gradientPos = (float)xPos / (float)(GRID_WIDTH - 1);
    uint32_t c = lerpColor(cStart, cEnd, gradientPos);
    c = applyBrightness(c, currentBrightness);
    strip.setPixelColor(i, c);
  }

  strip.show();
}

void getGradientColors(uint8_t gradientIndex, bool isUpright, uint32_t *outA,
                       uint32_t *outB) {
  if (isUpright) {
    switch (gradientIndex) {
    case 0:
      *outA = UPRIGHT_0_A;
      *outB = UPRIGHT_0_B;
      break;
    case 1:
      *outA = UPRIGHT_1_A;
      *outB = UPRIGHT_1_B;
      break;
    case 2:
      *outA = UPRIGHT_2_A;
      *outB = UPRIGHT_2_B;
      break;
    case 3:
      *outA = UPRIGHT_3_A;
      *outB = UPRIGHT_3_B;
      break;
    case 4:
      *outA = UPRIGHT_4_A;
      *outB = UPRIGHT_4_B;
      break;
    case 5:
      *outA = UPRIGHT_5_A;
      *outB = UPRIGHT_5_B;
      break;
    default:
      *outA = UPRIGHT_0_A;
      *outB = UPRIGHT_0_B;
      break;
    }
  } else {
    switch (gradientIndex) {
    case 0:
      *outA = SLOUCH_0_A;
      *outB = SLOUCH_0_B;
      break;
    case 1:
      *outA = SLOUCH_1_A;
      *outB = SLOUCH_1_B;
      break;
    case 2:
      *outA = SLOUCH_2_A;
      *outB = SLOUCH_2_B;
      break;
    case 3:
      *outA = SLOUCH_3_A;
      *outB = SLOUCH_3_B;
      break;
    case 4:
      *outA = SLOUCH_4_A;
      *outB = SLOUCH_4_B;
      break;
    case 5:
      *outA = SLOUCH_5_A;
      *outB = SLOUCH_5_B;
      break;
    default:
      *outA = SLOUCH_0_A;
      *outB = SLOUCH_0_B;
      break;
    }
  }
}

// HSV → RGB helper for Party Mode
uint32_t hsvToRgb(float h, float s, float v) {
  float c = v * s;
  float x = c * (1.0f - fabsf(fmodf(h / 60.0f, 2.0f) - 1.0f));
  float m = v - c;

  float r1, g1, b1;
  if (h < 60.0f) {
    r1 = c;
    g1 = x;
    b1 = 0;
  } else if (h < 120.0f) {
    r1 = x;
    g1 = c;
    b1 = 0;
  } else if (h < 180.0f) {
    r1 = 0;
    g1 = c;
    b1 = x;
  } else if (h < 240.0f) {
    r1 = 0;
    g1 = x;
    b1 = c;
  } else if (h < 300.0f) {
    r1 = x;
    g1 = 0;
    b1 = c;
  } else {
    r1 = c;
    g1 = 0;
    b1 = x;
  }

  uint8_t r = (uint8_t)((r1 + m) * 255);
  uint8_t g = (uint8_t)((g1 + m) * 255);
  uint8_t b = (uint8_t)((b1 + m) * 255);
  return strip.Color(r, g, b);
}

// MOBILITY: flash current gradient on/off for 10s
void renderMobility() {
  // Smooth fade in/out using sine wave for gradual transitions
  unsigned long now = millis();
  float time = (float)now * FADE_SPEED;

  // Use sine wave: (sin(time) + 1) / 2 gives smooth 0.0 to 1.0 oscillation
  mobilityFade = (sin(time) + 1.0) * 0.5;

  // Get current gradient colors
  uint32_t a, b;
  if (isCurrentlyUpright) {
    getGradientColors(currentUprightGradient, true, &a, &b);
  } else {
    getGradientColors(currentSlouchGradient, false, &a, &b);
  }

  // Apply fade to gradient
  for (int i = 0; i < NUM_LEDS; i++) {
    int xPos = getXPosition(i);
    float gradientPos = (float)xPos / (float)(GRID_WIDTH - 1);
    uint32_t c = lerpColor(a, b, gradientPos);

    // Apply fade multiplier to brightness
    uint8_t fadeBrightness = (uint8_t)(currentBrightness * mobilityFade);
    c = applyBrightness(c, fadeBrightness);

    strip.setPixelColor(i, c);
  }
  strip.show();
}

// PARTY: smooth rainbow gradient flowing across the grid
void renderParty() {
  unsigned long now = millis();
  float baseHue = fmodf((float)now / 2.0f, 360.0f); // animate over time
  float brightnessFactor = (float)currentBrightness / 255.0f;

  for (int i = 0; i < NUM_LEDS; i++) {
    int xPos = getXPosition(i);
    int row = i / GRID_WIDTH;

    float hue = baseHue + xPos * 20.0f + row * 10.0f;
    while (hue >= 360.0f)
      hue -= 360.0f;
    while (hue < 0.0f)
      hue += 360.0f;

    uint32_t c = hsvToRgb(hue, 1.0f, brightnessFactor);
    strip.setPixelColor(i, c);
  }
  strip.show();
}

void mqtt_callback(char *topic, byte *payload, unsigned int len) {
  String msg;
  for (int i = 0; i < (int)len; i++)
    msg += (char)payload[i];
  msg.trim();

  Serial.printf("MQTT [%s] %s\n", topic, msg.c_str());

  if (String(topic) == "esp32/mode") {
    if (msg == "MODE_UPRIGHT") {
      isCurrentlyUpright = true;
      uint32_t a, b;
      getGradientColors(currentUprightGradient, true, &a, &b);
      currentMode = MODE_POSTURE;
      startTransition(a, b);
    } else if (msg == "MODE_SLOUCH") {
      isCurrentlyUpright = false;
      uint32_t a, b;
      getGradientColors(currentSlouchGradient, false, &a, &b);
      currentMode = MODE_POSTURE;
      startTransition(a, b);
    } else if (msg == "MODE_MOBILITY") {
      currentMode = MODE_MOBILITY;
      modeStartMillis = millis();
      mobilityFade = 0.0; // Start from off for smooth fade in
    } else if (msg == "MODE_PARTY") {
      currentMode = MODE_PARTY;
      modeStartMillis = millis();
    }
  }

  if (String(topic) == "esp32/gradient") {
    // Format: "UPRIGHT:0" or "SLOUCH:2" or "UPRIGHT:0:INSTANT"
    int colonIndex = msg.indexOf(':');
    if (colonIndex > 0) {
      String posture = msg.substring(0, colonIndex);
      int secondColon = msg.indexOf(':', colonIndex + 1);
      uint8_t gradientIndex;
      bool instant = false;

      if (secondColon > 0) {
        gradientIndex = msg.substring(colonIndex + 1, secondColon).toInt();
        instant = (msg.substring(secondColon + 1) == "INSTANT");
      } else {
        gradientIndex = msg.substring(colonIndex + 1).toInt();
      }

      if (posture == "UPRIGHT" && gradientIndex < 6) {
        currentUprightGradient = gradientIndex;
        uint32_t a, b;
        getGradientColors(currentUprightGradient, true, &a, &b);
        if (instant && isCurrentlyUpright && currentMode == MODE_POSTURE) {
          setGradientInstant(a, b);
        }
      } else if (posture == "SLOUCH" && gradientIndex < 6) {
        currentSlouchGradient = gradientIndex;
        uint32_t a, b;
        getGradientColors(currentSlouchGradient, false, &a, &b);
        if (instant && !isCurrentlyUpright && currentMode == MODE_POSTURE) {
          setGradientInstant(a, b);
        }
      }
    }
  }

  if (String(topic) == "esp32/brightness") {
    // Format: "BRIGHT", "NORMAL", "DIMMED" or numeric 0-255
    if (msg == "BRIGHT") {
      currentBrightness = 255;
    } else if (msg == "NORMAL") {
      currentBrightness = 180;
    } else if (msg == "DIMMED") {
      currentBrightness = 120;
    } else {
      uint8_t brightness = msg.toInt();
      if (brightness <= 255) {
        currentBrightness = brightness;
      }
    }
  }

  if (String(topic) == "esp32/ping") {
    String reply = "ONLINE|" + WiFi.localIP().toString();
    client.publish("esp32/status", reply.c_str());
  }
}

void reconnect() {
  while (!client.connected()) {
    Serial.print("Connecting MQTT...");
    if (client.connect("ESP32-Lantern")) {
      Serial.println("connected.");
      client.subscribe("esp32/mode");
      client.subscribe("esp32/gradient");
      client.subscribe("esp32/brightness");
      client.subscribe("esp32/ping");
      String msg = "ONLINE|" + WiFi.localIP().toString();
      client.publish("esp32/status", msg.c_str());
    } else {
      Serial.println("Retry in 5s");
      delay(5000);
    }
  }
}

void setup() {
  Serial.begin(115200);
  strip.begin();
  strip.show();

  // Initialize with default upright gradient
  getGradientColors(currentUprightGradient, true, &toA, &toB);
  fromA = toA;
  fromB = toB;

  setup_wifi();
  client.setServer(mqtt_server, 1883);
  client.setCallback(mqtt_callback);
}

void loop() {
  if (!client.connected())
    reconnect();
  client.loop();

  unsigned long now = millis();

  // Auto-exit special modes after 10 seconds back to posture gradient
  if (currentMode != MODE_POSTURE && (now - modeStartMillis >= 10000UL)) {
    currentMode = MODE_POSTURE;
    uint32_t a, b;
    if (isCurrentlyUpright) {
      getGradientColors(currentUprightGradient, true, &a, &b);
    } else {
      getGradientColors(currentSlouchGradient, false, &a, &b);
    }
    startTransition(a, b);
  }

  if (currentMode == MODE_POSTURE) {
    if (transitionProgress < 1.0) {
      transitionProgress += 0.020;
      if (transitionProgress > 1.0)
        transitionProgress = 1.0;
    }
    renderGradient();
  } else if (currentMode == MODE_MOBILITY) {
    renderMobility();
  } else if (currentMode == MODE_PARTY) {
    renderParty();
  }

  delay(20);
}
