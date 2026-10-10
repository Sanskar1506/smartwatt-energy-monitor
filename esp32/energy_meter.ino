#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

// Set these for your own network and server. Use your computer's LAN IP,
// not "localhost". ESP32 and backend must be on the same network.
const char* WIFI_SSID = "YOUR_WIFI_NAME";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
const char* API_URL = "http://192.168.1.100:4000/api/readings";
const char* API_KEY = "change-this-device-api-key";
const char* DEVICE_ID = "ESP32_AC_METER_01";

unsigned long lastSend = 0;
const unsigned long SEND_INTERVAL_MS = 2000;

void connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting to Wi-Fi");
  while (WiFi.status() != WL_CONNECTED) { delay(500); Serial.print("."); }
  Serial.println();
  Serial.print("IP: "); Serial.println(WiFi.localIP());
}

// Replace these placeholders with calibrated readings from your isolated
// AC energy meter/sensor module. Never connect mains directly to ESP32 pins.
float readVoltage() { return 230.0 + (float)random(-20, 21) / 10.0; }
float readCurrent() { return 1.2 + (float)random(0, 250) / 100.0; }
float readPower() { return readVoltage() * readCurrent() * 0.90; }
float readEnergyKwh() { static float energy=0.0; energy += 0.0001; return energy; }
float readPowerFactor() { return 0.90; }
float readFrequency() { return 50.0; }
float readTemperature() { return 34.0; }

void setup() {
  Serial.begin(115200);
  randomSeed(analogRead(0));
  connectWiFi();
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) connectWiFi();
  if (millis() - lastSend >= SEND_INTERVAL_MS) {
    lastSend = millis();
    const float voltage = readVoltage();
    const float current = readCurrent();
    const float power = voltage * current * readPowerFactor();
    StaticJsonDocument<512> doc;
    doc["deviceId"] = DEVICE_ID;
    doc["voltage"] = voltage;
    doc["current"] = current;
    doc["power"] = power;
    doc["energy"] = readEnergyKwh();
    doc["powerFactor"] = readPowerFactor();
    doc["frequency"] = readFrequency();
    doc["temperature"] = readTemperature();
    doc["wifiRssi"] = WiFi.RSSI();
    doc["ipAddress"] = WiFi.localIP().toString();
    doc["uptimeSeconds"] = millis() / 1000;
    doc["firmwareVersion"] = "1.0.0";

    String payload;
    serializeJson(doc, payload);
    HTTPClient http;
    http.begin(API_URL);
    http.addHeader("Content-Type", "application/json");
    http.addHeader("x-api-key", API_KEY);
    const int code = http.POST(payload);
    Serial.printf("POST status: %d | payload: %s\n", code, payload.c_str());
    http.end();
  }
}
