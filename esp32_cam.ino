#include "esp_camera.h"
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>

// ── Cấu hình — chỉnh trước khi flash ─────────────────────────
const char* WIFI_SSID = "C427";
const char* WIFI_PASS = "64546743";
const char* SERVER_HOST = "motion-detection-t5g4.onrender.com";
const char* CAMERA_ID = "esp32_cam1";
const char* API_KEY = "ESP_01";
const int FPS = 10;

// ── AI-Thinker ESP32-CAM pinout ───────────────────────────────
#define PWDN_GPIO_NUM 32
#define RESET_GPIO_NUM -1
#define XCLK_GPIO_NUM 0
#define SIOD_GPIO_NUM 26
#define SIOC_GPIO_NUM 27
#define Y9_GPIO_NUM 35
#define Y8_GPIO_NUM 34
#define Y7_GPIO_NUM 39
#define Y6_GPIO_NUM 36
#define Y5_GPIO_NUM 21
#define Y4_GPIO_NUM 19
#define Y3_GPIO_NUM 18
#define Y2_GPIO_NUM 5
#define VSYNC_GPIO_NUM 25
#define HREF_GPIO_NUM 23
#define PCLK_GPIO_NUM 22

// ── Biến global — kết nối được giữ xuyên suốt ────────────────
WiFiClientSecure tlsClient;
HTTPClient http;
bool httpReady = false;  // true = đã begin(), chưa end()
unsigned long lastSend = 0;
unsigned long lastPing = 0;  // keepalive ping mỗi 20s khi idle
uint32_t framesSent = 0;
uint32_t framesFail = 0;

String serverUrl = String("https://") + SERVER_HOST
                   + "/api/cameras/" + CAMERA_ID + "/predict";

// ─────────────────────────────────────────────────────────────
void initCamera() {
  camera_config_t cfg;
  cfg.ledc_channel = LEDC_CHANNEL_0;
  cfg.ledc_timer = LEDC_TIMER_0;
  cfg.pin_d0 = Y2_GPIO_NUM;
  cfg.pin_d1 = Y3_GPIO_NUM;
  cfg.pin_d2 = Y4_GPIO_NUM;
  cfg.pin_d3 = Y5_GPIO_NUM;
  cfg.pin_d4 = Y6_GPIO_NUM;
  cfg.pin_d5 = Y7_GPIO_NUM;
  cfg.pin_d6 = Y8_GPIO_NUM;
  cfg.pin_d7 = Y9_GPIO_NUM;
  cfg.pin_xclk = XCLK_GPIO_NUM;
  cfg.pin_pclk = PCLK_GPIO_NUM;
  cfg.pin_vsync = VSYNC_GPIO_NUM;
  cfg.pin_href = HREF_GPIO_NUM;
  cfg.pin_sscb_sda = SIOD_GPIO_NUM;
  cfg.pin_sscb_scl = SIOC_GPIO_NUM;
  cfg.pin_pwdn = PWDN_GPIO_NUM;
  cfg.pin_reset = RESET_GPIO_NUM;
  cfg.xclk_freq_hz = 20000000;
  cfg.pixel_format = PIXFORMAT_JPEG;
  cfg.frame_size = FRAMESIZE_QVGA;  // 320×240 — nhẹ hơn VGA 4x
  cfg.jpeg_quality = 20;            // 0–63; nhỏ hơn = chất lượng cao hơn
  cfg.fb_count = 2;                 // double buffer giảm dropped frame

  if (esp_camera_init(&cfg) != ESP_OK) {
    Serial.println("Camera init FAILED — restart");
    ESP.restart();
  }

  // Tăng saturation nhẹ để ảnh rõ hơn
  sensor_t* s = esp_camera_sensor_get();
  if (s) {
    s->set_saturation(s, 1);
    s->set_sharpness(s, 1);
  }

  Serial.println("Camera OK");
}

