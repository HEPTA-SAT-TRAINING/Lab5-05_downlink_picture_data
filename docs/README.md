# HEPTA-SAT Web Serial Viewer

Web app that receives and displays HK telemetry, accelerometer data, and JPEG images downlinked from the HEPTA-SAT kit over UART/USB-Serial.

## Getting started (GitHub Pages)

For class and lab use, open this URL in Chrome or Edge. **No additional tools need to be installed.**

```text
https://hepta-sat-training.github.io/Lab5-05_downlink_picture_data/
```

> The repository must have **Settings → Pages** configured with Branch=`main` and Folder=`/docs`.

## Requirements

- **Browser**: Chrome or Edge (Web Serial API support)
- **Connection**: HTTPS or `localhost` (secure context required)
- **Default baud rate**: **9600** (matches firmware `com.begin(9600)`)

## Local development

Start a local HTTP server from the repository root or the `docs/` directory, then open it in your browser.

```bash
# From repository root
python -m http.server 8080 --directory docs

# Or from inside docs/
cd docs
python -m http.server 8080
```

Open `http://localhost:8080` in your browser.

> Opening the page via `file://` will not work with the Web Serial API.

## Usage

1. Click **Add Port** and select a COM port in the browser dialog (permission is required on first use)
2. Choose the COM port from the dropdown (if multiple ports are authorized)
3. Click **Connect**
4. Confirm HK telemetry updates every second
5. Click **Send a: Accel** to receive accelerometer data (10 lines)
6. Click **Send p: Picture** to receive and display a JPEG image
7. Click **Save JPEG** to save the received image

> Due to Web Serial API constraints, only COM ports previously authorized via **Add Port** appear in the dropdown. Use **Refresh** to reload the list.

## Protocol overview

| Command | Description |
|---------|-------------|
| `a` | Send accelerometer text (`AX=...,AY=...,AZ=...`) |
| `p` | Send image as binary packets |

Image transfer sequence:

```text
IMG_BEGIN\n
START packet (TYPE=0x01)
DATA packets (TYPE=0x02, payload max 512 bytes)
END packet (TYPE=0x03)
\nIMG_END\n
```

Packet format: MAGIC `HP` + TYPE + SEQ + TOTAL + LEN + CRC16 + PAYLOAD (little endian, CRC-16/CCITT-FALSE).

For details, see [hepta_image_serial_web_plan.md](../hepta_image_serial_web_plan.md) in the repository root.

## CRC self-test

`crc16.js` validates a standard test vector on startup.

```text
Input : "123456789"
CRC   : 0x29B1
```

If the browser developer console shows `CRC-16 self-test passed (0x29B1)`, the CRC implementation is working.

## File layout

```text
docs/
  index.html   UI
  styles.css   Styles
  serial.js    Web Serial connection
  crc16.js     CRC-16/CCITT-FALSE
  packet.js    Binary packet parser
  app.js       State machine and UI updates
  README.md    This file
```

## Troubleshooting

- **Cannot connect**: Use Chrome/Edge and open the page over HTTPS or `localhost`
- **HK not updating**: Confirm baud rate is 9600 (changeable in the UI)
- **Image error**: Check the cable connection and press **Send p** again (retransmit is not supported)
- **Packet timeout**: If communication drops during image receive, the transfer times out after 3 seconds
