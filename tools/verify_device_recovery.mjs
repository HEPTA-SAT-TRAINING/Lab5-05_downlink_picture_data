import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(path) {
  return readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
}

const storage = read("common/hepta_storage.cpp");
assert.match(storage, /_initialized \|\| begin\(\)/);
assert.match(storage, /invalidate\(\);[\s\S]*if \(!begin\(\)\)/);

const cdh = read("common/hepta_cdh_base.cpp");
const com = read("common/hepta_com_base.cpp");
const sensor = read("hepta_sat/hepta_sensor.cpp");
assert.match(cdh, /_storage\.open/);
assert.match(com, /storage_\.open/);
assert.match(sensor, /storage_\.open/);
assert.doesNotMatch(sensor, /SD\.open/);
assert.match(sensor, /for \(uint8_t attempt = 0; attempt < 2; attempt\+\+\)/);

const imu = read("drv/imu9axis_bno055.cpp");
assert.match(imu, /chip_id != BNO055_CHIP_ID_VALUE/);
assert.match(imu, /_initialized = false;[\s\S]*if \(!begin\(\)/);
assert.match(imu, /Wire\.endTransmission\(false\) != 0/);

console.log("PASS: SD, camera, and IMU recovery paths use shared retry policies");
