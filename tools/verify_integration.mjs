import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");

const checks = [
  {
    file: "src/common/hepta_image_tx.cpp",
    mustInclude: ["send_test_jpeg", "send_jpeg_file", "crc16_ccitt_false", "IMG_BEGIN"],
  },
  {
    file: "src/common/hepta_com_base.cpp",
    mustInclude: ["downlink_image_file", "HeptaImageTx::send_jpeg_file", "send_image_error"],
  },
  {
    file: "src/hepta_sat/hepta_sensor.cpp",
    mustInclude: ["camera_snapshot"],
    mustExclude: ["camera_downlink", "HeptaImageTx"],
  },
  {
    file: "Lab5-05_downlink_picture_data.ino",
    mustInclude: ["hk_enable", "cmd == 'p'", "camera_snapshot", "downlink_image_file"],
  },
  {
    file: "src/HeptaSat.h",
    mustInclude: ["hepta_image_tx.h"],
  },
];

let failures = 0;

for (const check of checks) {
  const path = join(root, check.file);
  const text = readFileSync(path, "utf8");
  for (const needle of check.mustInclude ?? []) {
    if (!text.includes(needle)) {
      console.error(`FAIL: ${check.file} missing "${needle}"`);
      failures += 1;
    }
  }
  for (const needle of check.mustExclude ?? []) {
    if (text.includes(needle)) {
      console.error(`FAIL: ${check.file} still contains "${needle}"`);
      failures += 1;
    }
  }
}

if (failures === 0) {
  console.log("PASS: firmware integration wiring");
  process.exit(0);
}

console.error(`${failures} integration check(s) failed`);
process.exit(1);
