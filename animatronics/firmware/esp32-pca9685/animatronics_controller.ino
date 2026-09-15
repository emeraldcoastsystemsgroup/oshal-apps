/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the reference motion controller: an ESP32 (or
 *                     |                             | any Arduino with USB serial) driving a PCA9685 at 50 Hz,
 *                     |                             | speaking the oshal-animatronics/1 line protocol the page
 *                     |                             | streams over Web Serial. Verifies every checksum, clamps every
 *                     |                             | pulse to the controller-side limits the host set with `L`,
 *                     |                             | latches E-STOP (outputs off, OE high) until `R`, and releases
 *                     |                             | to outputs-off after WATCHDOG_MS of silence. It never invents
 *                     |                             | a motion: it applies frames. POSTURE: this sketch is REFERENCE
 *                     |                             | source, not compiled or bench-run in the session that wrote
 *                     |                             | it — the protocol it implements is proven by the Node encoder /
 *                     |                             | parser tests; bench proof is BACKLOG B2.
 *
 * Wiring: PCA9685 SDA/SCL to the ESP32's I2C pins (21/22 on a DevKit), VCC to 3.3 V, OE to
 * OE_PIN, V+ (servo rail) to a SEPARATE 5–6 V supply sized for the summed servo current, and
 * ONLY ground shared with the microcontroller. Never power servos from the USB 5 V pin.
 *
 * Library: Adafruit PWM Servo Driver (Adafruit_PWMServoDriver.h).
 */
#include <Wire.h>
#include <Adafruit_PWMServoDriver.h>

static const char* PROTOCOL = "oshal-animatronics/1";
static const char* BOARD = "pca9685";
static const uint8_t CHANNELS = 16;
static const uint32_t BAUD = 115200;
static const uint32_t WATCHDOG_MS = 3000;   // matches WATCHDOG_MS in engine/protocol.ts
static const int OE_PIN = 4;                 // PCA9685 OE (active low): HIGH = all outputs off
static const uint16_t HARD_MIN_US = 400;     // absolute floor / ceiling regardless of L
static const uint16_t HARD_MAX_US = 2800;

Adafruit_PWMServoDriver pwm = Adafruit_PWMServoDriver(0x40);
uint16_t minUs[CHANNELS];
uint16_t maxUs[CHANNELS];
bool estopped = false;
uint32_t lastTrafficMs = 0;
char line[256];
size_t lineLen = 0;

static uint8_t checksumOf(const char* body, size_t len) {
  uint8_t x = 0;
  for (size_t i = 0; i < len; i++) x ^= (uint8_t)body[i];
  return x;
}

static void reply(const char* body) {
  uint8_t x = checksumOf(body, strlen(body));
  Serial.print(body); Serial.print('*');
  if (x < 16) Serial.print('0');
  Serial.print(x, HEX); Serial.print('\n');
}

static void replyOk(const char* ref) { char buf[64]; snprintf(buf, sizeof(buf), "OK %s", ref); reply(buf); }
static void replyErr(const char* ref, const char* reason) { char buf[128]; snprintf(buf, sizeof(buf), "ERR %s %s", ref, reason); reply(buf); }

static void outputsOff() {
  digitalWrite(OE_PIN, HIGH);
  for (uint8_t c = 0; c < CHANNELS; c++) pwm.setPWM(c, 0, 0);
}

static void outputsOn() { digitalWrite(OE_PIN, LOW); }

static void setPulse(uint8_t channel, uint16_t us) {
  if (us < minUs[channel]) us = minUs[channel];
  if (us > maxUs[channel]) us = maxUs[channel];
  pwm.writeMicroseconds(channel, us);
}