// ─────────────────────────────────────────────────────────────
// Thiết lập HTTP client — chỉ gọi 1 lần (hoặc sau khi lỗi)
// ─────────────────────────────────────────────────────────────
void beginHttp() {
  if (httpReady) {
    http.end();
    httpReady = false;
  }

  tlsClient.setInsecure();  // bỏ qua cert — ổn với Render / Let's Encrypt
  tlsClient.setTimeout(8);  // TCP connect timeout (giây)

  http.begin(tlsClient, serverUrl);
  http.addHeader("X-API-Key", API_KEY);
  http.addHeader("Content-Type", "multipart/form-data; boundary=ESP32Bound");
  http.addHeader("Connection", "keep-alive");
  http.setTimeout(6000);  // HTTP response timeout (ms)
  http.setReuse(true);    // ← giữ TCP/TLS connection sau mỗi request

  httpReady = true;
  Serial.println("[HTTP] Session bắt đầu — TLS handshake sẽ xảy ra ở request đầu tiên");
}

// ─────────────────────────────────────────────────────────────
void connectWiFi() {
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print("WiFi connecting");
  unsigned long t = millis();
  while (WiFi.status() != WL_CONNECTED) {
    if (millis() - t > 15000) {
      Serial.println("\nWiFi timeout — restart");
      ESP.restart();
    }
    delay(500);
    Serial.print(".");
  }
  Serial.printf("\nWiFi OK: %s\n", WiFi.localIP().toString().c_str());
}

// ─────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  initCamera();
  connectWiFi();
  beginHttp();
}

// ─────────────────────────────────────────────────────────────
void sendFrame() {
  // 1. Chụp frame
  camera_fb_t* fb = esp_camera_fb_get();
  if (!fb) {
    Serial.println("Capture failed");
    return;
  }

  // 2. Build multipart body
  const String boundary = "ESP32Bound";
  const String partHdr =
    "--" + boundary + "\r\n"
                      "Content-Disposition: form-data; name=\"file\"; filename=\"f.jpg\"\r\n"
                      "Content-Type: image/jpeg\r\n\r\n";
  const String partEnd = "\r\n--" + boundary + "--\r\n";

  size_t bodyLen = partHdr.length() + fb->len + partEnd.length();
  uint8_t* body = (uint8_t*)malloc(bodyLen);

  if (!body) {
    Serial.println("OOM — bỏ qua frame này");
    esp_camera_fb_return(fb);
    return;
  }

  size_t off = 0;
  memcpy(body + off, partHdr.c_str(), partHdr.length());
  off += partHdr.length();
  memcpy(body + off, fb->buf, fb->len);
  off += fb->len;
  memcpy(body + off, partEnd.c_str(), partEnd.length());
  esp_camera_fb_return(fb);  // giải phóng frame buffer ngay

  // 3. Gửi — TLS chỉ handshake lần đầu, các lần sau reuse connection
  unsigned long t0 = millis();
  int code = http.POST(body, bodyLen);
  unsigned long dt = millis() - t0;
  free(body);

  if (code == 200) {
    String resp = http.getString();
    bool motion = resp.indexOf("\"motion_detected\":true") >= 0;
    bool warmup = resp.indexOf("\"warming_up\":true") >= 0;
    framesSent++;
    Serial.printf("[OK %lums] motion=%s%s | sent=%lu fail=%lu\n",
                  dt,
                  motion ? "YES" : "no",
                  warmup ? " (warmup)" : "",
                  framesSent, framesFail);
    lastPing = millis();  // reset ping timer
  } else {
    framesFail++;
    Serial.printf("[ERR %d %lums] %s | sent=%lu fail=%lu\n",
                  code, dt, http.errorToString(code).c_str(),
                  framesSent, framesFail);

    // Kết nối bị đứt → reconnect
    Serial.println("[HTTP] Reset session...");
    beginHttp();
    delay(1000);
  }
  // KHÔNG gọi http.end() khi thành công → giữ TLS connection
}

// ─────────────────────────────────────────────────────────────
void loop() {
  // Kiểm tra WiFi
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi mất — reconnect...");
    httpReady = false;
    connectWiFi();
    beginHttp();
    return;
  }

  const unsigned long interval = 1000UL / FPS;
  unsigned long now = millis();

  // Gửi frame đúng FPS
  if (now - lastSend >= interval) {
    lastSend = now;
    sendFrame();
  }
}
