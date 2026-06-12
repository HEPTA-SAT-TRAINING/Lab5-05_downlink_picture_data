# Lab5-05: Downlink Picture Data

Lab5 repository for downlinking HK telemetry, accelerometer data, and JPEG images with the HEPTA-SAT kit.

## Web Serial Viewer (browser receiver)

Connect your HEPTA-SAT via USB after flashing the firmware, then open the URL below in **Chrome or Edge**.

**https://hepta-sat-training.github.io/Lab5-05_downlink_picture_data/**

1. **Add Port** → select your COM port
2. Leave baud rate at **9600**, then click **Connect**
3. Confirm HK telemetry, then use **Send a** (accelerometer) or **Send p** (image)

See [docs/README.md](docs/README.md) for details.

## Firmware

Open `Lab5-05_downlink_picture_data.ino` in the Arduino IDE and upload it to your board. For library and submodule setup, see [src/README.md](src/README.md).

## Related documentation

- [hepta_image_serial_web_plan.md](hepta_image_serial_web_plan.md) — image protocol and web receiver design
- [hepta_web_github_pages_plan.md](hepta_web_github_pages_plan.md) — GitHub Pages deployment plan
