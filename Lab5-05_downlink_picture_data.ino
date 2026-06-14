#include "src/HeptaSat.h"

HeptaCdh cdh;
HeptaCom com;
HeptaEps eps;
HeptaSensor sensor;

constexpr uint8_t ACCEL_DOWNLINK_COUNT = 10;
constexpr const char* PICTURE_FILENAME = "/picture_dl.jpg";
uint8_t accel_remaining = 0;
bool hk_enable = true;

void downlink_hk_data(void) {
  float temp = sensor.get_temperature();
  float vbat = eps.get_battery_voltage();
  float v5 = eps.get_5v_voltage();
  float v3v3 = eps.get_3v3_voltage();
  float sap = eps.get_sap_voltage();
  float idis = eps.get_current_discharge();
  float ichg = eps.get_current_charge();

  com.printf(
    "TEMP=%.2f,VBAT=%.3f,V5=%.3f,V3V3=%.3f,SAP=%.3f,IDIS=%.3f,ICHG=%.3f\r\n",
    temp, vbat, v5, v3v3, sap, idis, ichg);

  cdh.printf(
    "HK: TEMP=%.2f C, VBAT=%.3f V, V5=%.3f V, V3V3=%.3f V, SAP=%.3f V, IDIS=%.3f A, ICHG=%.3f A\r\n",
    temp, vbat, v5, v3v3, sap, idis, ichg);
}

void downlink_accel_data(void) {
  float ax, ay, az;
  sensor.get_acceleration(&ax, &ay, &az);

  com.printf("AX=%.2f,AY=%.2f,AZ=%.2f\r\n", ax, ay, az);

  cdh.printf("ACCEL: AX=%.2f m/s^2, AY=%.2f m/s^2, AZ=%.2f m/s^2\r\n",
             ax, ay, az);
}

void setup() {
  cdh.begin();
  eps.init();
  eps.switch_3V3_on();
  sensor.begin();
  com.begin();

  cdh.println("XBee downlink started (HK: 1s interval, 'a'=accel, 'p'=picture)");
}

void loop() {
  if (com.available()) {
    char cmd = com.get_char();
    com.printf("command = %c\r\n", cmd);
    cdh.printf("command = %c\r\n", cmd);
    if (cmd == 'a') {
      com.printf("downlink accelerometer data\r\n");
      cdh.printf("downlink accelerometer data\r\n");
      accel_remaining = ACCEL_DOWNLINK_COUNT;
    } else if (cmd == 'p') {
      com.printf("downlink picture data\r\n");
      cdh.printf("downlink picture data\r\n");
      hk_enable = false;
      if (!sensor.camera_snapshot(PICTURE_FILENAME)) {
        com.send_image_error(HeptaCom::IMAGE_ERROR_CAPTURE_FAILED);
      } else {
        com.downlink_image_file(PICTURE_FILENAME);
      }
      hk_enable = true;
    }
  }

  if (accel_remaining > 0) {
    downlink_accel_data();
    accel_remaining--;
  } else if (hk_enable) {
    downlink_hk_data();
  }

  delay(1000);
}