// F <seq> [ch=us,ch=us,...]
static void handleFrame(char* args) {
  char* seq = strtok(args, " ");
  if (!seq) { replyErr("?", "frame needs a sequence number"); return; }
  if (estopped) { replyErr(seq, "estopped"); return; }
  char* pairs = strtok(NULL, " ");
  outputsOn();
  if (pairs) {
    char* item = strtok(pairs, ",");
    while (item) {
      char* eq = strchr(item, '=');
      if (!eq) { replyErr(seq, "bad output"); return; }
      *eq = '\0';
      int ch = atoi(item); long us = atol(eq + 1);
      if (ch < 0 || ch >= CHANNELS) { replyErr(seq, "channel out of range"); return; }
      if (us < HARD_MIN_US || us > HARD_MAX_US) { replyErr(seq, "pulse out of range"); return; }
      setPulse((uint8_t)ch, (uint16_t)us);
      item = strtok(NULL, ",");
    }
  }
  replyOk(seq);
}

// L <ch> <min> <max>
static void handleLimits(char* args) {
  char* c = strtok(args, " "); char* lo = strtok(NULL, " "); char* hi = strtok(NULL, " ");
  if (!c || !lo || !hi) { replyErr("L", "limits need channel min max"); return; }
  int ch = atoi(c); long a = atol(lo); long b = atol(hi);
  if (ch < 0 || ch >= CHANNELS || a < HARD_MIN_US || b > HARD_MAX_US || a >= b) { replyErr("L", "bad limits"); return; }
  minUs[ch] = (uint16_t)a; maxUs[ch] = (uint16_t)b;
  char ref[16]; snprintf(ref, sizeof(ref), "L %d", ch); replyOk(ref);
}

static void handleLine(char* text, size_t len) {
  // Verify the checksum: body*XX
  if (len < 3 || text[len - 3] != '*') { replyErr("?", "missing checksum"); return; }
  uint8_t want = (uint8_t)strtol(text + len - 2, NULL, 16);
  text[len - 3] = '\0';
  if (checksumOf(text, len - 3) != want) { replyErr("?", "bad checksum"); return; }
  lastTrafficMs = millis();
  char verb = text[0];
  char* args = (len - 3 > 1) ? text + 2 : NULL;
  switch (verb) {
    case 'H': { char buf[96]; snprintf(buf, sizeof(buf), "HELLO %s board=%s channels=%u", PROTOCOL, BOARD, CHANNELS); reply(buf); break; }
    case 'F': if (args) handleFrame(args); else replyErr("?", "frame needs a sequence number"); break;
    case 'L': if (args) handleLimits(args); else replyErr("L", "limits need channel min max"); break;
    case 'E': estopped = true; outputsOff(); reply("ESTOP"); break;
    case 'R': estopped = false; replyOk("R"); break;
    default: replyErr("?", "unknown message");
  }
}

void setup() {
  Serial.begin(BAUD);
  pinMode(OE_PIN, OUTPUT);
  digitalWrite(OE_PIN, HIGH);
  Wire.begin();
  pwm.begin();
  pwm.setOscillatorFrequency(27000000);
  pwm.setPWMFreq(50);
  for (uint8_t c = 0; c < CHANNELS; c++) { minUs[c] = HARD_MIN_US; maxUs[c] = HARD_MAX_US; }
  outputsOff();
  lastTrafficMs = millis();
}

void loop() {
  while (Serial.available()) {
    char ch = (char)Serial.read();
    if (ch == '\n') {
      if (lineLen > 0) { line[lineLen] = '\0'; handleLine(line, lineLen); }
      lineLen = 0;
    } else if (ch != '\r' && lineLen < sizeof(line) - 1) {
      line[lineLen++] = ch;
    } else if (lineLen >= sizeof(line) - 1) {
      lineLen = 0; replyErr("?", "line too long");
    }
  }
  // Silence for WATCHDOG_MS: the host is gone — outputs off (a prop with no pulses relaxes).
  if (!estopped && millis() - lastTrafficMs > WATCHDOG_MS) { outputsOff(); lastTrafficMs = millis(); }
}
