import { check, sleep } from "k6";
import http from "k6/http";
import type { Options } from "k6/options";

const HTTP_URL = `http://localhost:9001`;

// Custom metrics
export const options: Options = {
  scenarios: {
    http_large_payload: {
      executor: "constant-vus",
      vus: 10,
      duration: "20s",
      exec: "httpLargePayloadTest",
    },
    http_multipart: {
      executor: "constant-vus",
      vus: 2,
      duration: "20s",
      exec: "httpMultipartTest",
      startTime: "14s",
    },
    http_memory_multipart: {
      executor: "constant-vus",
      vus: 5,
      duration: "20s",
      exec: "httpMultipartMemory",
      startTime: "7s",
    }
  },
};

// ===========================================================================
// Scenario 2 – HTTP large payload (> 200 KiB)
// ===========================================================================
const SIZE = 1024 * 1024;
const rawBytes = new Uint8Array(SIZE);
rawBytes.fill(49)
export function httpLargePayloadTest(): void {
  const res = http.post(`${HTTP_URL}/upload`, rawBytes.buffer, {
    headers: {
      "Content-Type": "text/plain"
    }
  });

  if(
    !check(res, {
      "status is 200": (r) => r.status === 200,
      "server echoes correct size": (r) => {
        try {
          const body = r.json() as { receivedBytes?: number };
          return body.receivedBytes !== undefined && body.receivedBytes >= SIZE;
        } catch {
          return false;
        }
      },
      "response time < 2000ms": (r) => r.timings.duration < 2000,
    })
  ) throw new Error("I NEED 100% SUCCESS")
  
  sleep(0.2);
}

// ===========================================================================
// Scenario 3 – Large multipart request
// ===========================================================================
export function httpMultipartTest(): void {
  const formData = {
    // Large text file
    textFile: http.file(rawBytes.buffer, "large-text.txt", "text/plain"),
    textFile2: http.file(rawBytes.buffer, "large-text.txt", "text/plain"),
    // Large binary file
    binaryFile: http.file(rawBytes.buffer as ArrayBuffer, "binary.bin", "application/octet-stream"),
    meta: http.file(rawBytes.buffer as ArrayBuffer, "binary.bin", "application/octet-stream"),
  };

  const res = http.post(`${HTTP_URL}/multipart-disk`, formData);

  if(
    !check(res, {
    "multipart status 200": (r) => r.status === 200,
    "all parts received": (r) => {
      try {
        const body = r.json() as { partsReceived?: number };
        return body.partsReceived !== undefined && body.partsReceived == 4;
      } catch {
        return false;
      }
    },
    "multipart response < 3000ms": (r) => r.timings.duration < 3000,
  })) throw new Error("NEED 100% SUCCESS")

  sleep(0.2);
}
export function httpMultipartMemory(): void {
  const formData = {
    // Large text file
    textFile: http.file(rawBytes.buffer, "large-text.txt", "text/plain"),
    textFile2: http.file(rawBytes.buffer, "large-text.txt", "text/plain"),
    // Large binary file
    binaryFile: http.file(rawBytes.buffer as ArrayBuffer, "binary.bin", "application/octet-stream"),
    meta: http.file(rawBytes.buffer as ArrayBuffer, "binary.bin", "application/octet-stream"),
  };

  const res = http.post(`${HTTP_URL}/multipart-memory`, formData);

  if(
    !check(res, {
    "multipart status 200": (r) => r.status === 200,
    "all parts received": (r) => {
      try {
        const body = r.json() as { partsReceived?: number };
        return body.partsReceived !== undefined && body.partsReceived >= 4;
      } catch {
        return false;
      }
    },
    "multipart response < 3000ms": (r) => r.timings.duration < 3000,
  })) throw new Error("NEED 100% SUCCESS")

  sleep(0.2);
}
